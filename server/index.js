import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import webpush from 'web-push';
import { dbAll, dbGet, dbRun } from './db.js';
import { isScheduledDay, computeStreak, countTrackerCompliantDays, LABEL_CATEGORIES } from '../schedule-utils.js';
import { localDateKey, nextLocalDate, prevLocalDate } from '../date-utils.js';
import { MAX_LIVES, RESET_LIVES_AFTER_COUNCIL, clampLives, evaluateLivesForUser, evaluateAllLives, reevaluatePastDayForUser } from './lives.js';

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// This app is built for exactly two people. Registration used to be open to
// anyone who found the URL, and every authenticated endpoint returned both
// people's full data to whoever asked -- so a stranger registering an
// account (which already happened; see db.js's stray-account cleanup) could
// read everything. Locking both the sign-up form AND every authenticated
// request to this allow-list closes that regardless of what's already in
// the database.
const ALLOWED_USERNAMES = ['anna', 'jordan'];

// VAPID keys for web-push
let VAPID_PUBLIC = process.env.VAPID_PUBLIC;
let VAPID_PRIVATE = process.env.VAPID_PRIVATE;
if(!VAPID_PUBLIC || !VAPID_PRIVATE){
  const keys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC = VAPID_PUBLIC || keys.publicKey;
  VAPID_PRIVATE = VAPID_PRIVATE || keys.privateKey;
  console.log('Generated VAPID keys. Set them in .env to persist. Public:', VAPID_PUBLIC);
}
webpush.setVapidDetails('mailto:notify@example.com', VAPID_PUBLIC, VAPID_PRIVATE);

