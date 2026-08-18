import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth/password';

const here = path.dirname(fileURLToPath(import.meta.url));
// Overridable so a throwaway/scratch database can be used for testing (e.g. `DB_PATH=/tmp/x.db
// npm run dev`) without ever touching the real one at server/campus_trade.db.
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(here, 'campus_trade.db');

// Node's built-in SQLite binding -- chosen over better-sqlite3 because its prebuilt native
// addon segfaults on this machine (verified in isolation, unrelated to this project's code);
// node:sqlite ships inside Node itself, so there's no native binary to mismatch.
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        team TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        -- the Collection page's Collected/Seen/All visibility toggle, remembered per account
        -- so it persists across sessions/devices instead of resetting every visit.
        collection_view_mode TEXT NOT NULL DEFAULT 'all',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT NOT NULL
    );

    -- one row per physical/digital card instance -- mirrors src/card.ts's Card(n, id)
    CREATE TABLE IF NOT EXISTS card_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supercard_n INTEGER NOT NULL
    );

    -- append-only ownership history -- mirrors Card's CustodyRecord {owner, acquiredAt}
    CREATE TABLE IF NOT EXISTS custody_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_instance_id INTEGER NOT NULL REFERENCES card_instances(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- custody_events is append-only and grows across every orientation cycle; both columns
    -- are filtered on read (cardInstancesOwnedBy, custodyForCardInstance below), so index
    -- them rather than full-scanning as trade history accumulates.
    CREATE INDEX IF NOT EXISTS idx_custody_events_card_instance_id ON custody_events(card_instance_id);
    CREATE INDEX IF NOT EXISTS idx_custody_events_user_id ON custody_events(user_id);

    -- simple key/value store for admin-toggleable site settings (see src/settings.ts) --
    -- missing keys fall back to that file's DEFAULT_SETTINGS, so this table only needs a row
    -- once a setting has actually been changed from its default.
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    -- one row per (user, supercard) the user has scanned via "Just looking" -- tracks a
    -- Supercard *template* number, not a physical card_instance, since "seen" has no custody
    -- behind it (see the AF note on User.seen in src/user.ts).
    CREATE TABLE IF NOT EXISTS seen_supercards (
        user_id INTEGER NOT NULL REFERENCES users(id),
        supercard_n INTEGER NOT NULL,
        seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, supercard_n)
    );
    CREATE INDEX IF NOT EXISTS idx_seen_supercards_user_id ON seen_supercards(user_id);
