// Plain-Node test script, no framework/dependency -- run with:
//   node tests/schedule.test.mjs
// Exits 0 if everything passes, 1 if anything fails (so it can be wired
// into CI later without adding any tooling now).
import {
  isScheduledDay,
  isWeeklyTargetSchedule,
  isDeadlineSchedule,
  isTrackerSchedule,
  isTrackerCompliantOnDay,
  getScheduleDescription,
  countCompletionsThisWeek,
  computeStreak,
  computeWeeklyStreak,
  countTrackerCompliantDays,
  trackerMilestoneWeeks,
  trackerMilestoneLabel
} from '../schedule-utils.js';
import {
  localDateKey,
  parseLocalDate,
  nextLocalDate,
  prevLocalDate,
  weekStartDate,
  getDayKey
} from '../date-utils.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL - ' + name);
    console.log('    ' + e.message);
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
  }
}

// --- date-utils ---

test('localDateKey formats a Date as YYYY-MM-DD', () => {
  assertEqual(localDateKey(new Date(2026, 6, 31)), '2026-07-31');
});

test('parseLocalDate round-trips a date string without timezone drift', () => {
  const d = parseLocalDate('2026-07-31');
  assertEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 6, 31]);
});

test('nextLocalDate/prevLocalDate step by exactly one day', () => {
  assertEqual(nextLocalDate('2026-07-31'), '2026-08-01');
  assertEqual(prevLocalDate('2026-08-01'), '2026-07-31');
});

test('nextLocalDate handles month/year rollover', () => {
  assertEqual(nextLocalDate('2026-12-31'), '2027-01-01');
});

test('weekStartDate anchors to Monday regardless of which day of the week is passed', () => {
  // 2026-07-31 is a Friday
  assertEqual(localDateKey(weekStartDate(new Date(2026, 6, 31))), '2026-07-27');
  // 2026-07-27 is already the Monday
  assertEqual(localDateKey(weekStartDate(new Date(2026, 6, 27))), '2026-07-27');
});

test('getDayKey identifies the day of week from an iso string', () => {
  assertEqual(getDayKey('2026-07-31'), 'fri');
  assertEqual(getDayKey('2026-08-02'), 'sun');
});

// --- schedule-utils: isScheduledDay ---

test('isScheduledDay: daily is always true', () => {
  assertEqual(isScheduledDay({ schedule: 'daily' }, '2026-08-02'), true); // a Sunday
});

test('isScheduledDay: weekdays excludes Sat/Sun', () => {
  const c = { schedule: 'weekdays' };
  assertEqual(isScheduledDay(c, '2026-07-31'), true);  // Fri
  assertEqual(isScheduledDay(c, '2026-08-01'), false); // Sat
  assertEqual(isScheduledDay(c, '2026-08-02'), false); // Sun
});

test('isScheduledDay: custom respects scheduleDays', () => {
  const c = { schedule: 'custom', scheduleDays: ['mon', 'wed'] };
  assertEqual(isScheduledDay(c, '2026-07-27'), true);  // Mon
  assertEqual(isScheduledDay(c, '2026-07-28'), false); // Tue
  assertEqual(isScheduledDay(c, '2026-07-29'), true);  // Wed
});

test('isScheduledDay: "N times a week" schedules are due every day (not pinned to fixed weekdays)', () => {
  // Regression test for the original bug: "twice a week" used to only ever
  // be "scheduled" on a hardcoded Mon/Thu, so completing it on any other day
  // silently didn't count and it could cost a life on days never agreed to.
  for (const schedule of ['twice', 'three', 'four']) {
    for (const day of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']) {
      assertEqual(isScheduledDay({ schedule }, day), true, `${schedule} on ${day}`);
    }
  }
});

test('isScheduledDay: a one-off deadline commitment is due only on its exact deadline date', () => {
  const c = { schedule: 'deadline', deadlineDate: '2026-08-05' };
  assertEqual(isScheduledDay(c, '2026-08-04'), false);
  assertEqual(isScheduledDay(c, '2026-08-05'), true);
  assertEqual(isScheduledDay(c, '2026-08-06'), false);
});

test('isScheduledDay: a deadline commitment with no deadlineDate set is never due', () => {
  assertEqual(isScheduledDay({ schedule: 'deadline' }, '2026-08-05'), false);
});

test('isDeadlineSchedule identifies deadline but not other schedule types', () => {
  assertEqual(isDeadlineSchedule({ schedule: 'deadline' }), true);
  assertEqual(isDeadlineSchedule({ schedule: 'daily' }), false);
  assertEqual(isDeadlineSchedule(null), false);
});

