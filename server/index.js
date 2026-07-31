import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import webpush from 'web-push';
import { dbAll, dbGet, dbRun } from './db.js';
import { isScheduledDay, computeStreak, LABEL_CATEGORIES } from '../schedule-utils.js';
import { localDateKey } from '../date-utils.js';

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

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
  try{
    const hash = await bcrypt.hash(password, 10);
    const result = await dbRun('INSERT INTO users (name,password) VALUES (?,?)', [name, hash]);
    const user = { id: result.lastID, name };
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
    const row = await dbGet('SELECT * FROM users WHERE name = ?', [name]);
    if(!row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if(!ok) return res.status(400).json({ error: 'invalid credentials' });
    const user = { id: row.id, name: row.name };
    res.json({ token: sign(user), user });
  }catch(e){
    res.status(400).json({ error: 'invalid credentials' });
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

// Both people's XP, so each phone can show a level badge on both panels
// (mirrors how Lives is already shown for both people on either device).
app.get('/api/users', authMiddleware, async (req,res)=>{
  try{
    const rows = await dbAll('SELECT id, name, xp FROM users');
    res.json(rows.map(r => ({ id: r.id, name: r.name, xp: r.xp || 0 })));
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
    const rows = await dbAll(`
      SELECT c.id, c.text, c.enabled, c.doneToday, c.schedule, c.scheduleDays,
             c.reminderEnabled, c.reminderTime, c.weeklyTarget, c.streak, c.lastDone,
             c.label, c.target, c.achieved, c.achievedAt, c.createdAt, c.user_id as ownerId, u.name as ownerName
      FROM commitments c
      JOIN users u ON u.id = c.user_id
    `);

    const result = await Promise.all(rows.map(async r => {
      const [pawCountRow, lastPaw, lastComment] = await Promise.all([
        dbGet('SELECT COUNT(*) as count FROM paw_log WHERE commitment_id = ?', [r.id]),
        dbGet(`SELECT p.date, u.name as byName FROM paw_log p JOIN users u ON u.id = p.giver_user_id
               WHERE p.commitment_id = ? ORDER BY p.date DESC LIMIT 1`, [r.id]),
        dbGet(`SELECT cm.text, cm.created_at as createdAt, u.name as byName FROM comments cm
               JOIN users u ON u.id = cm.user_id
               WHERE cm.commitment_id = ? ORDER BY cm.created_at DESC LIMIT 1`, [r.id])
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
        ownerId: r.ownerId,
        for: (r.ownerName || '').toLowerCase(),
        mine: r.ownerId === req.user.id,
        pawCount: pawCountRow ? pawCountRow.count : 0,
        lastPaw: lastPaw ? { date: lastPaw.date, by: lastPaw.byName } : null,
        lastComment: lastComment ? { text: lastComment.text, by: lastComment.byName, at: lastComment.createdAt } : null
      };
    }));

    res.json(result);
  }catch(e){
    console.error('GET /api/commitments error', e);
    res.status(500).json({ error: 'db' });
  }
});

app.post('/api/commitments', authMiddleware, async (req,res)=>{
  const { text, enabled, schedule, scheduleDays, reminderEnabled, reminderTime, weeklyTarget, label, target, achieved, achievedAt, createdAt } = req.body;
  const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
  const createdAtVal = createdAt || localDateKey(new Date());
  try{
    const result = await dbRun(
      'INSERT INTO commitments (user_id,text,enabled,doneToday,schedule,scheduleDays,reminderEnabled,reminderTime,weeklyTarget,streak,lastDone,label,target,achieved,achievedAt,createdAt) VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?,?)',
      [req.user.id, text, enabled?1:0, 0, schedule||'daily', scheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, label||null, target||null, achieved?1:0, achievedAt||null, createdAtVal]
    );
    res.json({ id: result.lastID, text, enabled: !!enabled, doneToday:false, schedule: schedule||'daily', scheduleDays: scheduleDays || null, reminderEnabled: !!reminderEnabled, reminderTime: reminderTime || null, weeklyTarget: weeklyTarget || null, streak:0, lastDone:null, label: label||null, target: target||null, achieved: !!achieved, achievedAt: achievedAt||null, createdAt: createdAtVal });
  }catch(e){
    res.status(500).json({ error: 'db' });
  }
});

app.put('/api/commitments/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  const { text, enabled, doneToday, schedule, scheduleDays, reminderEnabled, reminderTime, weeklyTarget, label, target, createdAt } = req.body;
  const scheduleDaysJson = scheduleDays ? JSON.stringify(scheduleDays) : null;
  try{
    // If marking doneToday, recompute streak from the full completion_log
    // history using the same computeStreak() the client uses, so the two
    // never disagree.
    if (doneToday !== undefined) {
      const row = await dbGet('SELECT schedule, scheduleDays, target, achieved, achievedAt, doneToday FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id]);
      if(!row) return res.status(404).json({ error: 'not found' });
      const today = localDateKey(new Date());
      const effectiveScheduleDays = scheduleDays !== undefined ? scheduleDays : (row.scheduleDays ? JSON.parse(row.scheduleDays) : null);
      const effectiveScheduleDaysJson = effectiveScheduleDays ? JSON.stringify(effectiveScheduleDays) : null;
      const commitForStreak = { schedule: schedule || row.schedule, scheduleDays: effectiveScheduleDays };

      if (doneToday) {
        await dbRun('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1) ON CONFLICT(commitment_id, date) DO UPDATE SET count = count + 1', [id, req.user.id, today]);
      } else {
        await dbRun('DELETE FROM completion_log WHERE commitment_id = ? AND user_id = ? AND date = ?', [id, req.user.id, today]);
      }

      const historyRows = await dbAll('SELECT date FROM completion_log WHERE commitment_id = ? AND user_id = ?', [id, req.user.id]);
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
      await dbRun(
        'UPDATE commitments SET text = ?, enabled = ?, doneToday = ?, schedule = ?, scheduleDays = ?, reminderEnabled = ?, reminderTime = ?, weeklyTarget = ?, streak = ?, lastDone = ?, label = ?, target = ?, achieved = ?, achievedAt = ?, createdAt = COALESCE(?, createdAt) WHERE id = ? AND user_id = ?',
        [text, enabled?1:0, doneToday?1:0, schedule||row.schedule||null, effectiveScheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, newStreak, newLast, label||null, targetVal||null, achieved?1:0, achievedAt, createdAt||null, id, req.user.id]
      );

      // XP only moves on an actual done/undone transition, not a resend of
      // the same state -- avoids double-counting from retried pushes.
      const wasDone = !!row.doneToday;
      let xp = null;
      if(doneToday && !wasDone){
        await dbRun('UPDATE users SET xp = COALESCE(xp,0) + 10 WHERE id = ?', [req.user.id]);
      } else if(!doneToday && wasDone){
        await dbRun('UPDATE users SET xp = MAX(0, COALESCE(xp,0) - 10) WHERE id = ?', [req.user.id]);
      }
      if(doneToday !== wasDone){
        const xpRow = await dbGet('SELECT xp FROM users WHERE id = ?', [req.user.id]);
        xp = xpRow ? xpRow.xp : null;
      }
      res.json({ success:true, streak:newStreak, lastDone:newLast, achieved, achievedAt, xp });
    } else {
      await dbRun(
        'UPDATE commitments SET text = ?, enabled = ?, schedule = ?, scheduleDays = ?, reminderEnabled = ?, reminderTime = ?, weeklyTarget = ?, label = ?, target = ?, createdAt = COALESCE(?, createdAt) WHERE id = ? AND user_id = ?',
        [text, enabled?1:0, schedule||null, scheduleDaysJson, reminderEnabled?1:0, reminderTime||null, weeklyTarget||null, label||null, target||null, createdAt||null, id, req.user.id]
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

app.delete('/api/commitments/:id', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const owned = await dbGet('SELECT id FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if(!owned) return res.status(404).json({ error: 'not found' });
    // @libsql/client enforces foreign keys (sqlite3 didn't), so child rows
    // have to go first -- there's no ON DELETE CASCADE on these tables.
    await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM paw_log WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM comments WHERE commitment_id = ?', [id]);
    await dbRun('DELETE FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  }catch(e){
    console.error('DELETE /api/commitments error', e);
    res.status(500).json({ error: 'db' });
  }
});

// Give a paw to someone else's habit. Capped at one per commitment per day by
// the paw_log UNIQUE(commitment_id, date) constraint -- a second attempt the
// same day is treated as a harmless no-op rather than an error.
app.post('/api/commitments/:id/paws', authMiddleware, async (req,res)=>{
  const id = req.params.id;
  try{
    const commit = await dbGet('SELECT id, user_id FROM commitments WHERE id = ?', [id]);
    if(!commit) return res.status(404).json({ error: 'not found' });
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
    const weeklyTarget = schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null));
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
    const commits = await dbAll('SELECT id FROM commitments WHERE user_id = ?', [req.user.id]);
    for(const c of commits){
      await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [c.id]);
    }
    await dbRun(
      'UPDATE commitments SET streak = 0, doneToday = 0, lastDone = NULL, achieved = 0, achievedAt = NULL, lastReminderSent = NULL WHERE user_id = ?',
      [req.user.id]
    );
    await dbRun('UPDATE users SET xp = 0, lastProgressReset = ? WHERE id = ?', [new Date().toISOString(), req.user.id]);
    res.json({ success: true });
  }catch(e){
    console.error('POST /api/me/reset error', e);
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
      const commits = await dbAll('SELECT id, schedule, scheduleDays FROM commitments WHERE user_id = ? AND enabled = 1', [user.id]);
      let scheduled = 0, completed = 0;
      for(const c of commits){
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
    const commits = await dbAll('SELECT id, user_id, text, reminderEnabled, reminderTime, schedule, scheduleDays, enabled, lastReminderSent FROM commitments WHERE reminderEnabled = 1 AND reminderTime IS NOT NULL');
    for(const commit of commits){
      commit.scheduleDays = commit.scheduleDays ? JSON.parse(commit.scheduleDays) : null;
      if(!shouldSendReminder(commit, now)) continue;
      const rows = await dbAll('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [commit.user_id]);
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
      const commits = await dbAll('SELECT schedule, scheduleDays, doneToday FROM commitments WHERE user_id = ? AND enabled = 1', [user.id]);
      const incomplete = commits.some(c => isScheduledDay({ schedule: c.schedule, scheduleDays: c.scheduleDays ? JSON.parse(c.scheduleDays) : null }, today) && !c.doneToday);
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
      const rows = await dbAll('SELECT DISTINCT label FROM commitments WHERE user_id = ? AND enabled = 1 AND label IS NOT NULL', [user.id]);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('API listening on', PORT));
