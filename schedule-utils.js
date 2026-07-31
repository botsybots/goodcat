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

export function isScheduledDay(commit, isoDate){
  if(!commit || !isoDate) return false;
  if(isWeeklyTargetSchedule(commit)) return true;
  const day = getDayKey(isoDate);
  if(commit.schedule === 'daily') return true;
  if(commit.schedule === 'weekdays') return ['mon','tue','wed','thu','fri'].includes(day);
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays) && commit.scheduleDays.length) return commit.scheduleDays.includes(day);
  return true;
}

export function getScheduleDescription(commit){
  if(!commit) return 'Daily';
  if(commit.schedule === 'daily') return 'Daily';
  if(commit.schedule === 'weekdays') return 'Weekdays (Mon–Fri)';
  if(commit.schedule === 'twice') return 'Twice a week (any 2 days)';
  if(commit.schedule === 'three') return 'Three times a week (any 3 days)';
  if(commit.schedule === 'four') return 'Four times a week (any 4 days)';
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays)) return `Custom: ${commit.scheduleDays.join(', ')}`;
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