test('getScheduleDescription: describes a deadline commitment by its due date', () => {
  assertEqual(getScheduleDescription({ schedule: 'deadline', deadlineDate: '2026-08-05' }), 'One-off — due 2026-08-05');
  assertEqual(getScheduleDescription({ schedule: 'deadline' }), 'One-off with a deadline');
});

test('isScheduledDay: a tracker (running clock) is due every day, same as daily', () => {
  // A tracker plugs into the same daily life-loss/XP/leaderboard machinery
  // as a daily habit -- it must be "due" every day for that to work; what's
  // inverted is what counts as compliant (see isTrackerCompliantOnDay), not
  // whether it's due at all.
  const c = { schedule: 'tracker' };
  for (const day of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']) {
    assertEqual(isScheduledDay(c, day), true, `tracker on ${day}`);
  }
});

test('isTrackerSchedule identifies tracker but not other schedule types', () => {
  assertEqual(isTrackerSchedule({ schedule: 'tracker' }), true);
  assertEqual(isTrackerSchedule({ schedule: 'daily' }), false);
  assertEqual(isTrackerSchedule(null), false);
});

test('isTrackerCompliantOnDay: compliant means NOT logged that day -- inverted from a normal habit', () => {
  const c = { schedule: 'tracker' };
  const history = ['2026-07-30'];
  assertEqual(isTrackerCompliantOnDay(c, history, '2026-07-30'), false, 'logged that day -- a miss');
  assertEqual(isTrackerCompliantOnDay(c, history, '2026-07-31'), true, 'not logged -- compliant');
  assertEqual(isTrackerCompliantOnDay(c, [], '2026-07-31'), true, 'never logged -- compliant');
});

test('getScheduleDescription: describes a tracker\'s stakes, not just its lack of a schedule', () => {
  assertEqual(getScheduleDescription({ schedule: 'tracker' }), 'Running clock — earns XP daily, but logging it costs a life and XP, like any other miss');
});

// --- schedule-utils: countTrackerCompliantDays ---

test('countTrackerCompliantDays: counts every day in range not present in history', () => {
  assertEqual(countTrackerCompliantDays([], '2026-07-28', '2026-07-31'), 4);
});

test('countTrackerCompliantDays: logged days do not count', () => {
  const history = ['2026-07-29']; // one relapse day inside the range
  assertEqual(countTrackerCompliantDays(history, '2026-07-28', '2026-07-31'), 3);
});

test('countTrackerCompliantDays: an inverted or missing range counts as zero', () => {
  assertEqual(countTrackerCompliantDays([], '2026-07-31', '2026-07-28'), 0);
  assertEqual(countTrackerCompliantDays([], null, '2026-07-31'), 0);
});

// --- schedule-utils: tracker milestones ---

test('trackerMilestoneWeeks: floors to the number of full weeks elapsed', () => {
  assertEqual(trackerMilestoneWeeks(0), 0);
  assertEqual(trackerMilestoneWeeks(6), 0);
  assertEqual(trackerMilestoneWeeks(7), 1);
  assertEqual(trackerMilestoneWeeks(21), 3);
  assertEqual(trackerMilestoneWeeks(365), 52);
});

test('trackerMilestoneLabel: pluralizes weeks correctly', () => {
  assertEqual(trackerMilestoneLabel(1), '1 Week');
  assertEqual(trackerMilestoneLabel(3), '3 Weeks');
});

test('computeStreak: a tracker always reads 0, since its history holds bad days not good ones', () => {
  // isScheduledDay() now returns true every day for a tracker (no infinite
  // loop risk here anymore), but computeStreak() counts consecutive days
  // PRESENT in history -- for a tracker that's consecutive days the avoided
  // thing happened, which would render as a fake "achievement" streak for
  // relapsing. Short-circuits to 0 instead; the running clock is the real
  // indicator.
  const c = { schedule: 'tracker' };
  assertEqual(computeStreak(c, ['2026-07-31'], '2026-07-31'), 0);
  assertEqual(computeStreak(c, [], '2026-07-31'), 0);
});

test('isWeeklyTargetSchedule identifies once/twice/three/four but not daily/weekdays/custom', () => {
  assertEqual(isWeeklyTargetSchedule({ schedule: 'once' }), true);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'twice' }), true);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'three' }), true);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'four' }), true);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'daily' }), false);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'weekdays' }), false);
  assertEqual(isWeeklyTargetSchedule({ schedule: 'custom' }), false);
});

