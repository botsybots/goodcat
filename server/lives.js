// Server-side lives evaluation -- the single source of truth, replacing the
// old per-device client calculation. Ports the exact day-walking algorithm
// that used to live in app.js's updateLivesForUser(), just backed by
// completion_log instead of an in-memory commit.history array. A given
// day/week is judged at most once ever: life_events' UNIQUE(user_id, date,
// type) constraint is what write-once flag used to be (state.lifeLosses /
// state.weeklyLifeLosses / state.lifeGains).
import { dbAll, dbGet, dbRun } from './db.js';
import {
  isScheduledDay, isWeeklyTargetSchedule, isDeadlineSchedule, isTrackerSchedule,
  isTrackerCompliantOnDay, countCompletionsThisWeek
} from '../schedule-utils.js';
import { localDateKey, parseLocalDate, nextLocalDate, prevLocalDate, weekStartDate } from '../date-utils.js';

export const MAX_LIVES = 9;
export const RESET_LIVES_AFTER_COUNCIL = 3;

export function clampLives(n){
  return Math.min(MAX_LIVES, Math.max(0, n));
}

// Malformed/legacy scheduleDays shouldn't take down evaluation for every
// commitment behind it in the loop (and, before this existed, could throw
// out of the whole per-user evaluation -- see evaluateAllLives()'s comment).
// Treating it as "no custom days" is the same fallback used everywhere else
// scheduleDays gets read.
function safeParseScheduleDays(raw){
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}

// Day-based commitments only (daily/weekdays/custom/deadline/tracker) --
// "N times a week" schedules are handled separately below, once per week.
async function getUserScheduledCountsForDate(userId, isoDate){
  const rows = await dbAll(
    "SELECT id, schedule, scheduleDays, deadlineDate, createdAt FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1",
    [userId]
  );
  let scheduled = 0, done = 0;
  for(const r of rows){
    const commit = { schedule: r.schedule || 'daily', scheduleDays: safeParseScheduleDays(r.scheduleDays), deadlineDate: r.deadlineDate };
    if(isWeeklyTargetSchedule(commit)) continue;
    const created = r.createdAt || isoDate;
    if(created > isoDate) continue;
    if(!isScheduledDay(commit, isoDate)) continue;
    scheduled += 1;
    let isDone;
    if(isDeadlineSchedule(commit)){
      const doneRow = await dbGet('SELECT COUNT(*) as count FROM completion_log WHERE commitment_id = ?', [r.id]);
      isDone = !!(doneRow && doneRow.count > 0);
    } else if(isTrackerSchedule(commit)){
      const dates = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ?', [r.id]);
      isDone = isTrackerCompliantOnDay(commit, dates.map(d => d.date), isoDate);
    } else {
      const row = await dbGet('SELECT 1 as ok FROM completion_log WHERE commitment_id = ? AND date = ?', [r.id, isoDate]);
      isDone = !!row;
    }
    if(isDone) done += 1;
  }
  return { scheduled, done };
}

async function getUserWeeklyComplianceForWeek(userId, weekStartDateObj){
  // Calendar-day arithmetic (not raw milliseconds) -- a DST transition
  // shifts wall-clock time by an hour, which millisecond math doesn't know
  // about and could land on the wrong calendar day for it. Currently
  // dormant since the server runs in UTC (no DST), but worth getting right
  // regardless, and the client (a real local timezone, which does have DST)
  // shares this exact calculation.
  const weekEndIso = localDateKey(new Date(weekStartDateObj.getFullYear(), weekStartDateObj.getMonth(), weekStartDateObj.getDate() + 6));
  const rows = await dbAll(
    "SELECT id, schedule, scheduleDays, weeklyTarget, createdAt FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1",
    [userId]
  );
  let total = 0, compliant = 0;
  for(const r of rows){
    const commit = { schedule: r.schedule, scheduleDays: safeParseScheduleDays(r.scheduleDays), weeklyTarget: r.weeklyTarget };
    if(!isWeeklyTargetSchedule(commit)) continue;
    const created = r.createdAt || weekEndIso;
    if(created > weekEndIso) continue;
    total += 1;
    const dates = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ?', [r.id]);
    commit.history = dates.map(d => d.date);
    const count = countCompletionsThisWeek(commit, weekStartDateObj);
    if(count >= (commit.weeklyTarget || 0)) compliant += 1;
  }
  return { total, compliant };
}

