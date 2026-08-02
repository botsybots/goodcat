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
  if (!userCols.includes('lastWeeklyCategoryCheck')) await dbRun('ALTER TABLE users ADD COLUMN lastWeeklyCategoryCheck TEXT');
  if (!userCols.includes('xp')) await dbRun('ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0');
  if (!userCols.includes('lastProgressReset')) await dbRun('ALTER TABLE users ADD COLUMN lastProgressReset TEXT');
  if (!userCols.includes('lastWellbeingCheckDate')) await dbRun('ALTER TABLE users ADD COLUMN lastWellbeingCheckDate TEXT');
  if (!userCols.includes('wellbeingCategoryIndex')) await dbRun('ALTER TABLE users ADD COLUMN wellbeingCategoryIndex INTEGER DEFAULT 0');

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
    achieved: 'INTEGER DEFAULT 0', achievedAt: 'TEXT', createdAt: 'TEXT',
    scope: "TEXT DEFAULT 'personal'", deadlineDate: 'TEXT', lastLoggedAt: 'TEXT',
    xpAwardedThroughDate: 'TEXT'
  };
  for (const [col, def] of Object.entries(wantedCommitmentCols)) {
    if (!commitmentCols.includes(col)) await dbRun(`ALTER TABLE commitments ADD COLUMN ${col} ${def}`);
  }

  // "Cleanliness" was renamed to "Home" -- one-time backfill so existing rows
  // keep matching a real option in the (now fixed) label dropdown.
  await dbRun("UPDATE commitments SET label = 'Home' WHERE label = 'Cleanliness'");

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

  // One person proposing a commitment for the other -- sits pending until
  // accepted (as-is or amended), or rejected.
  await dbRun(`CREATE TABLE IF NOT EXISTS commitment_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER,
    to_user_id INTEGER,
    text TEXT,
    schedule TEXT,
    scheduleDays TEXT,
    label TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_user_id) REFERENCES users(id),
    FOREIGN KEY(to_user_id) REFERENCES users(id)
  )`);

  // Pausing a commitment closes off its life-loss/leaderboard/reminder
  // stakes -- for a joint commitment especially, that's not something one
  // person should be able to do unilaterally to something you're both on
  // the hook for. So pausing goes through a request the OTHER person has to
  // approve (resuming stays instant -- only opting OUT needs the gate).
  // The commitment stays fully enforced while a request sits pending.
  await dbRun(`CREATE TABLE IF NOT EXISTS pause_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commitment_id INTEGER,
    requested_by INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(commitment_id) REFERENCES commitments(id),
    FOREIGN KEY(requested_by) REFERENCES users(id)
  )`);

  // Shared checklist -- unlike commitments, a to-do belongs to both people
  // at once rather than one owner; anyone can add, check off, or delete any
  // item. No streak/schedule/history -- it's a one-time list, not a habit.
  await dbRun(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    done INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    done_at TEXT,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  // A second, separate shared list, same shape as todos -- kept as its own
  // table rather than folding into todos with a "type" column, since
  // grocery items and general tasks genuinely don't belong mixed together
  // in one list, and this is exactly two lists, not an open-ended set that
  // would justify a more generic "lists" abstraction.
  await dbRun(`CREATE TABLE IF NOT EXISTS shopping_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT,
    done INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    done_at TEXT,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  // One-time cleanup: registration used to be open to anyone, so a handful
  // of stranger/bot accounts registered before that was locked down (e.g.
  // "__deploytest__"). This app is exactly Anna and Jordan -- remove any
  // account that isn't one of them, along with everything it owns. Child
  // rows first since foreign keys are enforced.
  const strayUsers = await dbAll("SELECT id FROM users WHERE LOWER(name) NOT IN ('anna','jordan')");
  for (const u of strayUsers) {
    const strayCommits = await dbAll('SELECT id FROM commitments WHERE user_id = ?', [u.id]);
    for (const c of strayCommits) {
      await dbRun('DELETE FROM completion_log WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM paw_log WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM comments WHERE commitment_id = ?', [c.id]);
      await dbRun('DELETE FROM pause_requests WHERE commitment_id = ?', [c.id]);
    }
    await dbRun('DELETE FROM commitments WHERE user_id = ?', [u.id]);
    await dbRun('DELETE FROM paw_log WHERE giver_user_id = ?', [u.id]);
    await dbRun('DELETE FROM comments WHERE user_id = ?', [u.id]);
    await dbRun('DELETE FROM push_subscriptions WHERE user_id = ?', [u.id]);
    await dbRun('DELETE FROM commitment_suggestions WHERE from_user_id = ? OR to_user_id = ?', [u.id, u.id]);
    await dbRun('DELETE FROM pause_requests WHERE requested_by = ?', [u.id]);
    await dbRun('DELETE FROM todos WHERE created_by = ?', [u.id]);
    await dbRun('DELETE FROM shopping_items WHERE created_by = ?', [u.id]);
    await dbRun('DELETE FROM users WHERE id = ?', [u.id]);
  }
}

await migrate();