function sign(user){
  return jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'Missing token' });
  const parts = auth.split(' ');
  if(parts.length !== 2) return res.status(401).json({ error: 'Invalid token' });
  const token = parts[1];
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    // Blocks any account outside the allow-list immediately, even one with
    // a still-valid token issued before this check existed.
    if(!ALLOWED_USERNAMES.includes((payload.name || '').toLowerCase())){
      return res.status(403).json({ error: 'This app is private to Anna and Jordan.' });
    }
    req.user = payload;
    next();
  }catch(e){
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Unauthenticated health check -- used by the GitHub Actions keep-alive cron
// to stop the free-tier host from spinning down (which would otherwise stop
// reminders from firing while nobody has the app open).
app.get('/api/health', (req,res)=>{
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  const { name, password } = req.body;
  if(!name || !password) return res.status(400).json({ error: 'name and password required' });
  const normalizedName = name.trim().toLowerCase();
  if(!ALLOWED_USERNAMES.includes(normalizedName)){
    return res.status(403).json({ error: 'Registration is limited to Anna and Jordan.' });
  }
  try{
    const hash = await bcrypt.hash(password, 10);
    const result = await dbRun('INSERT INTO users (name,password) VALUES (?,?)', [normalizedName, hash]);
    const user = { id: result.lastID, name: normalizedName };
    res.json({ token: sign(user), user });
  }catch(e){
    res.status(400).json({ error: 'user exists or db error' });
  }
});

// Return VAPID public key for subscription
app.get('/api/vapidPublicKey', (req,res)=>{
  res.json({ publicKey: VAPID_PUBLIC });
});

// Store push subscription for authenticated user
app.post('/api/subscribe', authMiddleware, async (req,res)=>{
  const sub = req.body;
  if(!sub) return res.status(400).json({ error: 'missing subscription' });
  try{
    await dbRun('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?,?)', [req.user.id, JSON.stringify(sub)]);
    res.json({ success:true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Trigger push for a commitment (testing endpoint)
app.post('/api/send-push/:commitmentId', authMiddleware, async (req,res)=>{
  const id = req.params.commitmentId;
  try{
    const commit = await dbGet('SELECT id, user_id, text FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    const rows = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    const payload = JSON.stringify({ title: 'Reminder', body: 'Time for: ' + commit.text, tag: 'reminder-'+commit.id });
    const results = await Promise.all(rows.map(r=>{
      let sub;
      try{ sub = JSON.parse(r.subscription); }catch(e){ return Promise.resolve({ ok:false }); }
      return webpush.sendNotification(sub, payload).then(()=>({ ok:true })).catch(err=>({ ok:false, error: String(err) }));
    }));
    res.json({ results });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/login', async (req,res)=>{
  const { name, password } = req.body;
  if(!name || !password) return res.status(400).json({ error: 'name and password required' });
  try{
    const row = await dbGet('SELECT * FROM users WHERE LOWER(name) = ?', [name.trim().toLowerCase()]);
    if(!row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if(!ok) return res.status(400).json({ error: 'invalid credentials' });
    const user = { id: row.id, name: row.name };
    res.json({ token: sign(user), user });
  }catch(e){
    res.status(400).json({ error: 'invalid credentials' });
  }
});

// There's no email/phone on file for either account and no self-service
// "forgot password" flow -- this app is exactly two trusted people, so
// being logged in as EITHER one is enough to set a new password for
// EITHER account (including your own -- covers "I want to change my
// password" too, not just recovering the other person's). Deliberately
// doesn't require the target's current password, since the whole point is
// recovering an account nobody can currently log into.
app.post('/api/reset-password', authMiddleware, async (req,res)=>{
  const { username, newPassword } = req.body;
  if(!username || !newPassword) return res.status(400).json({ error: 'username and newPassword required' });
  const normalizedName = String(username).trim().toLowerCase();
  if(!ALLOWED_USERNAMES.includes(normalizedName)) return res.status(400).json({ error: 'unknown username' });
  try{
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await dbRun('UPDATE users SET password = ? WHERE LOWER(name) = ?', [hash, normalizedName]);
    if(!result.changes) return res.status(404).json({ error: 'that account does not exist yet -- register it first' });
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Current user's XP (levels are computed client-side from this number).
app.get('/api/me', authMiddleware, async (req,res)=>{
  try{
    const row = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
    res.json({ id: req.user.id, name: req.user.name, xp: row ? (row.xp || 0) : 0 });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Boop settings are opt-in and per-person -- each phone reads/writes only
// its own logged-in user's row.
app.get('/api/boop-settings', authMiddleware, async (req,res)=>{
  try{
    const row = await dbGet('SELECT boopEnabled, boopHour FROM users WHERE id = ?', [req.user.id]);
    res.json({ enabled: !!(row && row.boopEnabled), hour: (row && row.boopHour != null) ? row.boopHour : 20 });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.put('/api/boop-settings', authMiddleware, async (req,res)=>{
  const { enabled, hour } = req.body;
  const hourVal = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 20;
  try{
    await dbRun('UPDATE users SET boopEnabled = ?, boopHour = ? WHERE id = ?', [enabled ? 1 : 0, hourVal, req.user.id]);
    res.json({ enabled: !!enabled, hour: hourVal });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Testing endpoint -- sends a real boop push through the real webpush
// pathway right now, bypassing the daily cap/quiet-hours/completion checks
// (those govern the automatic scheduler, not manual testing). This is how
// Anna can see the whole open-app-vs-closed-app branch working (in
// service-worker.js) without waiting for her actual boop hour.
app.post('/api/boop/trigger', authMiddleware, async (req,res)=>{
  try{
    const subs = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
    if(!subs.length) return res.status(400).json({ error: 'No push subscription yet -- tap "Enable Notifications" in Settings first.' });
    const payload = JSON.stringify({ title: 'Good Cat 🐾', body: 'Boop. Loki would like a word.', tag: 'boop', boop: true });
    const results = await sendPushToSubscriptions(subs, payload);
    res.json({ results });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Both people's XP and lives, so each phone can show both panels correctly.
// Lives used to be purely local per-device (see server/lives.js's header
// comment for why that was a problem); now the server evaluates them
// on-demand right here so this is always fresh, in addition to the
// periodic evaluateAllLives() tick below.
app.get('/api/users', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll('SELECT id, name, xp, lives, lifeCouncilAck FROM users');
    const users = rows.filter(r => ['anna','jordan'].includes((r.name||'').toLowerCase()));
    for(const u of users) await evaluateLivesForUser(u.id);
    const result = await Promise.all(users.map(async u => {
      const fresh = await dbGet('SELECT xp, lives, lifeCouncilAck FROM users WHERE id = ?', [u.id]);
      const lastEvent = await dbGet('SELECT date, type, delta, created_at as createdAt FROM life_events WHERE user_id = ? ORDER BY id DESC LIMIT 1', [u.id]);
      return {
        id: u.id, name: u.name, xp: fresh.xp || 0,
        lives: fresh.lives == null ? MAX_LIVES : fresh.lives,
        maxLives: MAX_LIVES,
        councilAck: !!fresh.lifeCouncilAck,
        lastLifeEvent: lastEvent || null
      };
    }));
    res.json(result);
  }catch(e){
    console.error('GET /api/users error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Debug/self-service: set your own lives directly (clamped). Replaces the
// old client-only "Set my lives" debug tool now that lives live server-side.
app.post('/api/lives/set', authMiddleware, async (req,res)=>{
  const { lives } = req.body;
  if(!Number.isInteger(lives)) return res.status(400).json({ error: 'lives must be an integer' });
  try{
    const val = clampLives(lives);
    await dbRun('UPDATE users SET lives = ? WHERE id = ?', [val, req.user.id]);
    res.json({ lives: val });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// The client rolls the random 5% chance itself (right when a habit gets
// marked done) and calls this to actually apply it once it hits -- the
// randomness stays client-side since it's tied to that exact moment, but
// applying it goes through the server now that lives live here. `joint`
// grants to both people at once (one roll for a joint commitment, not a
// second independent chance per person), matching the old client behavior.
app.post('/api/lives/bonus', authMiddleware, async (req,res)=>{
  const targets = req.body && req.body.joint
    ? await dbAll("SELECT id FROM users WHERE LOWER(name) IN ('anna','jordan')")
    : [{ id: req.user.id }];
  try{
    const nowIso = new Date().toISOString();
    let granted = false;
    for(const t of targets){
      const row = await dbGet('SELECT lives FROM users WHERE id = ?', [t.id]);
      if(!row || row.lives >= MAX_LIVES) continue;
      await dbRun('UPDATE users SET lives = ? WHERE id = ?', [clampLives(row.lives + 1), t.id]);
      await dbRun('INSERT OR IGNORE INTO life_events (user_id, date, type, delta) VALUES (?,?,?,?)', [t.id, nowIso, 'rare_bonus', 1]);
      granted = true;
    }
    // Everyone involved was already at MAX_LIVES -- the client only shows
    // the celebration when this is true, same as the old "grantedAny" check.
    res.json({ success: true, granted });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Acknowledging a family council is always about the CALLER's own council --
// there's no target-user param, so one person can never ack the other's
// (the old client-only version technically allowed this since both ack
// buttons lived on the same shared local state; that was never exploitable
// since nothing was actually shared, but now that this is real cross-device
// state, only self-ack makes sense). Once BOTH have acked, resets both to
// RESET_LIVES_AFTER_COUNCIL and clears both flags.
app.post('/api/lives/council-ack', authMiddleware, async (req,res)=>{
  try{
    await dbRun('UPDATE users SET lifeCouncilAck = 1 WHERE id = ?', [req.user.id]);
    const users = await dbAll("SELECT id, lifeCouncilAck FROM users WHERE LOWER(name) IN ('anna','jordan')");
    const bothAcked = users.length === 2 && users.every(u => u.lifeCouncilAck);
    if(bothAcked){
      // A plain INSERT (not the usual write-once helper) with the current
      // timestamp as the "date" -- this isn't a delta to apply on top of
      // whatever lives currently are, it's a direct set, and unlike a daily
      // loss/gain there's no calendar day to key off that would sensibly
      // dedupe repeat councils. Recorded for BOTH people so whoever acked
      // first (and isn't looking right now) also finds out on their next
      // sync, not just whoever happened to trigger the second ack.
      const nowIso = new Date().toISOString();
      for(const u of users){
        await dbRun('UPDATE users SET lives = ?, lifeCouncilAck = 0 WHERE id = ?', [RESET_LIVES_AFTER_COUNCIL, u.id]);
        await dbRun('INSERT INTO life_events (user_id, date, type, delta) VALUES (?,?,?,?)', [u.id, nowIso, 'council_reset', RESET_LIVES_AFTER_COUNCIL]);
      }
    }
    res.json({ acked: true, bothAcked });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Returns commitments for BOTH people, not just the caller's own -- this is a
// two-person shared app, and the whole point of paws/comments is that each
// person can see and react to the other's habits. Editing stays restricted
// to your own (enforced on the POST/PUT/DELETE routes below).
app.get('/api/commitments', authMiddleware, async (req,res)=>{
  try{
    // This is the endpoint the app hits on every load and every periodic
    // sync, so it's the natural place to record "last seen" for the Boop
    // feature's 2-day-inactivity trigger -- no separate heartbeat needed.
    await dbRun('UPDATE users SET lastSeenAt = ? WHERE id = ?', [new Date().toISOString(), req.user.id]);
    const rows = await dbAll(`
      SELECT c.id, c.text, c.enabled, c.doneToday, c.schedule, c.scheduleDays,
             c.reminderEnabled, c.reminderTime, c.weeklyTarget, c.streak, c.lastDone,
             c.label, c.target, c.achieved, c.achievedAt, c.createdAt, c.scope, c.deadlineDate, c.lastLoggedAt, c.user_id as ownerId, u.name as ownerName
      FROM commitments c
      JOIN users u ON u.id = c.user_id
      WHERE LOWER(u.name) IN ('anna','jordan')
    `);

    const result = await Promise.all(rows.map(async r => {
      const [pawCountRow, lastPaw, lastComment, pauseRequest] = await Promise.all([
        dbGet('SELECT COUNT(*) as count FROM paw_log WHERE commitment_id = ?', [r.id]),
        dbGet(`SELECT p.date, u.name as byName FROM paw_log p JOIN users u ON u.id = p.giver_user_id
               WHERE p.commitment_id = ? ORDER BY p.date DESC LIMIT 1`, [r.id]),
        dbGet(`SELECT cm.text, cm.created_at as createdAt, u.name as byName FROM comments cm
               JOIN users u ON u.id = cm.user_id
               WHERE cm.commitment_id = ? ORDER BY cm.created_at DESC LIMIT 1`, [r.id]),
        dbGet(`SELECT id, requested_by FROM pause_requests WHERE commitment_id = ? AND status = 'pending'`, [r.id])
      ]);
      return {
        id: r.id,
        text: r.text,
        enabled: !!r.enabled,
        doneToday: !!r.doneToday,
        schedule: r.schedule || 'daily',
        scheduleDays: r.scheduleDays ? JSON.parse(r.scheduleDays) : null,
        reminderEnabled: !!r.reminderEnabled,
        reminderTime: r.reminderTime || null,
        weeklyTarget: r.weeklyTarget || null,
        streak: r.streak || 0,
        lastDone: r.lastDone,
        label: r.label || null,
        target: r.target || null,
        achieved: !!r.achieved,
        achievedAt: r.achievedAt,
        createdAt: r.createdAt,
        deadlineDate: r.deadlineDate || null,
        lastLoggedAt: r.lastLoggedAt || null,
        ownerId: r.ownerId,
        for: r.scope === 'joint' ? 'both' : (r.ownerName || '').toLowerCase(),
        mine: r.scope === 'joint' || r.ownerId === req.user.id,
        pawCount: pawCountRow ? pawCountRow.count : 0,
        lastPaw: lastPaw ? { date: lastPaw.date, by: lastPaw.byName } : null,
        lastComment: lastComment ? { text: lastComment.text, by: lastComment.byName, at: lastComment.createdAt } : null,
        pauseRequestPending: !!pauseRequest,
        pauseRequestId: pauseRequest ? pauseRequest.id : null,
        pauseRequestedByMe: pauseRequest ? pauseRequest.requested_by === req.user.id : false
      };
    }));

    res.json(result);
  }catch(e){
    console.error('GET /api/commitments error', e);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/commitments', authMiddleware, async (req,res)=>{
  const { text, enabled, schedule, scheduleDays, reminderEnabled, reminderTime, weeklyTarget, label, target, achieved, achievedAt, createdAt, scope, deadlineDate, lastLoggedAt } = req.body;
  const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
  const createdAtVal = createdAt || localDateKey(new Date());
  const scopeVal = scope === 'joint' ? 'joint' : 'personal';
  const deadlineDateVal = schedule === 'deadline' ? (deadlineDate || null) : null;
  const lastLoggedAtVal = schedule === 'tracker' ? (lastLoggedAt || new Date().toISOString()) : null;
  try{
    const result = await dbRun(
      'INSERT INTO commitments (user_id,text,enabled,doneToday,schedule,scheduleDays,reminderEnabled,reminderTime,weeklyTarget,streak,lastDone,label,target,achieved,achievedAt,createdAt,scope,deadlineDate,lastLoggedAt) VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?,?,?,?,?)',
      [req.user.id, text, enabled?1:0, 0, schedule||'daily', scheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, label||null, target||null, achieved?1:0, achievedAt||null, createdAtVal, scopeVal, deadlineDateVal, lastLoggedAtVal]
    );
    res.json({ id: result.lastID, text, enabled: !!enabled, doneToday:false, schedule: schedule||'daily', scheduleDays: scheduleDays || null, reminderEnabled: !!reminderEnabled, reminderTime: reminderTime || null, weeklyTarget: weeklyTarget || null, streak:0, lastDone:null, label: label||null, target: target||null, achieved: !!achieved, achievedAt: achievedAt||null, createdAt: createdAtVal, scope: scopeVal, deadlineDate: deadlineDateVal, lastLoggedAt: lastLoggedAtVal });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.put('/api/commitments/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const { text, enabled, doneToday, schedule, scheduleDays, reminderEnabled, reminderTime, weeklyTarget, label, target, createdAt, scope, deadlineDate, lastLoggedAt } = req.body;
  const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
  try{
    // A joint commitment belongs to both people, not just whichever of them
    // created it -- either can edit/complete it, so ownership here checks
    // scope in addition to user_id.
    const owner = await dbGet('SELECT user_id, scope FROM commitments WHERE id = ?', [id]);
    if(!owner || (owner.user_id !== req.user.id && owner.scope !== 'joint')) return res.status(404).json({ error: 'not found' });
    const isJoint = owner.scope === 'joint';
    const scopeVal = scope === 'joint' || scope === 'personal' ? scope : owner.scope;

    // If marking doneToday, recompute streak from the full completion_log
    // history using the same computeStreak() the client uses, so the two
    // never disagree.
    if (doneToday !== undefined) {
      const row = await dbGet('SELECT schedule, scheduleDays, target, achieved, achievedAt, doneToday FROM commitments WHERE id = ?', [id]);
      if(!row) return res.status(404).json({ error: 'not found' });
      const today = localDateKey(new Date());
      const effectiveScheduleDays = scheduleDays !== undefined ? scheduleDays : (row.scheduleDays ? JSON.parse(row.scheduleDays) : null);
      const effectiveScheduleDaysJson = effectiveScheduleDays ? JSON.stringify(effectiveScheduleDays) : null;
      const effectiveSchedule = schedule || row.schedule;
      const isDeadline = effectiveSchedule === 'deadline';
      const commitForStreak = { schedule: effectiveSchedule, scheduleDays: effectiveScheduleDays };

      if (isDeadline) {
        // A one-off commitment gets at most one completion_log row ever,
        // regardless of which actual day it was marked done on (which may
        // be well before the deadline itself) -- not a per-day log like
        // recurring habits, so mark-done/undo always replaces it wholesale.
        await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [id]);
        if (doneToday) {
          await dbRun('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1)', [id, req.user.id, today]);
        }
      } else if (doneToday) {
        // Not scoped by user_id: a joint commitment is done for the day the
        // moment either person marks it, and either can undo it -- and for a
        // personal commitment every row here already belongs to its one
        // owner anyway, so this is equally correct for both.
        await dbRun('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1) ON CONFLICT(commitment_id, date) DO UPDATE SET count = count + 1', [id, req.user.id, today]);
      } else {
        await dbRun('DELETE FROM completion_log WHERE commitment_id = ? AND date = ?', [id, today]);
      }

      const historyRows = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ?', [id]);
      const historyDates = historyRows.map(r => r.date);
      const newStreak = computeStreak(commitForStreak, historyDates, today);
      const newLast = historyDates.length ? historyDates.reduce((a, b) => (a > b ? a : b)) : null;
      const targetVal = target !== undefined ? target : row.target;
      let achieved = !!row.achieved;
      let achievedAt = row.achievedAt || null;
      if (targetVal && newStreak >= targetVal) {
        if (!achieved) { achieved = true; achievedAt = today; }
      } else if (targetVal) {
        achieved = false;
        achievedAt = null;
      }
      const deadlineDateVal = isDeadline && deadlineDate !== undefined ? deadlineDate : null;
      await dbRun(
        'UPDATE commitments SET text = ?, enabled = ?, doneToday = ?, schedule = ?, scheduleDays = ?, reminderEnabled = ?, reminderTime = ?, weeklyTarget = ?, streak = ?, lastDone = ?, label = ?, target = ?, achieved = ?, achievedAt = ?, createdAt = COALESCE(?, createdAt), scope = ?, deadlineDate = COALESCE(?, deadlineDate), lastLoggedAt = COALESCE(?, lastLoggedAt) WHERE id = ?',
        [text, enabled?1:0, doneToday?1:0, effectiveSchedule||null, effectiveScheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, newStreak, newLast, label||null, targetVal||null, achieved?1:0, achievedAt, createdAt||null, scopeVal, deadlineDateVal, lastLoggedAt||null, id]
      );

      // XP only moves on an actual done/undone transition, not a resend of
      // the same state -- avoids double-counting from retried pushes. A
      // joint commitment credits/debits both people, since you did it together.
      const wasDone = !!row.doneToday;
      let xp = null;
      if(doneToday !== wasDone){
        const delta = doneToday ? 10 : -10;
        if(isJoint){
          await dbRun("UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE LOWER(name) IN ('anna','jordan')", [delta]);
        } else {
          await dbRun('UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE id = ?', [delta, req.user.id]);
        }
        const xpRow = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
        xp = xpRow ? xpRow.xp : null;
      }
      res.json({ success:true, streak:newStreak, lastDone:newLast, achieved, achievedAt, xp });
    } else {
      const deadlineDateVal = schedule === 'deadline' && deadlineDate !== undefined ? deadlineDate : null;
      await dbRun(
        'UPDATE commitments SET text = ?, enabled = ?, schedule = ?, scheduleDays = ?, reminderEnabled = ?, reminderTime = ?, weeklyTarget = ?, label = ?, target = ?, createdAt = COALESCE(?, createdAt), scope = ?, deadlineDate = COALESCE(?, deadlineDate), lastLoggedAt = COALESCE(?, lastLoggedAt) WHERE id = ?',
        [text, enabled?1:0, schedule||null, scheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, label||null, target||null, createdAt||null, scopeVal, deadlineDateVal, lastLoggedAt||null, id]
      );
      res.json({ success: true });
    }
  }catch(e){
    console.error('PUT /api/commitments error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Return history for a commitment (dates). Not scoped to the requester's own
// user_id -- like the rest of GET /api/commitments, viewing the other
// person's history is the point of cross-visibility, not a privacy leak.
app.get('/api/commitments/:id/history', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const rows = await dbAll('SELECT date, count FROM completion_log WHERE commitment_id = ? ORDER BY date DESC', [id]);
    res.json(rows.map(r=>({ date: r.date, count: r.count || 1 })));
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Backfill a SPECIFIC past date as done/undone -- for when you (or your
// partner) genuinely did it but forgot to mark it at the time. Deliberately
// separate from the doneToday PUT branch above (which always operates on
// "today" and recomputes XP off the commitment's live doneToday column,
// which has no meaning for an arbitrary past date) rather than generalizing
// it. Not available for trackers -- their XP is only ever charged in real
// time via /log, and backfilling isn't meant to relitigate that.
app.put('/api/commitments/:id/history/:date', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const date = req.params.date;
  const { done } = req.body;
  try{
    const owner = await dbGet('SELECT user_id, scope, schedule, scheduleDays, target, achieved, achievedAt FROM commitments WHERE id = ?', [id]);
    if(!owner || (owner.user_id !== req.user.id && owner.scope !== 'joint')) return res.status(404).json({ error: 'not found' });
    if(owner.schedule === 'tracker') return res.status(400).json({ error: 'backfilling is not supported for trackers' });
    const today = localDateKey(new Date());
    if(!date || date >= today) return res.status(400).json({ error: 'can only backfill a date before today' });

    const existing = await dbGet('SELECT date FROM completion_log WHERE commitment_id = ? AND date = ?', [id, date]);
    const wasDone = !!existing;
    if(done && !wasDone){
      await dbRun('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1)', [id, req.user.id, date]);
    } else if(!done && wasDone){
      await dbRun('DELETE FROM completion_log WHERE commitment_id = ? AND date = ?', [id, date]);
    }

    const historyRows = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ?', [id]);
    const historyDates = historyRows.map(r => r.date);
    const scheduleDays = owner.scheduleDays ? JSON.parse(owner.scheduleDays) : null;
    const newStreak = computeStreak({ schedule: owner.schedule, scheduleDays }, historyDates, today);
    const newLast = historyDates.length ? historyDates.reduce((a, b) => (a > b ? a : b)) : null;

    let achieved = !!owner.achieved;
    let achievedAt = owner.achievedAt || null;
    if(owner.target && newStreak >= owner.target){
      if(!achieved){ achieved = true; achievedAt = today; }
    } else if(owner.target){
      achieved = false;
      achievedAt = null;
    }
    await dbRun('UPDATE commitments SET streak = ?, lastDone = ?, achieved = ?, achievedAt = ? WHERE id = ?', [newStreak, newLast, achieved?1:0, achievedAt, id]);

    // Refunds a life if this backfilled day (or its week, for a
    // weekly-target schedule) had already cost one and is now fully
    // compliant -- see reevaluatePastDayForUser()'s comment. Only the
    // done-and-wasn't-before direction can ever refund anything.
    if(done && !wasDone){
      if(owner.scope === 'joint'){
        const bothUsers = await dbAll("SELECT id FROM users WHERE LOWER(name) IN ('anna','jordan')");
        for(const u of bothUsers) await reevaluatePastDayForUser(u.id, date);
      } else {
        await reevaluatePastDayForUser(owner.user_id, date);
      }
    }

    // Same 10 XP as marking a habit done/undone live -- a backfilled day
    // that genuinely happened earns the same credit, just late.
    let xp = null;
    if(done !== wasDone){
      const delta = done ? 10 : -10;
      const isJoint = owner.scope === 'joint';
      if(isJoint){
        await dbRun("UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE LOWER(name) IN ('anna','jordan')", [delta]);
      } else {
        await dbRun('UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE id = ?', [delta, req.user.id]);
      }
      const xpRow = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
      xp = xpRow ? xpRow.xp : null;
    }

    res.json({ success: true, streak: newStreak, lastDone: newLast, achieved, achievedAt, xp });
  }catch(e){
    console.error('PUT /api/commitments/:id/history/:date error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Reset a tracker's running clock -- unlike doneToday (a toggle, one row per
// day), a tracker can be logged multiple times a day and never "undone" the
// same way, so it gets its own endpoint rather than overloading the
// doneToday PUT semantics. Still writes to completion_log (incrementing
// count on a repeat same-day log) so the existing History heatmap works for
// trackers for free. Whether it costs a LIFE is decided by the client's
// usual daily evaluation once today is fully in the past (see
// isTrackerCompliantOnDay in schedule-utils.js), same timing as any other
// missed habit -- but XP is docked immediately here, since logging is a
// discrete action, same as marking a normal habit done/undone.
app.post('/api/commitments/:id/log', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const commit = await dbGet('SELECT id, user_id, scope FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    if(commit.scope !== 'joint' && commit.user_id !== req.user.id) return res.status(403).json({ error: 'not yours' });
    const today = localDateKey(new Date());
    const nowIso = new Date().toISOString();
    await dbRun('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1) ON CONFLICT(commitment_id, date) DO UPDATE SET count = count + 1', [id, req.user.id, today]);
    await dbRun('UPDATE commitments SET lastLoggedAt = ? WHERE id = ?', [nowIso, id]);

    // Same 10 XP debit as undoing a normal habit -- a joint tracker docks
    // both people, since it's shared.
    const isJoint = commit.scope === 'joint';
    if(isJoint){
      await dbRun("UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE LOWER(name) IN ('anna','jordan')", [-10]);
    } else {
      await dbRun('UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE id = ?', [-10, req.user.id]);
    }
    const xpRow = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
    res.json({ lastLoggedAt: nowIso, xp: xpRow ? xpRow.xp : null });
  }catch(e){
    console.error('tracker log error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Awards the daily XP trickle for a tracker's compliant (non-logged) days --
// the flip side of the -10 debit in the /log endpoint above. Computed from
// scratch against completion_log each time rather than incrementally, using
// xpAwardedThroughDate as a watermark so a day is never paid out twice; only
// days strictly after that watermark and up to yesterday are eligible, since
// today isn't over yet (same boundary the client's own daily life-loss
// evaluation uses). A relapse still costs its XP immediately via /log, but
// it doesn't claw back days already paid out here -- past compliant days
// stay earned.
const TRACKER_DAILY_XP = 10;
app.post('/api/commitments/:id/tracker-xp', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const commit = await dbGet('SELECT id, user_id, scope, schedule, createdAt, xpAwardedThroughDate FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    if(commit.scope !== 'joint' && commit.user_id !== req.user.id) return res.status(403).json({ error: 'not yours' });
    if(commit.schedule !== 'tracker') return res.status(400).json({ error: 'not a tracker' });

    const today = localDateKey(new Date());
    const yesterday = prevLocalDate(today);
    const from = commit.xpAwardedThroughDate ? nextLocalDate(commit.xpAwardedThroughDate) : (commit.createdAt || today);

    let delta = 0;
    if(from && yesterday && from <= yesterday){
      const historyRows = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ?', [id]);
      const historyDates = historyRows.map(r => r.date);
      delta = countTrackerCompliantDays(historyDates, from, yesterday) * TRACKER_DAILY_XP;
      if(delta > 0){
        const isJoint = commit.scope === 'joint';
        if(isJoint){
          await dbRun("UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE LOWER(name) IN ('anna','jordan')", [delta]);
        } else {
          await dbRun('UPDATE users SET xp = MAX(0, COALESCE(xp,0) + ?) WHERE id = ?', [delta, req.user.id]);
        }
      }
      await dbRun('UPDATE commitments SET xpAwardedThroughDate = ? WHERE id = ?', [yesterday, id]);
    }

    const xpRow = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
    res.json({ xp: xpRow ? xpRow.xp : null, xpAwarded: delta });
  }catch(e){
    console.error('tracker xp sync error', e);
    res.status(500).json({ error: 'db' });
  }
});

app.delete('/api/commitments/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const owned = await dbGet('SELECT id, scope FROM commitments WHERE id = ? AND (user_id = ? OR scope = \'joint\')', [id, req.user.id]);
    if(!owned) return res.status(404).json({ error: 'not found' });
    // @libsql/client enforces foreign keys (sqlite3 didn't), so child rows
    // have to go first -- there's no ON DELETE CASCADE on these tables.
    await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM paw_log WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM comments WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM commitments WHERE id = ?', [id]);
    res.json({ success: true });
  }catch(e){
    console.error('DELETE /api/commitments error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Give a paw to someone else's habit. Capped at one per commitment per day by
// the paw_log UNIQUE(commitment_id, date) constraint -- a second attempt the
// same day is treated as a harmless no-op rather than an error. Joint
// commitments don't take paws -- there's no "other person" to encourage
// when you both already did it together.
app.post('/api/commitments/:id/paws', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const commit = await dbGet('SELECT id, user_id, scope FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    if(commit.scope === 'joint') return res.status(400).json({ error: "can't paw a joint commitment" });
    if(commit.user_id === req.user.id) return res.status(403).json({ error: "can't paw your own habit" });

    const today = localDateKey(new Date());
    try{
      await dbRun('INSERT INTO paw_log (commitment_id, giver_user_id, date) VALUES (?,?,?)', [id, req.user.id, today]);
    }catch(e){
      // UNIQUE(commitment_id, date) violation -- already pawed today.
    }

    const pawCountRow = await dbGet('SELECT COUNT(*) as count FROM paw_log WHERE commitment_id = ?', [id]);
    const lastPaw = await dbGet(`SELECT p.date, u.name as byName FROM paw_log p JOIN users u ON u.id = p.giver_user_id
           WHERE p.commitment_id = ? ORDER BY p.date DESC LIMIT 1`, [id]);
    res.json({ pawCount: pawCountRow.count, lastPaw: lastPaw ? { date: lastPaw.date, by: lastPaw.byName } : null });
  }catch(e){
    console.error('paw error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Add an encouragement note to a commitment (either person may comment).
app.post('/api/commitments/:id/comments', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const text = ((req.body && req.body.text) || '').trim();
  if(!text) return res.status(400).json({ error: 'text required' });
  try{
    const commit = await dbGet('SELECT id FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    await dbRun('INSERT INTO comments (commitment_id, user_id, text, created_at) VALUES (?,?,?,?)', [id, req.user.id, text, new Date().toISOString()]);
    const lastComment = await dbGet(`SELECT cm.text, cm.created_at as createdAt, u.name as byName FROM comments cm
           JOIN users u ON u.id = cm.user_id WHERE cm.commitment_id = ? ORDER BY cm.created_at DESC LIMIT 1`, [id]);
    res.json({ lastComment: lastComment ? { text: lastComment.text, by: lastComment.byName, at: lastComment.createdAt } : null });
  }catch(e){
    console.error('comment error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Full comment thread for a commitment.
app.get('/api/commitments/:id/comments', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const rows = await dbAll(`SELECT cm.text, cm.created_at as createdAt, u.name as byName FROM comments cm
           JOIN users u ON u.id = cm.user_id WHERE cm.commitment_id = ? ORDER BY cm.created_at DESC`, [id]);
    res.json(rows.map(r => ({ text: r.text, by: r.byName, at: r.createdAt })));
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Propose a commitment for the other person. Resolved by name rather than
// "whoever isn't me" -- this app is meant for exactly Anna and Jordan, and
// naming the recipient explicitly avoids ever routing a suggestion to a
// stray/leftover account if one exists.
app.post('/api/suggestions', authMiddleware, async (req,res)=>{
  const { text, schedule, scheduleDays, label } = req.body;
  if(!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  try{
    const myName = (req.user.name || '').toLowerCase();
    const otherName = myName === 'anna' ? 'jordan' : (myName === 'jordan' ? 'anna' : null);
    const toUser = otherName ? await dbGet('SELECT id, name FROM users WHERE LOWER(name) = ?', [otherName]) : null;
    if(!toUser) return res.status(400).json({ error: 'no one to suggest this to yet' });
    const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
    const result = await dbRun(
      'INSERT INTO commitment_suggestions (from_user_id, to_user_id, text, schedule, scheduleDays, label, status) VALUES (?,?,?,?,?,?,\'pending\')',
      [req.user.id, toUser.id, text.trim(), schedule || 'daily', scheduleDaysJson, label || null]
    );
    const rows = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [toUser.id]);
    if(rows.length){
      const payload = JSON.stringify({ title: 'Good Cat 🐾', body: `${req.user.name} suggested a commitment: "${text.trim()}"`, tag: 'suggestion-' + result.lastID });
      sendPushToSubscriptions(rows, payload).catch(()=>{});
    }
    res.json({ id: result.lastID, toUserId: toUser.id, toUserName: toUser.name });
  }catch(e){
    console.error('POST /api/suggestions error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Suggestions waiting on ME to accept/amend/reject.
app.get('/api/suggestions', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll(`
      SELECT s.id, s.text, s.schedule, s.scheduleDays, s.label, s.created_at as createdAt, u.name as fromName
      FROM commitment_suggestions s JOIN users u ON u.id = s.from_user_id
      WHERE s.to_user_id = ? AND s.status = 'pending'
      ORDER BY s.created_at ASC
    `, [req.user.id]);
    res.json(rows.map(r => ({
      id: r.id, text: r.text, schedule: r.schedule || 'daily',
      scheduleDays: r.scheduleDays ? JSON.parse(r.scheduleDays) : null,
      label: r.label || null, createdAt: r.createdAt, fromName: r.fromName
    })));
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Accept as-is, or with overrides from an "amend and accept" edit -- either
// way it becomes a real commitment owned by the recipient.
app.post('/api/suggestions/:id/accept', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const suggestion = await dbGet('SELECT * FROM commitment_suggestions WHERE id = ? AND to_user_id = ? AND status = \'pending\'', [id, req.user.id]);
    if(!suggestion) return res.status(404).json({ error: 'not found' });
    const overrides = req.body || {};
    const text = (overrides.text || suggestion.text || '').trim();
    const schedule = overrides.schedule || suggestion.schedule || 'daily';
    const scheduleDays = overrides.scheduleDays !== undefined ? overrides.scheduleDays : (suggestion.scheduleDays ? JSON.parse(suggestion.scheduleDays) : null);
    const label = overrides.label !== undefined ? overrides.label : suggestion.label;
    const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
    const weeklyTarget = schedule === 'once' ? 1 : (schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null)));
    const createdAtVal = localDateKey(new Date());
    const result = await dbRun(
      'INSERT INTO commitments (user_id,text,enabled,doneToday,schedule,scheduleDays,weeklyTarget,streak,lastDone,label,createdAt) VALUES (?,?,1,0,?,?,?,0,NULL,?,?)',
      [req.user.id, text, schedule, scheduleDaysJson, weeklyTarget, label || null, createdAtVal]
    );
    await dbRun('DELETE FROM commitment_suggestions WHERE id = ?', [id]);
    res.json({
      id: result.lastID, text, enabled: true, doneToday: false, schedule, scheduleDays,
      weeklyTarget, streak: 0, lastDone: null, label: label || null, createdAt: createdAtVal
    });
  }catch(e){
    console.error('POST /api/suggestions/:id/accept error', e);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/suggestions/:id/reject', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const owned = await dbGet('SELECT id FROM commitment_suggestions WHERE id = ? AND to_user_id = ?', [id, req.user.id]);
    if(!owned) return res.status(404).json({ error: 'not found' });
    await dbRun('DELETE FROM commitment_suggestions WHERE id = ?', [id]);
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// --- Pausing a commitment closes off its life-loss/leaderboard/reminder
// stakes -- for a joint commitment especially, not something one person
// should be able to do unilaterally to something you're both on the hook
// for. Pausing goes through a request the OTHER person has to approve; the
// commitment stays fully enforced while it's pending. Resuming (below, in
// the ordinary PUT /api/commitments/:id handler) stays instant -- only
// opting OUT needs the gate, not opting back in. ---
app.post('/api/commitments/:id/pause-request', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const commit = await dbGet('SELECT id, user_id, scope, enabled, text FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
    if(commit.scope !== 'joint' && commit.user_id !== req.user.id) return res.status(403).json({ error: 'not yours' });
    if(!commit.enabled) return res.status(400).json({ error: 'already paused' });
    const existing = await dbGet("SELECT id FROM pause_requests WHERE commitment_id = ? AND status = 'pending'", [id]);
    if(existing) return res.status(409).json({ error: 'a pause request is already pending for this' });
    const result = await dbRun("INSERT INTO pause_requests (commitment_id, requested_by, status) VALUES (?,?,'pending')", [id, req.user.id]);
    const myName = (req.user.name || '').toLowerCase();
    const otherName = myName === 'anna' ? 'jordan' : (myName === 'jordan' ? 'anna' : null);
    if(otherName){
      const other = await dbGet('SELECT id FROM users WHERE LOWER(name) = ?', [otherName]);
      if(other){
        const rows = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [other.id]);
        if(rows.length){
          const payload = JSON.stringify({ title: 'Good Cat 🐾', body: `${req.user.name} wants to pause "${commit.text}"`, tag: 'pause-request-' + result.lastID });
          sendPushToSubscriptions(rows, payload).catch(()=>{});
        }
      }
    }
    res.json({ id: result.lastID, status: 'pending' });
  }catch(e){
    console.error('POST /api/commitments/:id/pause-request error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Pause requests waiting on ME to approve/decline -- since this app is
// exactly two people, any pending request not made by me is inherently one
// only I can act on.
app.get('/api/pause-requests', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll(`
      SELECT pr.id, pr.commitment_id as commitmentId, c.text as commitmentText, u.name as fromName
      FROM pause_requests pr
      JOIN commitments c ON c.id = pr.commitment_id
      JOIN users u ON u.id = pr.requested_by
      WHERE pr.status = 'pending' AND pr.requested_by != ?
      ORDER BY pr.created_at ASC
    `, [req.user.id]);
    res.json(rows);
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/pause-requests/:id/approve', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const request = await dbGet("SELECT id, commitment_id, requested_by, status FROM pause_requests WHERE id = ?", [id]);
    if(!request || request.status !== 'pending') return res.status(404).json({ error: 'not found' });
    if(request.requested_by === req.user.id) return res.status(403).json({ error: 'cannot approve your own request' });
    await dbRun('UPDATE commitments SET enabled = 0 WHERE id = ?', [request.commitment_id]);
    await dbRun("UPDATE pause_requests SET status = 'approved' WHERE id = ?", [id]);
    res.json({ success: true });
  }catch(e){
    console.error('POST /api/pause-requests/:id/approve error', e);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/pause-requests/:id/decline', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const request = await dbGet("SELECT id, requested_by, status FROM pause_requests WHERE id = ?", [id]);
    if(!request || request.status !== 'pending') return res.status(404).json({ error: 'not found' });
    if(request.requested_by === req.user.id) return res.status(403).json({ error: 'cannot decline your own request' });
    await dbRun("UPDATE pause_requests SET status = 'declined' WHERE id = ?", [id]);
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// The requester withdrawing their own still-pending request.
app.post('/api/pause-requests/:id/cancel', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const request = await dbGet("SELECT id, requested_by, status FROM pause_requests WHERE id = ?", [id]);
    if(!request || request.status !== 'pending') return res.status(404).json({ error: 'not found' });
    if(request.requested_by !== req.user.id) return res.status(403).json({ error: 'not your request' });
    await dbRun("UPDATE pause_requests SET status = 'cancelled' WHERE id = ?", [id]);
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Self-service progress reset -- for trying the app out and wanting a clean
// slate, NOT an escape hatch from ordinary missed habits, so it's capped to
// once every 30 days per person. Only ever touches the caller's own
// commitments/XP: zeroes streak, achieved status, and completion history,
// and resets XP to 0. Leaves the commitments themselves (so nothing has to
// be re-created), and leaves paws/comments (those are the other person's
// messages, not "progress").
const RESET_COOLDOWN_DAYS = 30;
app.post('/api/me/reset', authMiddleware, async (req,res)=>{
  try{
    const row = await dbGet('SELECT lastProgressReset FROM users WHERE id = ?', [req.user.id]);
    if(row && row.lastProgressReset){
      const daysSince = (Date.now() - new Date(row.lastProgressReset).getTime()) / (1000*60*60*24);
      if(daysSince < RESET_COOLDOWN_DAYS){
        const daysLeft = Math.ceil(RESET_COOLDOWN_DAYS - daysSince);
        return res.status(429).json({ error: `You can only reset your progress once every ${RESET_COOLDOWN_DAYS} days. Try again in ${daysLeft} day${daysLeft===1?'':'s'}.` });
      }
    }
    // Excludes joint commitments even when the resetter happens to be the
    // one who created it -- a joint commitment's history/streak belongs to
    // both people, and "reset MY progress" wiping shared data as a side
    // effect (which the other person would then pull down on their next
    // sync) is not what either person asked for.
    const commits = await dbAll("SELECT id FROM commitments WHERE user_id = ? AND scope != 'joint'", [req.user.id]);
    for(const c of commits){
      await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [c.id]);
    }
    await dbRun(
      "UPDATE commitments SET streak = 0, doneToday = 0, lastDone = NULL, achieved = 0, achievedAt = NULL, lastReminderSent = NULL WHERE user_id = ? AND scope != 'joint'",
      [req.user.id]
    );
    await dbRun('UPDATE users SET xp = 0, lives = ?, lifeCouncilAck = 0, lastProgressReset = ? WHERE id = ?', [MAX_LIVES, new Date().toISOString(), req.user.id]);
    await dbRun('DELETE FROM life_events WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  }catch(e){
    console.error('POST /api/me/reset error', e);
    res.status(500).json({ error: 'db' });
  }
});

// "Start fresh" -- a genuine joint wipe, unlike /api/me/reset above: deletes
// every commitment for BOTH people (personal and joint), along with their
// history/comments/paws/pending pause-requests, plus any pending
// suggestions, and zeroes both people's XP and resets both people's lives
// to MAX_LIVES. Deliberately not scoped to the caller's own data -- this is
// for "we agreed to start over," not a per-person escape hatch, so no
// cooldown either. Leaves accounts, todos, and the shopping list untouched.
app.post('/api/reset-everything', authMiddleware, async (req,res)=>{
  try{
    const commits = await dbAll('SELECT id FROM commitments');
    for(const c of commits){
      await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM paw_log WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM comments WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM pause_requests WHERE commitment_id = ?', [c.id]);
    }
    await dbRun('DELETE FROM commitments');
    await dbRun('DELETE FROM commitment_suggestions');
    await dbRun('UPDATE users SET xp = 0, lives = ?, lifeCouncilAck = 0, lifeLastEvaluatedDate = NULL', [MAX_LIVES]);
    await dbRun('DELETE FROM life_events');
    res.json({ success: true });
  }catch(e){
    console.error('POST /api/reset-everything error', e);
    res.status(500).json({ error: 'db' });
  }
});

// This week's completion rate per person, Mon-Sun, for the leaderboard.
app.get('/api/leaderboard/weekly', authMiddleware, async (req,res)=>{
  try{
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // 0=Mon..6=Sun
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    const weekDates = Array.from({length:7}, (_,i)=>{
      const d = new Date(monday); d.setDate(monday.getDate()+i); return localDateKey(d);
    });
    const todayKey = localDateKey(now);
    const weekDatesSoFar = weekDates.filter(d => d <= todayKey);

    // This app is meant for exactly Anna and Jordan -- anything else in the
    // users table is a stray/test account (registration has no allow-list;
    // see the security review), and shouldn't show up here.
    const users = (await dbAll('SELECT id, name FROM users')).filter(u => ['anna','jordan'].includes((u.name||'').toLowerCase()));
    const result = {};
    for(const user of users){
      const commits = await dbAll("SELECT id, schedule, scheduleDays, deadlineDate FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1", [user.id]);
      let scheduled = 0, completed = 0;
      for(const c of commits){
        // A one-off deadline commitment only counts in the week its deadline
        // falls in, and "completed" means it was ever marked done at all --
        // not specifically on the deadline date, since it may well have been
        // finished early. See the PUT handler's single-row completion_log
        // handling for deadline commitments.
        if(c.schedule === 'deadline'){
          if(!c.deadlineDate || !weekDatesSoFar.includes(c.deadlineDate)) continue;
          scheduled += 1;
          const doneRow = await dbGet('SELECT COUNT(*) as count FROM completion_log WHERE commitment_id = ?', [c.id]);
          if(doneRow && doneRow.count > 0) completed += 1;
          continue;
        }
        // A tracker is due every day, same as daily, but completion_log
        // rows mark LOGGED (bad) days -- inverted from every other schedule
        // type here, where a completion_log row means the day went well.
        if(c.schedule === 'tracker'){
          const dueDates = weekDatesSoFar;
          if(!dueDates.length) continue;
          scheduled += dueDates.length;
          const rows = await dbAll(
            `SELECT date FROM completion_log WHERE commitment_id = ? AND date IN (${dueDates.map(()=>'?').join(',')})`,
            [c.id, ...dueDates]
          );
          const loggedDates = new Set(rows.map(r => r.date));
          completed += dueDates.filter(d => !loggedDates.has(d)).length;
          continue;
        }
        const scheduleDays = c.scheduleDays ? JSON.parse(c.scheduleDays) : null;
        const dueDates = weekDatesSoFar.filter(d => isScheduledDay({ schedule: c.schedule, scheduleDays }, d));
        if(!dueDates.length) continue;
        scheduled += dueDates.length;
        const rows = await dbAll(
          `SELECT date FROM completion_log WHERE commitment_id = ? AND date IN (${dueDates.map(()=>'?').join(',')})`,
          [c.id, ...dueDates]
        );
        completed += rows.length;
      }
      const rate = scheduled > 0 ? completed / scheduled : null;
      result[user.name.toLowerCase()] = { scheduled, completed, rate, hitTarget: scheduled > 0 && completed >= scheduled };
    }
    res.json({ weekStart: weekDates[0], users: result });
  }catch(e){
    console.error('GET /api/leaderboard/weekly error', e);
    res.status(500).json({ error: 'db' });
  }
});

// --- Wellbeing check-in: a short, rotating prompt (one category at a time,
// cycling through LABEL_CATEGORIES) roughly every two weeks per person. ---
const WELLBEING_INTERVAL_DAYS = 14;

app.get('/api/wellbeing/prompt', authMiddleware, async (req,res)=>{
  try{
    const row = await dbGet('SELECT lastWellbeingCheckDate, wellbeingCategoryIndex FROM users WHERE id = ?', [req.user.id]);
    const last = row ? row.lastWellbeingCheckDate : null;
    let due = true;
    if(last){
      const daysSince = (Date.now() - new Date(last).getTime()) / (1000*60*60*24);
      due = daysSince >= WELLBEING_INTERVAL_DAYS;
    }
    const index = ((row && row.wellbeingCategoryIndex) || 0) % LABEL_CATEGORIES.length;
    res.json({ due, category: due ? LABEL_CATEGORIES[index] : null });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/wellbeing/respond', authMiddleware, async (req,res)=>{
  const { rating } = req.body;
  if(!['low','okay','good'].includes(rating)) return res.status(400).json({ error: 'rating must be low, okay, or good' });
  try{
    const row = await dbGet('SELECT lastWellbeingCheckDate, wellbeingCategoryIndex FROM users WHERE id = ?', [req.user.id]);
    const last = row ? row.lastWellbeingCheckDate : null;
    // Recompute "due" server side rather than trusting the client -- stops
    // the rotation from being advanced more than once per interval by a
    // stray or repeated request.
    let due = true;
    if(last){
      const daysSince = (Date.now() - new Date(last).getTime()) / (1000*60*60*24);
      due = daysSince >= WELLBEING_INTERVAL_DAYS;
    }
    if(!due) return res.status(429).json({ error: 'No check-in due right now.' });
    const index = ((row && row.wellbeingCategoryIndex) || 0) % LABEL_CATEGORIES.length;
    const category = LABEL_CATEGORIES[index];
    const nextIndex = (index + 1) % LABEL_CATEGORIES.length;
    await dbRun('UPDATE users SET lastWellbeingCheckDate = ?, wellbeingCategoryIndex = ? WHERE id = ?', [new Date().toISOString(), nextIndex, req.user.id]);
    res.json({ success: true, category, rating });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// --- Shared to-do list: a single joint checklist, not per-person -- anyone
// can add, check off, or delete any item. ---
app.get('/api/todos', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll(`
      SELECT t.id, t.text, t.done, t.created_at as createdAt, t.done_at as doneAt, u.name as createdByName
      FROM todos t JOIN users u ON u.id = t.created_by
      ORDER BY t.done ASC, t.created_at ASC
    `);
    res.json(rows.map(r => ({ id: r.id, text: r.text, done: !!r.done, createdAt: r.createdAt, doneAt: r.doneAt, createdByName: r.createdByName })));
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/todos', authMiddleware, async (req,res)=>{
  const text = ((req.body && req.body.text) || '').trim();
  if(!text) return res.status(400).json({ error: 'text required' });
  try{
    const result = await dbRun('INSERT INTO todos (text, done, created_by, created_at) VALUES (?,0,?,?)', [text, req.user.id, new Date().toISOString()]);
    res.json({ id: result.lastID, text, done: false, createdAt: new Date().toISOString(), doneAt: null, createdByName: req.user.name });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.put('/api/todos/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const { done } = req.body;
  try{
    const existing = await dbGet('SELECT id FROM todos WHERE id = ?', [id]);
    if(!existing) return res.status(404).json({ error: 'not found' });
    const doneAt = done ? new Date().toISOString() : null;
    await dbRun('UPDATE todos SET done = ?, done_at = ? WHERE id = ?', [done?1:0, doneAt, id]);
    res.json({ success: true, doneAt });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.delete('/api/todos/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    await dbRun('DELETE FROM todos WHERE id = ?', [id]);
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// --- Shared shopping list -- same shape and rules as the to-do list above
// (anyone can add, check off, or delete any item), kept as its own list
// rather than mixed into todos since groceries and general tasks don't
// belong in the same list. The one thing genuinely specific to a shopping
// list: a bulk "clear checked" for once the shop's actually done, rather
// than deleting items off one at a time. ---
app.get('/api/shopping-items', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll(`
      SELECT s.id, s.text, s.done, s.created_at as createdAt, s.done_at as doneAt, u.name as createdByName
      FROM shopping_items s JOIN users u ON u.id = s.created_by
      ORDER BY s.done ASC, s.created_at ASC
    `);
    res.json(rows.map(r => ({ id: r.id, text: r.text, done: !!r.done, createdAt: r.createdAt, doneAt: r.doneAt, createdByName: r.createdByName })));
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/shopping-items', authMiddleware, async (req,res)=>{
  const text = ((req.body && req.body.text) || '').trim();
  if(!text) return res.status(400).json({ error: 'text required' });
  try{
    const result = await dbRun('INSERT INTO shopping_items (text, done, created_by, created_at) VALUES (?,0,?,?)', [text, req.user.id, new Date().toISOString()]);
    res.json({ id: result.lastID, text, done: false, createdAt: new Date().toISOString(), doneAt: null, createdByName: req.user.name });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.put('/api/shopping-items/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const { done } = req.body;
  try{
    const existing = await dbGet('SELECT id FROM shopping_items WHERE id = ?', [id]);
    if(!existing) return res.status(404).json({ error: 'not found' });
    const doneAt = done ? new Date().toISOString() : null;
    await dbRun('UPDATE shopping_items SET done = ?, done_at = ? WHERE id = ?', [done?1:0, doneAt, id]);
    res.json({ success: true, doneAt });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.delete('/api/shopping-items/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    await dbRun('DELETE FROM shopping_items WHERE id = ?', [id]);
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

// Bulk-clears every checked item at once -- for after the shop is actually
// done, rather than deleting each one individually.
app.post('/api/shopping-items/clear-checked', authMiddleware, async (req,res)=>{
  try{
    await dbRun('DELETE FROM shopping_items WHERE done = 1');
    res.json({ success: true });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

function shouldSendReminder(commit, now){
  if(!commit.reminderEnabled || !commit.reminderTime || !commit.enabled) return false;
  const todayKey = localDateKey(now);
  if(commit.lastReminderSent === todayKey) return false;
  if(!isScheduledDay(commit, todayKey)) return false;
  const [hh, mm] = commit.reminderTime.split(':').map(Number);
  return now.getHours() === hh && now.getMinutes() === mm;
}

function sendPushToSubscriptions(subscriptions, payload){
  return Promise.all(subscriptions.map(r=>{
    let sub;
    try{ sub = JSON.parse(r.subscription); } catch(e){ return Promise.resolve({ ok:false, error:'invalid subscription' }); }
    return webpush.sendNotification(sub, payload).then(()=>({ ok:true })).catch(err=>({ ok:false, error: String(err) }));
  }));
}

async function checkDueReminders(){
  const now = new Date();
  try{
    const commits = await dbAll('SELECT id, user_id, text, reminderEnabled, reminderTime, schedule, scheduleDays, deadlineDate, enabled, lastReminderSent, scope FROM commitments WHERE reminderEnabled = 1 AND reminderTime IS NOT NULL');
    for(const commit of commits){
      commit.scheduleDays = commit.scheduleDays ? JSON.parse(commit.scheduleDays) : null;
      if(!shouldSendReminder(commit, now)) continue;
      // A joint commitment's reminder goes to both people, not just whoever created it.
      const rows = commit.scope === 'joint'
        ? await dbAll("SELECT ps.subscription FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE LOWER(u.name) IN ('anna','jordan')")
        : await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [commit.user_id]);
      if(!rows.length) continue;
      const payload = JSON.stringify({ title: 'Good Cat Reminder', body: `Time for: ${commit.text}`, tag: `reminder-${commit.id}` });
      await sendPushToSubscriptions(rows, payload);
      await dbRun('UPDATE commitments SET lastReminderSent = ? WHERE id = ?', [localDateKey(now), commit.id]);
    }
  }catch(e){
    console.error('checkDueReminders error', e);
  }
}

setInterval(checkDueReminders, 60 * 1000);
checkDueReminders();

// One nightly nudge per person, separate from per-commitment reminders --
// only fires if something scheduled for today is still unmarked, and only
// once/day (tracked via users.lastEndOfDaySent) regardless of whether a
// push subscription existed to actually deliver it.
const END_OF_DAY_HOUR = 22;
async function checkEndOfDayReminders(){
  const now = new Date();
  if(now.getHours() !== END_OF_DAY_HOUR || now.getMinutes() !== 0) return;
  const today = localDateKey(now);
  try{
    const users = await dbAll('SELECT id, lastEndOfDaySent FROM users');
    for(const user of users){
      if(user.lastEndOfDaySent === today) continue;
      await dbRun('UPDATE users SET lastEndOfDaySent = ? WHERE id = ?', [today, user.id]);
      const commits = await dbAll("SELECT schedule, scheduleDays, deadlineDate, doneToday FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1", [user.id]);
      // A tracker's doneToday column is never updated (the /log endpoint
      // only touches lastLoggedAt and completion_log), and it's due every
      // day now -- without this exclusion every tracker would look
      // "incomplete" here every single night regardless of whether it was
      // actually logged.
      const incomplete = commits.some(c => c.schedule !== 'tracker' && isScheduledDay({ schedule: c.schedule, scheduleDays: c.scheduleDays ? JSON.parse(c.scheduleDays) : null, deadlineDate: c.deadlineDate }, today) && !c.doneToday);
      if(!incomplete) continue;
      const rows = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [user.id]);
      if(!rows.length) continue;
      const payload = JSON.stringify({ title: 'Good Cat 🐾', body: "Don't forget to fill out today's commitments!", tag: 'end-of-day' });
      await sendPushToSubscriptions(rows, payload);
    }
  }catch(e){
    console.error('checkEndOfDayReminders error', e);
  }
}

setInterval(checkEndOfDayReminders, 60 * 1000);
checkEndOfDayReminders();

// Once a week (Sunday evening), nudge anyone with a completely empty
// category -- e.g. nothing at all labeled "Home" -- so gaps in the habit
// spread don't go unnoticed indefinitely. Tracked via
// users.lastWeeklyCategoryCheck (the week's Monday date) so it only fires once.
async function checkWeeklyCategoryGaps(){
  const now = new Date();
  if(now.getDay() !== 0 || now.getHours() !== 18 || now.getMinutes() !== 0) return; // Sunday 6pm
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const weekStartIso = localDateKey(monday);
  try{
    const users = await dbAll('SELECT id, lastWeeklyCategoryCheck FROM users');
    for(const user of users){
      if(user.lastWeeklyCategoryCheck === weekStartIso) continue;
      await dbRun('UPDATE users SET lastWeeklyCategoryCheck = ? WHERE id = ?', [weekStartIso, user.id]);
      const rows = await dbAll("SELECT DISTINCT label FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1 AND label IS NOT NULL", [user.id]);
      const present = new Set(rows.map(r => r.label));
      const missing = LABEL_CATEGORIES.filter(l => !present.has(l));
      if(!missing.length) continue;
      const subs = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [user.id]);
      if(!subs.length) continue;
      const body = missing.length === 1
        ? `You haven't committed to anything in ${missing[0]}.`
        : `You haven't committed to anything in: ${missing.join(', ')}.`;
      const payload = JSON.stringify({ title: 'Good Cat 🐾', body, tag: 'weekly-category-gap' });
      await sendPushToSubscriptions(subs, payload);
    }
  }catch(e){
    console.error('checkWeeklyCategoryGaps error', e);
  }
}

setInterval(checkWeeklyCategoryGaps, 60 * 1000);
checkWeeklyCategoryGaps();

// Boop: a gentle once-a-day nudge, separate from the per-commitment and
// end-of-day reminders above. Two triggers -- (a) it's this person's chosen
// evening hour and something scheduled today is still unlogged, or (b) they
// haven't opened the app in 2+ days -- both gated by the same rules: opt-in,
// quiet hours (00:00-08:00), max one per day, and never if everything
// scheduled today is already done. The actual open-app-vs-closed-app
// branching (animated in-app vs plain OS notification) happens client-side
// in service-worker.js's push handler; this just decides WHETHER to send.
const DEFAULT_BOOP_HOUR = 20;
const BOOP_INACTIVITY_DAYS = 2;
async function checkBoop(){
  const now = new Date();
  if(now.getHours() < 8) return; // quiet hours -- skip the whole pass
  const today = localDateKey(now);
  try{
    const users = await dbAll('SELECT id, boopEnabled, boopHour, lastBoopSent, lastSeenAt FROM users');
    for(const user of users){
      if(!user.boopEnabled) continue;
      if(user.lastBoopSent === today) continue; // once/day cap

      const boopHour = Number.isInteger(user.boopHour) ? user.boopHour : DEFAULT_BOOP_HOUR;
      const eveningTrigger = now.getHours() === boopHour && now.getMinutes() === 0;
      const daysSinceSeen = user.lastSeenAt ? (now - new Date(user.lastSeenAt)) / (1000 * 60 * 60 * 24) : Infinity;
      const inactivityTrigger = daysSinceSeen >= BOOP_INACTIVITY_DAYS;
      if(!eveningTrigger && !inactivityTrigger) continue;

      const commits = await dbAll("SELECT schedule, scheduleDays, deadlineDate, doneToday FROM commitments WHERE (user_id = ? OR scope = 'joint') AND enabled = 1", [user.id]);
      const scheduledToday = commits.filter(c => c.schedule !== 'tracker' && isScheduledDay({ schedule: c.schedule, scheduleDays: c.scheduleDays ? JSON.parse(c.scheduleDays) : null, deadlineDate: c.deadlineDate }, today));
      const outstanding = scheduledToday.filter(c => !c.doneToday);

      // Nothing to nudge about: everything scheduled today is already done.
      if(scheduledToday.length > 0 && outstanding.length === 0) continue;
      // The evening trigger is specifically about an unlogged habit -- if
      // there's nothing scheduled at all today, only inactivity can still
      // justify a boop.
      if(eveningTrigger && !inactivityTrigger && outstanding.length === 0) continue;

      const body = outstanding.length === 1 ? 'One thing still outstanding.'
        : outstanding.length > 1 ? `${outstanding.length} things still outstanding.`
        : 'Loki would like a word.';

      const subs = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [user.id]);
      await dbRun('UPDATE users SET lastBoopSent = ? WHERE id = ?', [today, user.id]);
      if(!subs.length) continue;
      const payload = JSON.stringify({ title: 'Good Cat 🐾', body: `Boop. ${body}`, tag: 'boop', boop: true });
      await sendPushToSubscriptions(subs, payload);
    }
  }catch(e){
    console.error('checkBoop error', e);
  }
}

setInterval(checkBoop, 60 * 1000);
checkBoop();

// Lives only ever change based on a day that's already fully over (see
// evaluateLivesForUser's "never judge today" rule), so this doesn't need
// minute-level granularity -- every 15 minutes is plenty, on top of the
// on-demand evaluation GET /api/users already does for freshness.
setInterval(evaluateAllLives, 15 * 60 * 1000);
evaluateAllLives();

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('API listening on', PORT));