test('getScheduleDescription: describes "once a week" as any 1 day', () => {
  assertEqual(getScheduleDescription({ schedule: 'once' }), 'Once a week (any 1 day)');
});

test('computeWeeklyStreak: "once a week" is satisfied by a single day in the week', () => {
  const c = { schedule: 'once', weeklyTarget: 1 };
  assertEqual(computeWeeklyStreak(c, ['2026-07-29'], '2026-07-31'), 1);
});

// --- schedule-utils: countCompletionsThisWeek ---

test('countCompletionsThisWeek counts any day within the week for weekly-target schedules', () => {
  const c = { schedule: 'twice', history: ['2026-07-28', '2026-07-31'] }; // Tue + Fri, not the old Mon/Thu
  assertEqual(countCompletionsThisWeek(c, new Date(2026, 6, 31)), 2);
});

test('countCompletionsThisWeek excludes completions from other weeks', () => {
  const c = { schedule: 'daily', history: ['2026-07-20', '2026-07-28'] };
  assertEqual(countCompletionsThisWeek(c, new Date(2026, 6, 31)), 1);
});

// --- schedule-utils: computeStreak (day-based) ---

test('computeStreak: consecutive daily completions count up', () => {
  const c = { schedule: 'daily' };
  const history = ['2026-07-29', '2026-07-30', '2026-07-31'];
  assertEqual(computeStreak(c, history, '2026-07-31'), 3);
});

test('computeStreak: a gap breaks the streak', () => {
  const c = { schedule: 'daily' };
  const history = ['2026-07-27', '2026-07-30', '2026-07-31']; // missing 28/29
  assertEqual(computeStreak(c, history, '2026-07-31'), 2);
});

test('computeStreak: weekdays schedule skips weekends without breaking the streak', () => {
  const c = { schedule: 'weekdays' };
  // Fri 07-24, (weekend skipped), Mon 07-27 .. Fri 07-31 all done
  const history = ['2026-07-24', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
  assertEqual(computeStreak(c, history, '2026-07-31'), 6);
});

test('computeStreak: today not yet done means the active streak reads 0', () => {
  const c = { schedule: 'daily' };
  const history = ['2026-07-29', '2026-07-30']; // yesterday done, today not
  assertEqual(computeStreak(c, history, '2026-07-31'), 0);
});

test('computeStreak: a deadline commitment always reads 0 and never loops looking for a scheduled day', () => {
  // Regression guard: isScheduledDay() only ever returns true on the exact
  // deadlineDate for a 'deadline' schedule, so if computeStreak() didn't
  // short-circuit on this schedule type, walking backward from asOfIso
  // looking for a scheduled day (with a future or nonexistent deadlineDate)
  // would never find one and loop forever.
  const c = { schedule: 'deadline', deadlineDate: '2026-12-31' };
  assertEqual(computeStreak(c, ['2026-07-31'], '2026-07-31'), 0);
  const cNoDeadline = { schedule: 'deadline' };
  assertEqual(computeStreak(cNoDeadline, [], '2026-07-31'), 0);
});

// --- schedule-utils: computeWeeklyStreak ---

test('computeWeeklyStreak: meeting the target this week counts as 1', () => {
  const c = { schedule: 'twice', weeklyTarget: 2 };
  const history = ['2026-07-28', '2026-07-31']; // 2 completions this week
  assertEqual(computeWeeklyStreak(c, history, '2026-07-31'), 1);
});

test('computeWeeklyStreak: current week not yet met reads 0, mirroring computeStreak\'s "today" convention', () => {
  const c = { schedule: 'twice', weeklyTarget: 2 };
  const history = ['2026-07-28']; // only 1 of 2 so far, week not over
  assertEqual(computeWeeklyStreak(c, history, '2026-07-29'), 0);
});

test('computeWeeklyStreak: counts consecutive fully-met prior weeks', () => {
  const c = { schedule: 'twice', weeklyTarget: 2 };
  const history = [
    '2026-07-20', '2026-07-23', // week of 07-20: 2 done
    '2026-07-27', '2026-07-30'  // week of 07-27: 2 done
  ];
  assertEqual(computeWeeklyStreak(c, history, '2026-07-31'), 2);
});

test('computeWeeklyStreak: a missed prior week stops the count there', () => {
  const c = { schedule: 'twice', weeklyTarget: 2 };
  const history = [
    '2026-07-13', // week of 07-13: only 1 done (missed)
    '2026-07-27', '2026-07-30'  // week of 07-27: 2 done
  ];
  assertEqual(computeWeeklyStreak(c, history, '2026-07-31'), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
