const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    password TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    text TEXT,
    enabled INTEGER DEFAULT 1,
    doneToday INTEGER DEFAULT 0,
    schedule TEXT,
    streak INTEGER DEFAULT 0,
    lastDone TEXT,
    label TEXT,
    target INTEGER,
    achieved INTEGER DEFAULT 0,
    achievedAt TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  // Ensure columns exist for older DBs
  db.all("PRAGMA table_info(commitments)", (err, cols) => {
    if (err) return;
    const names = cols.map(c => c.name);
    if (!names.includes('schedule')) db.run('ALTER TABLE commitments ADD COLUMN schedule TEXT');
    if (!names.includes('streak')) db.run('ALTER TABLE commitments ADD COLUMN streak INTEGER DEFAULT 0');
    if (!names.includes('lastDone')) db.run('ALTER TABLE commitments ADD COLUMN lastDone TEXT');
    if (!names.includes('label')) db.run('ALTER TABLE commitments ADD COLUMN label TEXT');
    if (!names.includes('target')) db.run('ALTER TABLE commitments ADD COLUMN target INTEGER');
    if (!names.includes('achieved')) db.run('ALTER TABLE commitments ADD COLUMN achieved INTEGER DEFAULT 0');
    if (!names.includes('achievedAt')) db.run('ALTER TABLE commitments ADD COLUMN achievedAt TEXT');
  });

  // Create completion log to store history of completions (date strings YYYY-MM-DD)
  db.run(`CREATE TABLE IF NOT EXISTS completion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER,
    user_id INTEGER,
    date TEXT,
    count INTEGER DEFAULT 1,
    UNIQUE(commitment_id, date),
    FOREIGN KEY(commitment_id) REFERENCES commitments(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Store push subscriptions per user
  db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subscription TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  // Ensure 'count' column exists for older DBs
  db.all("PRAGMA table_info(completion_log)", (err, cols) => {
    if (err) return;
    const names = cols.map(c => c.name);
    if (!names.includes('count')) db.run('ALTER TABLE completion_log ADD COLUMN count INTEGER DEFAULT 1');
  });
});

module.exports = db;
