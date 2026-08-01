import { getDayKey, localDateKey, parseLocalDate, weekStartDate } from './date-utils.js';

const WEEKLY_TARGET_SCHEDULES = ['twice', 'three', 'four'];

export const LABEL_CATEGORIES = ['Health', 'Fitness', 'Education', 'Home', 'Money', 'Social', 'Relationship'];

// "Twice/three/four a week" schedules are satisfied by completing the habit
// on any N days of the week — they are not pinned to specific weekdays.
// Missed-day and streak tracking for these therefore has to happen per week
// rather than per day; see computeWeeklyStreak() and the weekly life-loss
// check in app.js's updateLivesForUser().
export function isWeeklyTargetSchedule(commit){
  return !!commit && WEEKLY_TARGET_SCHEDULES.includes(commit.schedule);
}

// A one-off commitment is only ever "due" on its single deadline date --
// never before, never after -- unlike every other schedule type here, which
// recurs. See computeStreak()'s early return for why streak logic must never
// be run against one of these.
export function isDeadlineSchedule(commit){
  return !!commit && commit.schedule === 'deadline';
}

// A running clock since it was last logged (e.g. "3 days, 10 hours since
// eating meat"). It's "due" every day, same as a daily habit -- but what
// counts as compliant is inverted (see isTrackerCompliantOnDay below):
// staying clean is the win, logging it is the miss, so it plugs into the
// same daily life-loss/XP/leaderboard machinery as a daily habit, just with
// the boolean flipped.
export function isTrackerSchedule(commit){
  return !!commit && commit.schedule === 'tracker';
}

export function isScheduledDay(commit, isoDate){
  if(!commit || !isoDate) return false;
  if(isWeeklyTargetSchedule(commit)) return true;
  if(isDeadlineSchedule(commit)) return !!commit.deadlineDate && commit.deadlineDate === isoDate;
  if(isTrackerSchedule(commit)) return true;
  const day = getDayKey(isoDate);
  if(commit.schedule === 'daily') return true;
  if(commit.schedule === 'weekdays') return ['mon','tue','wed','thu','fri'].includes(day);
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays) && commit.scheduleDays.length) return commit.scheduleDays.includes(day);
  return true;
}

// A tracker's history records when it was LOGGED (i.e. the avoided thing
// happened) -- the opposite of a normal habit's history, which records when
// it was done. So "compliant" for a given day means it was NOT logged that
// day, not that it was.
export function isTrackerCompliantOnDay(commit, historyDates, isoDate){
  return !(historyDates || []).includes(isoDate);
}

export function getScheduleDescription(commit){
  if(!commit) return 'Daily';
  if(commit.schedule === 'daily') return 'Daily';
  if(commit.schedule === 'weekdays') return 'Weekdays (Mon–Fri)';
  if(commit.schedule === 'twice') return 'Twice a week (any 2 days)';
  if(commit.schedule === 'three') return 'Three times a week (any 3 days)';
  if(commit.schedule === 'four') return 'Four times a week (any 4 days)';
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays)) return `Custom: ${commit.scheduleDays.join(', ')}`;
  if(commit.schedule === 'deadline') return commit.deadlineDate ? `One-off — due ${commit.deadlineDate}` : 'One-off with a deadline';
  if(commit.schedule === 'tracker') return 'Running clock — logging it costs a life and XP, like any other miss';
  return 'Daily';
}

export function countCompletionsThisWeek(commit, refDate){
  if(!commit || !commit.history) return 0;
  const start = localDateKey(weekStartDate(refDate));
  const end = localDateKey(new Date(weekStartDate(refDate).getTime() + 7 * 24 * 60 * 60 * 1000));
  return (commit.history||[]).filter(d => d >= start && d < end && isScheduledDay(commit, d)).length;
}

// Single source of truth for day-based streak calculation (daily/weekdays/
// custom schedules), used by both the client (app.js, against in-memory
// history) and the server (against completion_log rows), so the two never
// disagree about what counts as a current streak.
export function computeStreak(commit, historyDates, asOfIso){
  if(!commit) return 0;
  // A one-off deadline commitment is due on exactly one date, which may be
  // in the future -- walking backward from asOfIso looking for a scheduled
  // day would never find one and loop forever. Streaks don't apply to a
  // single event anyway, so short-circuit to 0.
  if(isDeadlineSchedule(commit)) return 0;
  // A tracker's history holds LOGGED (bad) days, not done (good) days --
  // this function counts consecutive days present in history, which for a
  // tracker would mean "consecutive days you kept doing the avoided thing,"
  // the opposite of an achievement. The running clock already shows the
  // real progress; a "streak" number here would only be misleading.
  if(isTrackerSchedule(commit)) return 0;
  const history = new Set(historyDates || []);
  const cursor = parseLocalDate(asOfIso);
  if(!cursor) return 0;
  let streak = 0;
  while(true){
    const cursorIso = localDateKey(cursor);
    if(!isScheduledDay(commit, cursorIso)){
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if(history.has(cursorIso)){
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// Week-based streak for "N times a week" schedules: counts consecutive weeks
// where the weekly target was met. The current (possibly still in-progress)
// week only counts once its target has already been reached, mirroring how
// computeStreak() requires "today" to be done before showing a nonzero streak.
export function computeWeeklyStreak(commit, historyDates, asOfIso){
  const weeklyTarget = commit && commit.weeklyTarget;
  if(!weeklyTarget) return 0;
  const asOfDate = parseLocalDate(asOfIso);
  if(!asOfDate) return 0;
  let weekStart = weekStartDate(asOfDate);
  let streak = 0;
  while(true){
    const startIso = localDateKey(weekStart);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endIso = localDateKey(weekEnd);
    const count = (historyDates || []).filter(d => d >= startIso && d < endIso).length;
    if(count < weeklyTarget) break;
    streak += 1;
    weekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  return streak;
}