`);

// CREATE TABLE IF NOT EXISTS above only shapes a brand-new database -- a database created
// before collection_view_mode existed keeps its original users table as-is, so add the
// column here if it's still missing. Guarded via PRAGMA table_info since SQLite has no
// "ADD COLUMN IF NOT EXISTS" and re-running ALTER TABLE on a column that already exists
// throws (this runs on every startup, not just once).
const userColumns = new Set(
    (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name),
);
if (!userColumns.has('collection_view_mode')) {
    db.exec("ALTER TABLE users ADD COLUMN collection_view_mode TEXT NOT NULL DEFAULT 'all'");
}

export interface UserRow {
    id: number;
    username: string;
    email: string;
    name: string;
    team: string;
    password_hash: string;
    is_admin: number;
    collection_view_mode: string;
    created_at: string;
}

export interface SessionRow {
    id: string;
    user_id: number;
    expires_at: string;
}

export interface CardInstanceRow {
    id: number;
    supercard_n: number;
}

/** One custody event, joined with the owning user's public fields. */
export interface CustodyEventWithUser {
    acquired_at: string;
    user_id: number;
    username: string;
    name: string;
    email: string;
    team: string;
    is_admin: number;
    collection_view_mode: string;
}

const stmts = {
    findUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(`
        INSERT INTO users (username, email, name, team, password_hash, is_admin)
        VALUES (@username, @email, @name, @team, @password_hash, @is_admin)
    `),
    updatePasswordHash: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    updateCollectionViewMode: db.prepare('UPDATE users SET collection_view_mode = ? WHERE id = ?'),
    listUsers: db.prepare('SELECT * FROM users ORDER BY id'),

    createSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
    findSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteOtherSessionsForUser: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),

    insertCardInstance: db.prepare('INSERT INTO card_instances (supercard_n) VALUES (?)'),
    findCardInstance: db.prepare('SELECT * FROM card_instances WHERE id = ?'),
    insertCustodyEvent: db.prepare('INSERT INTO custody_events (card_instance_id, user_id) VALUES (?, ?)'),

    // "latest" = the most recent custody_events row per card instance, i.e. its current owner.
    cardInstancesOwnedBy: db.prepare(`
        WITH latest AS (
            SELECT card_instance_id, user_id,
                   ROW_NUMBER() OVER (PARTITION BY card_instance_id ORDER BY id DESC) AS rn
            FROM custody_events
        )
        SELECT ci.id, ci.supercard_n
        FROM card_instances ci
        JOIN latest l ON l.card_instance_id = ci.id AND l.rn = 1
        WHERE l.user_id = ?
        ORDER BY ci.id
    `),
    // Every card instance the user has EVER appeared in custody_events for, current or past
    // owner alike -- the "Pokedex" query, as opposed to cardInstancesOwnedBy's "current owner
    // only". Reuses idx_custody_events_user_id, same as cardInstancesOwnedBy.
    cardInstancesCollectedBy: db.prepare(`
        SELECT DISTINCT ci.id, ci.supercard_n
        FROM card_instances ci
        JOIN custody_events ce ON ce.card_instance_id = ci.id
        WHERE ce.user_id = ?
        ORDER BY ci.id
    `),
    currentOwnerOfCardInstance: db.prepare(`
        SELECT user_id FROM custody_events
        WHERE card_instance_id = ?
        ORDER BY id DESC
        LIMIT 1
    `),
    custodyForCardInstance: db.prepare(`
        SELECT ce.acquired_at, u.id AS user_id, u.username, u.name, u.email, u.team, u.is_admin,
               u.collection_view_mode
        FROM custody_events ce
        JOIN users u ON u.id = ce.user_id
        WHERE ce.card_instance_id = ?
        ORDER BY ce.id ASC
    `),

    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    upsertSetting: db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),

    insertSeenSupercard: db.prepare(
        'INSERT OR IGNORE INTO seen_supercards (user_id, supercard_n) VALUES (?, ?)',
    ),
    deleteSeenSupercard: db.prepare('DELETE FROM seen_supercards WHERE user_id = ? AND supercard_n = ?'),
    seenSupercardsFor: db.prepare(
        'SELECT supercard_n FROM seen_supercards WHERE user_id = ? ORDER BY supercard_n',
    ),

    deleteCustodyEventsForUserOnInstance: db.prepare(
        'DELETE FROM custody_events WHERE card_instance_id = ? AND user_id = ?',
    ),
    countCustodyEventsForInstance: db.prepare(
        'SELECT COUNT(*) AS n FROM custody_events WHERE card_instance_id = ?',
    ),
    deleteCardInstance: db.prepare('DELETE FROM card_instances WHERE id = ?'),
};

export function findUserByEmail(email: string): UserRow | undefined {
    return stmts.findUserByEmail.get(email) as UserRow | undefined;
}

export function findUserByUsername(username: string): UserRow | undefined {
    return stmts.findUserByUsername.get(username) as UserRow | undefined;
}

export function findUserById(id: number): UserRow | undefined {
    return stmts.findUserById.get(id) as UserRow | undefined;
}

export interface NewUser {
    username: string;
    email: string;
    name: string;
    team: string;
    password_hash: string;
    isAdmin: boolean;
}

export function insertUser(user: NewUser): UserRow {
    const info = stmts.insertUser.run({
        username: user.username,
        email: user.email,
        name: user.name,
        team: user.team,
        password_hash: user.password_hash,
        is_admin: user.isAdmin ? 1 : 0,
    });
    return findUserById(Number(info.lastInsertRowid))!;
}

export function updatePasswordHash(userId: number, passwordHash: string): void {
    stmts.updatePasswordHash.run(passwordHash, userId);
}

export function updateCollectionViewMode(userId: number, mode: string): void {
    stmts.updateCollectionViewMode.run(mode, userId);
}

const UNASSIGNED_USERNAME = 'unassigned';
const UNASSIGNED_EMAIL = 'unassigned@system.campustrade.internal';

/**
 * A reserved, non-loginable system account used as the "current holder" of any card an admin
 * has taken back from a student (see returnCardInstance below) without erasing that student's
 * historical collected/Pokedex record -- the card simply becomes unassigned rather than
 * either staying with the student or requiring a specific new recipient to be picked.
 *
 * It's a completely ordinary row in `users` (round-trips through the normal insertUser/
 * findUserById machinery like any other account, so nothing elsewhere needs to special-case
 * it), seeded once at startup with a real bcrypt hash of a random, never-distributed
 * password -- exactly as unloginable as any other account whose password nobody knows, no
 * special-casing needed in the login route either. listUsers() filters it out by id so it
 * never appears in the admin UI or any user-facing listing.
 */
const unassignedUser: UserRow = await (async () => {
    const existing = findUserByUsername(UNASSIGNED_USERNAME);
    if (existing) return existing;
    return insertUser({
        username: UNASSIGNED_USERNAME,
        email: UNASSIGNED_EMAIL,
        name: 'Unassigned',
        team: 'black',
        password_hash: await hashPassword(randomUUID()),
        isAdmin: false,
    });
})();

export function unassignedUserId(): number {
    return unassignedUser.id;
}

export function listUsers(): UserRow[] {
    return (stmts.listUsers.all() as unknown as UserRow[]).filter((u) => u.id !== unassignedUser.id);
}

export function createSession(id: string, userId: number, expiresAt: string): void {
    stmts.createSession.run(id, userId, expiresAt);
}

export function findSession(id: string): SessionRow | undefined {
    return stmts.findSession.get(id) as SessionRow | undefined;
}

export function deleteSession(id: string): void {
    stmts.deleteSession.run(id);
}

export function deleteOtherSessionsForUser(userId: number, keepSessionId: string): void {
    stmts.deleteOtherSessionsForUser.run(userId, keepSessionId);
}

export function insertCardInstance(supercardN: number): CardInstanceRow {
    const info = stmts.insertCardInstance.run(supercardN);
    return stmts.findCardInstance.get(Number(info.lastInsertRowid)) as unknown as CardInstanceRow;
}

export function findCardInstance(id: number): CardInstanceRow | undefined {
    return stmts.findCardInstance.get(id) as CardInstanceRow | undefined;
}

export function insertCustodyEvent(cardInstanceId: number, userId: number): void {
    stmts.insertCustodyEvent.run(cardInstanceId, userId);
}

export function cardInstancesOwnedBy(userId: number): CardInstanceRow[] {
    return stmts.cardInstancesOwnedBy.all(userId) as unknown as CardInstanceRow[];
}

export function cardInstancesCollectedBy(userId: number): CardInstanceRow[] {
    return stmts.cardInstancesCollectedBy.all(userId) as unknown as CardInstanceRow[];
}

export function currentOwnerOfCardInstance(cardInstanceId: number): number | undefined {
    const row = stmts.currentOwnerOfCardInstance.get(cardInstanceId) as { user_id: number } | undefined;
    return row?.user_id;
}

export function custodyForCardInstance(cardInstanceId: number): CustodyEventWithUser[] {
    return stmts.custodyForCardInstance.all(cardInstanceId) as unknown as CustodyEventWithUser[];
}

/** Atomically creates a new card instance and its first custody event, owned by `userId`. */
export function grantCardInstance(supercardN: number, userId: number): CardInstanceRow {
    db.exec('BEGIN');
    try {
        const instance = insertCardInstance(supercardN);
        insertCustodyEvent(instance.id, userId);
        // Collecting a card obviously means you've seen it -- a UX nicety only, kept in the
        // same transaction. No invariant relies on this; see the AF note on User.seen.
        stmts.insertSeenSupercard.run(userId, supercardN);
        db.exec('COMMIT');
        return instance;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

export function getSetting(key: string): string | undefined {
    const row = stmts.getSetting.get(key) as { value: string } | undefined;
    return row?.value;
}

export function setSetting(key: string, value: string): void {
    stmts.upsertSetting.run(key, value);
}

/** Records that `userId` scanned (but did not register) `supercardN`. Idempotent. */
export function markSupercardSeen(userId: number, supercardN: number): void {
    stmts.insertSeenSupercard.run(userId, supercardN);
}

/** Every supercard number `userId` has ever scanned via "Just looking" or collected. */
export function seenSupercardNumbersFor(userId: number): number[] {
    return (stmts.seenSupercardsFor.all(userId) as { supercard_n: number }[]).map((row) => row.supercard_n);
}

/** Admin correction: clears a "seen" mark, e.g. to undo a mistaken scan. */
export function unmarkSupercardSeen(userId: number, supercardN: number): void {
    stmts.deleteSeenSupercard.run(userId, supercardN);
}

/**
 * Admin correction: fully erases `userId`'s participation in `cardInstanceId`'s custody
 * history -- an undo for a mistaken grant/transfer, deliberately breaking custody_events'
 * usual append-only guarantee (a documented, explicit exception for this one correction
 * tool, not a normal user-facing action). If this leaves the instance with no custody
 * history at all, the instance itself is deleted too, since an instance nobody has ever held
 * is meaningless.
 */
export function revokeCardInstanceFromUser(userId: number, cardInstanceId: number): void {
    db.exec('BEGIN');
    try {
        stmts.deleteCustodyEventsForUserOnInstance.run(cardInstanceId, userId);
        const { n } = stmts.countCustodyEventsForInstance.get(cardInstanceId) as { n: number };
        if (n === 0) {
            stmts.deleteCardInstance.run(cardInstanceId);
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Admin correction: takes a card instance back from whoever currently holds it without
 * erasing history -- appends a custody event to the reserved Unassigned account, same
 * mechanism as any other transfer. The previous holder keeps the card in their collected/
 * Pokedex history; it just stops counting as currently owned by them.
 */
export function returnCardInstance(cardInstanceId: number): void {
    insertCustodyEvent(cardInstanceId, unassignedUser.id);
}
