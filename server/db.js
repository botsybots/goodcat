import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Local dev: a plain SQLite file (unchanged behavior, no account needed).
// Production: point TURSO_DATABASE_URL/TURSO_AUTH_TOKEN at a Turso database
// so data survives restarts on hosts with an ephemeral filesystem (e.g.
// Render's free tier) -- @libsql/client speaks the same SQL either way.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'data.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

export async function dbAll(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows;
}

export async function dbGet(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows[0];
}

export async function dbRun(sql, args = []) {
  const result = await client.execute({ sql, args });
  return { lastID: Number(result.lastInsertRowid ?? 0), changes: result.rowsAffected };
}

async function columnNames(table) {
  const rows = await dbAll(`PRAGMA table_info(${table})`);
  return rows.map(r => r.name);
}

async function migrate() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    password TEXT
  )`);

  const userCols = await columnNames('users');
  if (!userCols.includes('lastEndOfDaySent')) await dbRun('ALTER TABLE users ADD COLUMN lastEndOfDaySent TEXT');

  await dbRun(`CREATE TABLE IF NOT EXISTS commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    text TEXT,
    enabled INTEGER DEFAULT 1,
    doneToday INTEGER DEFAULT 0,
    schedule TEXT,
    scheduleDays TEXT,
    reminderEnabled INTEGER DEFAULT 0,
    reminderTime TEXT,
    lastReminderSent TEXT,
    weeklyTarget INTEGER,
    streak INTEGER DEFAULT 0,
    lastDone TEXT,
    label TEXT,
    target INTEGER,
    achieved INTEGER DEFAULT 0,
    achievedAt TEXT,
    createdAt TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  const commitmentCols = await columnNames('commitments');
  const wantedCommitmentCols = {
    schedule: 'TEXT', scheduleDays: 'TEXT', reminderEnabled: 'INTEGER DEFAULT 0',
    reminderTime: 'TEXT', lastReminderSent: 'TEXT', weeklyTarget: 'INTEGER',
    streak: 'INTEGER DEFAULT 0', lastDone: 'TEXT', label: 'TEXT', target: 'INTEGER',
    achieved: 'INTEGER DEFAULT 0', achievedAt: 'TEXT', createdAt: 'TEXT'
  };
  for (const [col, def] of Object.entries(wantedCommitmentCols)) {
    if (!commitmentCols.includes(col)) await dbRun(`ALTER TABLE commitments ADD COLUMN ${col} ${def}`);
  }

  // Completion history (date strings YYYY-MM-DD), one row per commitment/day.
  await dbRun(`CREATE TABLE IF NOT EXISTS completion_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER,
    user_id INTEGER,
    date TEXT,
    count INTEGER DEFAULT 1,
    UNIQUE(commitment_id, date),
    FOREIGN KEY(commitment_id) REFERENCES commitments(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  const completionCols = await columnNames('completion_log');
  if (!completionCols.includes('count')) await dbRun('ALTER TABLE completion_log ADD COLUMN count INTEGER DEFAULT 1');

  // Push subscriptions per user.
  await dbRun(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subscription TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // One paw per commitment per day, from whoever isn't the owner (enforced
  // in index.js) -- the UNIQUE constraint is what actually caps it at one/day.
  await dbRun(`CREATE TABLE IF NOT EXISTS paw_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER,
    giver_user_id INTEGER,
    date TEXT,
    UNIQUE(commitment_id, date),
    FOREIGN KEY(commitment_id) REFERENCES commitments(id),
    FOREIGN KEY(giver_user_id) REFERENCES users(id)
  )`);

  // Encouragement notes left on a commitment by either person.
  await dbRun(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER,
    user_id INTEGER,
    text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(commitment_id) REFERENCES commitments(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
}

await migrate();
