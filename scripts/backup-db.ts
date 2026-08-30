/**
 * Takes a consistent, point-in-time snapshot of the live database and writes it to
 * `<repo>/backups/campus_trade-<timestamp>.db` (or `BACKUP_DIR` if set).
 *
 * Uses SQLite's `VACUUM INTO` rather than a plain file copy -- the database runs in WAL mode
 * (see server/db.ts), so a straight `cp` of the main .db file alone can miss recently-committed
 * data still sitting in the .db-wal file. `VACUUM INTO` is safe to run against a live database
 * (readers/writers keep working normally while it runs) and always produces one self-contained,
 * fully-consistent file with nothing else needed alongside it.
 *
 * Run via `npx tsx scripts/backup-db.ts` (respects DB_PATH the same way server/db.ts does, so
 * it snapshots whichever database the server is actually configured to use). Intended to be
 * run on a schedule (e.g. cron) in production, not just by hand -- see the README's Production
 * deployment section.
 *
 * Also deletes local snapshots older than `RETENTION_DAYS` (default 14) each run, so this
 * directory doesn't grow unbounded. This alone is not a substitute for an off-box backup (a
 * lost/terminated instance takes every local snapshot with it) -- see the README for pushing
 * these to S3 as well.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same resolution as server/db.ts's own DB_PATH -- so this snapshots whichever database the
// server is actually configured to use, in dev or production alike, without needing to be told
// twice.
const DB_PATH = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(here, '../server/campus_trade.db');

const BACKUP_DIR = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.resolve(here, '../backups');

const RETENTION_DAYS = process.env.RETENTION_DAYS ? Number(process.env.RETENTION_DAYS) : 14;

if (!fs.existsSync(DB_PATH)) {
    throw new Error(`No database found at ${DB_PATH} -- check DB_PATH.`);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destPath = path.join(BACKUP_DIR, `campus_trade-${timestamp}.db`);

// VACUUM INTO's destination path is baked into the SQL text itself (SQLite has no parameter
// placeholder for it) -- safe here since destPath is entirely script-generated, never user
// input, but worth a defensive check in case a future BACKUP_DIR override ever contains a
// stray quote.
if (destPath.includes("'")) {
    throw new Error(`Backup destination path contains a single quote, refusing: ${destPath}`);
}

const db = new DatabaseSync(DB_PATH);
try {
    db.exec(`VACUUM INTO '${destPath}'`);
} finally {
    db.close();
}

const { size } = fs.statSync(destPath);
console.log(`Backed up ${DB_PATH} -> ${destPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

// Retention: drop local snapshots older than RETENTION_DAYS. Only ever touches files matching
// this script's own naming pattern, in this directory -- never a blind wipe of BACKUP_DIR.
const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
let pruned = 0;
for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^campus_trade-.*\.db$/.test(name)) continue;
    const filePath = path.join(BACKUP_DIR, name);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.rmSync(filePath);
        pruned++;
    }
}
if (pruned > 0) {
    console.log(`Pruned ${pruned} snapshot(s) older than ${RETENTION_DAYS} days.`);
}