function getWindowDates(endDateIso, windowSize = 7){
  const dates = [];
  let cursor = parseLocalDate(endDateIso);
  if(!cursor) return dates;
  for(let i = 0; i < windowSize; i += 1){
    dates.unshift(localDateKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

// Write-once via life_events' UNIQUE constraint -- returns the resulting
// life total if this actually recorded a new event, or null if that
// day/week/type was already judged (INSERT OR IGNORE found nothing to do).
async function recordLifeEvent(userId, dateKey, type, delta){
  const result = await dbRun('INSERT OR IGNORE INTO life_events (user_id, date, type, delta) VALUES (?,?,?,?)', [userId, dateKey, type, delta]);
  if(!result.changes) return null;
  // Applied as a single atomic UPDATE (lives computed from the CURRENT
  // stored value in the same statement) rather than read-then-write, so an
  // overlapping evaluation for the same user (e.g. the periodic tick and an
  // on-demand GET /api/users landing at the same moment) can't clobber it.
  await dbRun('UPDATE users SET lives = MAX(0, MIN(?, lives + ?)) WHERE id = ?', [MAX_LIVES, delta, userId]);
  const row = await dbGet('SELECT lives FROM users WHERE id = ?', [userId]);
  return row ? row.lives : null;
}

// Walks this user forward from their last-evaluated date up through
// yesterday (never "today" -- a day in progress can't be judged yet),
// recording a loss/gain life_event for anything newly decided. Safe to call
// repeatedly/often: once caught up to yesterday it's a no-op.
export async function evaluateLivesForUser(userId){
  const user = await dbGet('SELECT id, lifeLastEvaluatedDate FROM users WHERE id = ?', [userId]);
  if(!user) return;
  const today = localDateKey(new Date());
  const yesterday = prevLocalDate(today);
  let startDate = user.lifeLastEvaluatedDate ? nextLocalDate(user.lifeLastEvaluatedDate) : null;
  if(!startDate){
    const row = await dbGet("SELECT MIN(createdAt) as minCreated FROM commitments WHERE user_id = ? OR scope = 'joint'", [userId]);
    startDate = (row && row.minCreated) || today;
  }
  let cursor = parseLocalDate(startDate);
  const end = parseLocalDate(yesterday);
  if(!cursor || !end || cursor > end) return;

  while(cursor <= end){
    const dayKey = localDateKey(cursor);

    const counts = await getUserScheduledCountsForDate(userId, dayKey);
    if(counts.scheduled > 0 && counts.done < counts.scheduled){
      await recordLifeEvent(userId, dayKey, 'daily_loss', -1);
    }

    // "N times a week" habits are judged once, at the end of their week
    // (Sunday) -- never on the other days.
    if(cursor.getDay() === 0){
      const wkStart = weekStartDate(cursor);
      const wkStartIso = localDateKey(wkStart);
      const compliance = await getUserWeeklyComplianceForWeek(userId, wkStart);
      if(compliance.total > 0 && compliance.compliant < compliance.total){
        await recordLifeEvent(userId, wkStartIso, 'weekly_loss', -1);
      }
    }

    const window = getWindowDates(dayKey, 7);
    if(window.length === 7){
      let totalScheduled = 0, totalDone = 0;
      for(const d of window){
        const c = await getUserScheduledCountsForDate(userId, d);
        totalScheduled += c.scheduled;
        totalDone += c.done;
      }
      if(totalScheduled > 0){
        const ratio = totalDone / totalScheduled;
        let gain = 0;
        if(ratio >= 1) gain = 2;
        else if(ratio >= 0.9) gain = 1;
        if(gain > 0) await recordLifeEvent(userId, dayKey, 'weekly_gain', gain);
      }
    }

    await dbRun('UPDATE users SET lifeLastEvaluatedDate = ? WHERE id = ?', [dayKey, userId]);
    cursor.setDate(cursor.getDate() + 1);
  }
}

// One person's evaluation throwing (a bad row, a transient DB hiccup) must
// never stop the other person's from running, and must never propagate out
// of here uncaught -- this is invoked both from a bare setInterval tick and
// from inside a request handler's loop; an unhandled rejection from either
// context is exactly the kind of failure that looks like "lives just never
// update" from the outside, with nothing visible telling you why.
export async function evaluateAllLives(){
  const users = await dbAll("SELECT id FROM users WHERE LOWER(name) IN ('anna','jordan')");
  for(const u of users){
    try{
      await evaluateLivesForUser(u.id);
    }catch(e){
      console.error('evaluateLivesForUser failed for user', u.id, e);
    }
  }
}

// Un-does a previously recorded loss if the day/week it was about is now
// fully compliant -- for backfilling a past date as done. Deliberately
// one-directional: un-marking a day doesn't retroactively charge a life,
// mirroring the day-walk above, which never revisits an already-judged day
// either way.
export async function reevaluatePastDayForUser(userId, dayIso){
  const lossRow = await dbGet("SELECT id FROM life_events WHERE user_id = ? AND date = ? AND type = 'daily_loss'", [userId, dayIso]);
  if(lossRow){
    const counts = await getUserScheduledCountsForDate(userId, dayIso);
    if(counts.scheduled > 0 && counts.done >= counts.scheduled){
      await dbRun('DELETE FROM life_events WHERE id = ?', [lossRow.id]);
      await dbRun('UPDATE users SET lives = MIN(?, lives + 1) WHERE id = ?', [MAX_LIVES, userId]);
      // A distinct type (not 'daily_loss' again) so this shows up as its own
      // fresh event for the client's "new since last sync" toast diffing --
      // the loss row it's replacing was just deleted, so without this the
      // refund would happen invisibly.
      await dbRun('INSERT OR IGNORE INTO life_events (user_id, date, type, delta) VALUES (?,?,?,?)', [userId, dayIso, 'refund', 1]);
    }
  }
  const weekStartIso = localDateKey(weekStartDate(parseLocalDate(dayIso)));
  const weekLossRow = await dbGet("SELECT id FROM life_events WHERE user_id = ? AND date = ? AND type = 'weekly_loss'", [userId, weekStartIso]);
  if(weekLossRow){
    const compliance = await getUserWeeklyComplianceForWeek(userId, weekStartDate(parseLocalDate(dayIso)));
    if(compliance.total > 0 && compliance.compliant >= compliance.total){
      await dbRun('DELETE FROM life_events WHERE id = ?', [weekLossRow.id]);
      await dbRun('UPDATE users SET lives = MIN(?, lives + 1) WHERE id = ?', [MAX_LIVES, userId]);
      await dbRun('INSERT OR IGNORE INTO life_events (user_id, date, type, delta) VALUES (?,?,?,?)', [userId, weekStartIso, 'weekly_refund', 1]);
    }
  }
}
