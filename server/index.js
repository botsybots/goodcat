require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const db = require('./db');
const webpush = require('web-push');

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

app.post('/api/register', async (req, res) => {
  const { name, password } = req.body;
  if(!name || !password) return res.status(400).json({ error: 'name and password required' });
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (name,password) VALUES (?,?)', [name, hash], function(err){
    if(err) return res.status(400).json({ error: 'user exists or db error' });
    const user = { id: this.lastID, name };
    res.json({ token: sign(user), user });
  });
});

// Return VAPID public key for subscription
app.get('/api/vapidPublicKey', (req,res)=>{
  res.json({ publicKey: VAPID_PUBLIC });
});

// Store push subscription for authenticated user
app.post('/api/subscribe', authMiddleware, (req,res)=>{
  const sub = req.body;
  if(!sub) return res.status(400).json({ error: 'missing subscription' });
  const s = JSON.stringify(sub);
  db.run('INSERT INTO push_subscriptions (user_id, subscription) VALUES (?,?)', [req.user.id, s], function(err){
    if(err) return res.status(500).json({ error: 'db' });
    res.json({ success:true });
  });
});

// Trigger push for a commitment (testing endpoint)
app.post('/api/send-push/:commitmentId', authMiddleware, (req,res)=>{
  const id = req.params.commitmentId;
  // get commitment and user
  db.get('SELECT id, user_id, text FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id], (err, commit)=>{
    if(err || !commit) return res.status(404).json({ error: 'not found' });
    db.all('SELECT subscription FROM push_subscriptions WHERE user_id = ?', [req.user.id], (err2, rows)=>{
      if(err2) return res.status(500).json({ error: 'db' });
      const payload = JSON.stringify({ title: 'Reminder', body: 'Time for: ' + commit.text, tag: 'reminder-'+commit.id });
      const results = [];
      Promise.all(rows.map(r=>{
        let sub;
        try{ sub = JSON.parse(r.subscription); }catch(e){ return Promise.resolve({ ok:false }); }
        return webpush.sendNotification(sub, payload).then(()=>({ ok:true })).catch(err=>({ ok:false, error: String(err) }));
      })).then(results=> res.json({ results }));
    });
  });
});

app.post('/api/login', (req,res)=>{
  const { name, password } = req.body;
  if(!name || !password) return res.status(400).json({ error: 'name and password required' });
  db.get('SELECT * FROM users WHERE name = ?', [name], async (err,row)=>{
    if(err || !row) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, row.password);
    if(!ok) return res.status(400).json({ error: 'invalid credentials' });
    const user = { id: row.id, name: row.name };
    res.json({ token: sign(user), user });
  });
});

app.get('/api/commitments', authMiddleware, (req,res)=>{
  db.all('SELECT id, text, enabled, doneToday, schedule, streak, lastDone, label, target, achieved, achievedAt FROM commitments WHERE user_id = ?', [req.user.id], (err,rows)=>{
     if(err) return res.status(500).json({ error: 'db' });
     res.json(rows.map(r=>({ id:r.id, text:r.text, enabled:!!r.enabled, doneToday:!!r.doneToday, schedule: r.schedule || 'daily', streak: r.streak || 0, lastDone: r.lastDone, label: r.label || null, target: r.target || null, achieved: !!r.achieved, achievedAt: r.achievedAt })));
  });
});

app.post('/api/commitments', authMiddleware, (req,res)=>{
  const { text, enabled, schedule, label, target, achieved, achievedAt } = req.body;
  db.run('INSERT INTO commitments (user_id,text,enabled,doneToday,schedule,streak,lastDone,label,target,achieved,achievedAt) VALUES (?,?,?,?,?,0,NULL,?,?,?,?,?)', [req.user.id, text, enabled?1:0, 0, schedule||'daily', label||null, target||null, achieved?1:0, achievedAt||null], function(err){
    if(err) return res.status(500).json({ error: 'db' });
    // return full row
    res.json({ id: this.lastID, text, enabled: !!enabled, doneToday:false, schedule: schedule||'daily', streak:0, lastDone:null, label: label||null, target: target||null, achieved: !!achieved, achievedAt: achievedAt||null });
  });
});

app.put('/api/commitments/:id', authMiddleware, (req,res)=>{
  const id = req.params.id;
  const { text, enabled, doneToday, schedule, label, target } = req.body;
  // If marking doneToday, compute streak and lastDone server-side
  if (doneToday !== undefined) {
    db.get('SELECT streak, lastDone, target, achieved FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id], (err,row)=>{
      if(err || !row) return res.status(500).json({ error: 'db' });
      const today = new Date().toISOString().slice(0,10);
      let newStreak = row.streak || 0;
      let newLast = row.lastDone;
      let achieved = !!row.achieved;
      let achievedAt = null;
      if (doneToday) {
        const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10);
        if (row.lastDone === yesterday) newStreak = (row.streak||0) + 1; else newStreak = 1;
        newLast = today;
        // check target and set achieved
        if (row.target && newStreak >= row.target && !achieved) { achieved = true; achievedAt = today; }
      }
      db.run('UPDATE commitments SET text = ?, enabled = ?, doneToday = ?, schedule = ?, streak = ?, lastDone = ?, label = ?, target = ?, achieved = COALESCE(?, achieved), achievedAt = COALESCE(?, achievedAt) WHERE id = ? AND user_id = ?', [text, enabled?1:0, doneToday?1:0, schedule||null, newStreak, newLast, label||null, target||null, achieved?1:null, achievedAt, id, req.user.id], function(err2){
        if(err2) return res.status(500).json({ error: 'db' });
        // if marking done, increment count for the date
        if (doneToday) {
          db.run('INSERT INTO completion_log (commitment_id, user_id, date, count) VALUES (?,?,?,1) ON CONFLICT(commitment_id, date) DO UPDATE SET count = count + 1', [id, req.user.id, newLast], (e)=>{
            if (e) console.error('log insert err', e);
          });
        }
        res.json({ success:true, streak:newStreak, lastDone:newLast, achieved, achievedAt });
      });
    });
  } else {
    db.run('UPDATE commitments SET text = ?, enabled = ?, schedule = ?, label = ?, target = ? WHERE id = ? AND user_id = ?', [text, enabled?1:0, schedule||null, label||null, target||null, id, req.user.id], function(err){
      if(err) return res.status(500).json({ error: 'db' });
      res.json({ success: true });
    });
  }
});

// Return history for a commitment (dates)
app.get('/api/commitments/:id/history', authMiddleware, (req,res)=>{
  const id = req.params.id;
  db.all('SELECT date, count FROM completion_log WHERE commitment_id = ? AND user_id = ? ORDER BY date DESC', [id, req.user.id], (err, rows)=>{
    if(err) return res.status(500).json({ error: 'db' });
    res.json(rows.map(r=>({ date: r.date, count: r.count || 1 })));
  });
});

app.delete('/api/commitments/:id', authMiddleware, (req,res)=>{
  const id = req.params.id;
  db.run('DELETE FROM commitments WHERE id = ? AND user_id = ?', [id, req.user.id], function(err){
    if(err) return res.status(500).json({ error: 'db' });
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log('API listening on', PORT));
