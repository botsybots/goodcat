import { getDayKey, localDateKey, parseLocalDate, weekStartDate } from './date-utils.js';

const weekScheduleMap = {
  twice: ['mon', 'thu'],
  three: ['mon', 'wed', 'fri'],
  four: ['mon', 'tue', 'wed', 'thu']
};

export function isScheduledDay(commit, isoDate){
  if(!commit || !isoDate) return false;
  const day = getDayKey(isoDate);
  if(commit.schedule === 'daily') return true;
  if(commit.schedule === 'weekdays') return ['mon','tue','wed','thu','fri'].includes(day);
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays) && commit.scheduleDays.length) return commit.scheduleDays.includes(day);
  if(commit.schedule in weekScheduleMap) return weekScheduleMap[commit.schedule].includes(day);
  return true;
}

export function getScheduleDescription(commit){
  if(!commit) return 'Daily';
  if(commit.schedule === 'daily') return 'Daily';
  if(commit.schedule === 'weekdays') return 'Weekdays (Mon–Fri)';
  if(commit.schedule === 'twice') return 'Twice a week (Mon/Thu)';
  if(commit.schedule === 'three') return 'Three times a week (Mon/Wed/Fri)';
  if(commit.schedule === 'four') return 'Four times a week (Mon–Thu)';
  if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays)) return `Custom: ${commit.scheduleDays.join(', ')}`;
  return 'Daily';
}

export function countCompletionsThisWeek(commit, refDate){
  if(!commit || !commit.history) return 0;
  const start = localDateKey(weekStartDate(refDate));
  const end = localDateKey(new Date(weekStartDate(refDate).getTime() + 7 * 24 * 60 * 60 * 1000));
  return (commit.history||[]).filter(d => d >= start && d < end && isScheduledDay(commit, d)).length;
}

// Single source of truth for streak calculation, used by both the client
// (app.js, against in-memory history) and the server (against completion_log
// rows), so the two never disagree about what counts as a current streak.
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
