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

    -- one row per physical/digital card instance -- mirrors src/card.ts's Card(n, id,
    -- uniqueId). Every instance is pre-generated from the master card-copies sheet (see
    -- scripts/import-card-copies.ts) rather than manufactured on scan, so unique_id/
    -- copy_number always come from that sheet, not from application logic.
    CREATE TABLE IF NOT EXISTS card_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supercard_n INTEGER NOT NULL,
        unique_id TEXT,
        copy_number INTEGER
    );

    -- append-only ownership history -- mirrors Card's CustodyRecord {owner, acquiredAt}.
    -- claimed_from_user_id/matched_expected are only ever set by the self-service collect
    -- flow (server/db.ts's collectCardInstance) when the scanning student is asked "who'd
    -- you get this from?" -- admin-initiated events (grant/transfer/return) leave both NULL
    -- since no claim was made. matched_expected is 'Y'/'N' when a claim was possible (the
    -- instance had a previous owner) and NULL when there was nothing to match against.
    CREATE TABLE IF NOT EXISTS custody_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_instance_id INTEGER NOT NULL REFERENCES card_instances(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_from_user_id INTEGER REFERENCES users(id),
        matched_expected TEXT
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

    -- One row per verified two-way trade: card_instance_a went from user_x to user_y at
    -- datetime_x, and card_instance_b went the other way (user_y to user_x) at datetime_y --
    -- see tryFormVerifiedTrade below for how this gets populated. event_a_id/event_b_id
    -- (each UNIQUE) point back at the two custody_events rows that made up the trade, purely
    -- so a custody event can never be counted toward more than one verified trade; the six
    -- user/card/datetime columns are what callers actually want to query.
    CREATE TABLE IF NOT EXISTS verified_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_x_id INTEGER NOT NULL REFERENCES users(id),
        card_instance_a_id INTEGER NOT NULL REFERENCES card_instances(id),
        datetime_x TEXT NOT NULL,
        user_y_id INTEGER NOT NULL REFERENCES users(id),
        card_instance_b_id INTEGER NOT NULL REFERENCES card_instances(id),
        datetime_y TEXT NOT NULL,
        event_a_id INTEGER NOT NULL UNIQUE REFERENCES custody_events(id),
        event_b_id INTEGER NOT NULL UNIQUE REFERENCES custody_events(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

// Same guarded-ALTER pattern as above, for a database created before the pre-generated
// unique-copy/trading columns existed.
const cardInstanceColumns = new Set(
    (db.prepare('PRAGMA table_info(card_instances)').all() as { name: string }[]).map((c) => c.name),
);
if (!cardInstanceColumns.has('unique_id')) {
    db.exec('ALTER TABLE card_instances ADD COLUMN unique_id TEXT');
}
if (!cardInstanceColumns.has('copy_number')) {
    db.exec('ALTER TABLE card_instances ADD COLUMN copy_number INTEGER');
}
// Can't be declared UNIQUE inline via ALTER TABLE ADD COLUMN -- a unique index is equivalent
// and this is the standard way to add one after the fact. NULLs (pre-import rows with no
// unique_id yet) are exempt from SQLite's uniqueness check, so this is safe to create before
// the import script has run.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_card_instances_unique_id ON card_instances(unique_id)');

const custodyEventColumns = new Set(
    (db.prepare('PRAGMA table_info(custody_events)').all() as { name: string }[]).map((c) => c.name),
);
if (!custodyEventColumns.has('claimed_from_user_id')) {
    db.exec('ALTER TABLE custody_events ADD COLUMN claimed_from_user_id INTEGER REFERENCES users(id)');
}
if (!custodyEventColumns.has('matched_expected')) {
    db.exec('ALTER TABLE custody_events ADD COLUMN matched_expected TEXT');
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
    unique_id: string | null;
    copy_number: number | null;
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

/** A bare custody_events row, as opposed to CustodyEventWithUser's joined-for-display shape --
 *  used internally by collectCardInstance/tryFormVerifiedTrade, which need the raw ids
 *  (card_instance_id, claimed_from_user_id) rather than the owning user's public profile. */
export interface CustodyEventRow {
    id: number;
    card_instance_id: number;
    user_id: number;
    acquired_at: string;
    claimed_from_user_id: number | null;
    matched_expected: 'Y' | 'N' | null;
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

    findCardInstance: db.prepare('SELECT * FROM card_instances WHERE id = ?'),
    findCardInstanceByUniqueId: db.prepare('SELECT * FROM card_instances WHERE unique_id = ?'),
    // Used only by scripts/import-card-copies.ts -- every other instance-creation path was
    // removed along with on-scan manufacturing; the fixed pool comes entirely from the
    // master card-copies sheet.
    insertCardInstanceForImport: db.prepare(
        'INSERT INTO card_instances (supercard_n, unique_id, copy_number) VALUES (?, ?, ?)',
    ),
    // An instance with zero custody_events rows has never been handed to anyone -- the LEFT
    // JOIN/IS NULL excludes any instance that has at least one custody event (current or
    // historical), regardless of how many.
    findAvailableInstance: db.prepare(`
        SELECT ci.* FROM card_instances ci
        LEFT JOIN custody_events ce ON ce.card_instance_id = ci.id
        WHERE ci.supercard_n = ? AND ce.id IS NULL
        ORDER BY ci.id
        LIMIT 1
    `),
    insertCustodyEvent: db.prepare('INSERT INTO custody_events (card_instance_id, user_id) VALUES (?, ?)'),
    // Self-service collect path only (see collectCardInstance) -- records the collector's
    // claimed source alongside whether it matched the instance's actual previous owner.
    insertCustodyEventWithClaim: db.prepare(`
        INSERT INTO custody_events (card_instance_id, user_id, claimed_from_user_id, matched_expected)
        VALUES (?, ?, ?, ?)
    `),
    findCustodyEventById: db.prepare('SELECT * FROM custody_events WHERE id = ?'),
    // See tryFormVerifiedTrade's doc comment for what this is matching.
    findComplementaryUnmatchedEvent: db.prepare(`
        SELECT * FROM custody_events
        WHERE user_id = ? AND claimed_from_user_id = ? AND matched_expected = 'Y'
          AND id NOT IN (SELECT event_a_id FROM verified_trades)
          AND id NOT IN (SELECT event_b_id FROM verified_trades)
        ORDER BY id ASC
        LIMIT 1
    `),
    insertVerifiedTrade: db.prepare(`
        INSERT INTO verified_trades
            (user_x_id, card_instance_a_id, datetime_x, user_y_id, card_instance_b_id, datetime_y,
             event_a_id, event_b_id)
        VALUES (@user_x_id, @card_instance_a_id, @datetime_x, @user_y_id, @card_instance_b_id, @datetime_y,
                @event_a_id, @event_b_id)
    `),
    listVerifiedTrades: db.prepare(`
        SELECT vt.*,
               ux.username AS user_x_username, ux.name AS user_x_name,
               uy.username AS user_y_username, uy.name AS user_y_name,
               ca.unique_id AS card_a_unique_id, ca.supercard_n AS card_a_supercard_n,
               cb.unique_id AS card_b_unique_id, cb.supercard_n AS card_b_supercard_n
        FROM verified_trades vt
        JOIN users ux ON ux.id = vt.user_x_id
        JOIN users uy ON uy.id = vt.user_y_id
        JOIN card_instances ca ON ca.id = vt.card_instance_a_id
        JOIN card_instances cb ON cb.id = vt.card_instance_b_id
        ORDER BY vt.id DESC
    `),

    // "latest" = the most recent custody_events row per card instance, i.e. its current owner.
    cardInstancesOwnedBy: db.prepare(`
        WITH latest AS (
            SELECT card_instance_id, user_id,
                   ROW_NUMBER() OVER (PARTITION BY card_instance_id ORDER BY id DESC) AS rn
            FROM custody_events
        )
        SELECT ci.id, ci.supercard_n, ci.unique_id, ci.copy_number
        FROM card_instances ci
        JOIN latest l ON l.card_instance_id = ci.id AND l.rn = 1
        WHERE l.user_id = ?
        ORDER BY ci.id
    `),
    // Every card instance the user has EVER appeared in custody_events for, current or past
    // owner alike -- the "Pokedex" query, as opposed to cardInstancesOwnedBy's "current owner
    // only". Reuses idx_custody_events_user_id, same as cardInstancesOwnedBy.
    cardInstancesCollectedBy: db.prepare(`
        SELECT DISTINCT ci.id, ci.supercard_n, ci.unique_id, ci.copy_number
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

    // Used by clearCardInstanceHistory/clearAllOwnership below -- verified_trades has to go
    // first, same FK-ordering reason as scripts/import-card-copies.ts's wipe step.
    deleteVerifiedTradesForInstance: db.prepare(`
        DELETE FROM verified_trades
        WHERE event_a_id IN (SELECT id FROM custody_events WHERE card_instance_id = ?)
           OR event_b_id IN (SELECT id FROM custody_events WHERE card_instance_id = ?)
    `),
    deleteCustodyEventsForInstance: db.prepare('DELETE FROM custody_events WHERE card_instance_id = ?'),
    deleteAllVerifiedTrades: db.prepare('DELETE FROM verified_trades'),
    deleteAllCustodyEvents: db.prepare('DELETE FROM custody_events'),
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

/** Used only by scripts/import-card-copies.ts to seed the fixed pool from the master
 *  card-copies sheet -- every instance is pre-generated, so this is not how instances come
 *  into being at runtime (see grantCardInstance/collectCardInstance below). */
export function insertCardInstanceForImport(
    supercardN: number,
    uniqueId: string,
    copyNumber: number,
): CardInstanceRow {
    const info = stmts.insertCardInstanceForImport.run(supercardN, uniqueId, copyNumber);
    return stmts.findCardInstance.get(Number(info.lastInsertRowid)) as unknown as CardInstanceRow;
}

export function findCardInstance(id: number): CardInstanceRow | undefined {
    return stmts.findCardInstance.get(id) as CardInstanceRow | undefined;
}

export function findCardInstanceByUniqueId(uniqueId: string): CardInstanceRow | undefined {
    return stmts.findCardInstanceByUniqueId.get(uniqueId) as CardInstanceRow | undefined;
}

/** The first never-been-held instance of `supercardN` still in the pool, if any. */
export function findAvailableInstance(supercardN: number): CardInstanceRow | undefined {
    return stmts.findAvailableInstance.get(supercardN) as CardInstanceRow | undefined;
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

/** Thrown by grantCardInstance when the pool has no unclaimed copy of the requested supercard
 *  left -- every copy that will ever exist was pre-generated by the import script, so unlike
 *  the old on-scan-manufacture model, this is a real, expected failure mode. */
export class NoAvailableCopiesError extends Error {}

/** Admin action: claims the first never-held instance of `supercardN` for `userId` -- no
 *  claimed-from prompt/matching, since this isn't the self-service scan flow (see
 *  collectCardInstance for that). Throws NoAvailableCopiesError if the pool is exhausted. */
export function grantCardInstance(supercardN: number, userId: number): CardInstanceRow {
    const instance = findAvailableInstance(supercardN);
    if (!instance) {
        throw new NoAvailableCopiesError(`No available copies of supercard ${supercardN} left`);
    }
    db.exec('BEGIN');
    try {
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

export class CardInstanceNotFoundError extends Error {}
export class AlreadyOwnedError extends Error {}

export interface CollectResult {
    instance: CardInstanceRow;
    matchedExpected: 'Y' | 'N' | null;
    verifiedTradeFormed: boolean;
}

/**
 * Self-service collect: `userId` scans/visits `uniqueId` and claims to have gotten it from
 * `claimedFromUserId` (null = no previous owner to ask about, or they picked
 * "Unknown/Other"). Records the claim, whether it matched the instance's actual previous
 * owner, and -- if it matched -- checks whether this completes a two-way trade (see
 * tryFormVerifiedTrade).
 *
 * @throws CardInstanceNotFoundError if `uniqueId` isn't a known card instance
 * @throws AlreadyOwnedError if `userId` already currently owns this instance
 */
export function collectCardInstance(
    uniqueId: string,
    userId: number,
    claimedFromUserId: number | null,
): CollectResult {
    const instance = findCardInstanceByUniqueId(uniqueId);
    if (!instance) {
        throw new CardInstanceNotFoundError(`No card instance with unique id ${uniqueId}`);
    }
    const previousOwner = currentOwnerOfCardInstance(instance.id);
    if (previousOwner === userId) {
        throw new AlreadyOwnedError('You already own this card');
    }

    const matchedExpected: 'Y' | 'N' | null =
        previousOwner === undefined ? null : claimedFromUserId === previousOwner ? 'Y' : 'N';

    db.exec('BEGIN');
    try {
        const info = stmts.insertCustodyEventWithClaim.run(
            instance.id,
            userId,
            claimedFromUserId,
            matchedExpected,
        );
        stmts.insertSeenSupercard.run(userId, instance.supercard_n);

        let verifiedTradeFormed = false;
        if (matchedExpected === 'Y') {
            const newEvent = stmts.findCustodyEventById.get(
                Number(info.lastInsertRowid),
            ) as unknown as CustodyEventRow;
            verifiedTradeFormed = tryFormVerifiedTrade(newEvent);
        }

        db.exec('COMMIT');
        return { instance, matchedExpected, verifiedTradeFormed };
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Call immediately after inserting a matched_expected='Y' custody event `newEvent` (`Q` gave
 * card `Ca` to `P`, and `P` correctly said it came from `Q`). Looks for a previously-recorded,
 * not-yet-consumed complementary event -- `P` gave some card `Cb` to `Q`, and `Q` correctly
 * said it came from `P` -- and if one exists, records the pair as a verified_trades row.
 *
 * Deliberately not looking for *consecutive* events: the complementary event, if it exists at
 * all, could have happened hours earlier (or will complete this trade only once it happens
 * later, when *that* event's own tryFormVerifiedTrade call finds this one). The match query is
 * symmetric, so it doesn't matter which side of the swap gets recorded first.
 *
 * @returns true iff a verified trade was formed
 */
function tryFormVerifiedTrade(newEvent: CustodyEventRow): boolean {
    if (newEvent.claimed_from_user_id === null) return false; // can't happen when matched='Y', but keeps this fn's contract explicit

    const complement = stmts.findComplementaryUnmatchedEvent.get(
        newEvent.claimed_from_user_id,
        newEvent.user_id,
    ) as unknown as CustodyEventRow | undefined;
    if (!complement) return false;

    stmts.insertVerifiedTrade.run({
        user_x_id: newEvent.claimed_from_user_id,
        card_instance_a_id: newEvent.card_instance_id,
        datetime_x: newEvent.acquired_at,
        user_y_id: newEvent.user_id,
        card_instance_b_id: complement.card_instance_id,
        datetime_y: complement.acquired_at,
        event_a_id: newEvent.id,
        event_b_id: complement.id,
    });
    return true;
}

export interface VerifiedTradeWithDetails {
    id: number;
    user_x_id: number;
    user_x_username: string;
    user_x_name: string;
    card_instance_a_id: number;
    card_a_unique_id: string | null;
    card_a_supercard_n: number;
    datetime_x: string;
    user_y_id: number;
    user_y_username: string;
    user_y_name: string;
    card_instance_b_id: number;
    card_b_unique_id: string | null;
    card_b_supercard_n: number;
    datetime_y: string;
    created_at: string;
}

export function listVerifiedTrades(): VerifiedTradeWithDetails[] {
    return stmts.listVerifiedTrades.all() as unknown as VerifiedTradeWithDetails[];
}

/**
 * `count` random users, excluding `excludeUserIds` (and always the reserved Unassigned
 * account) -- powers the trade-attribution popup's "3 other random people" options. Built
 * with its own inline `db.prepare` (rather than a static `stmts` entry) since the number of
 * placeholders in the exclusion list varies per call.
 */
export function randomOtherUsers(excludeUserIds: number[], count: number): UserRow[] {
    const excluded = [...new Set([...excludeUserIds, unassignedUser.id])];
    const placeholders = excluded.map(() => '?').join(', ');
    const stmt = db.prepare(
        `SELECT * FROM users WHERE id NOT IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`,
    );
    return stmt.all(...excluded, count) as unknown as UserRow[];
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
 * history at all, it's simply back in the available pool (findAvailableInstance can hand it
 * out again) -- unlike the old on-scan-manufacture model, the instance row itself is never
 * deleted, since it corresponds to a real pre-generated physical copy (see
 * scripts/import-card-copies.ts) that still exists whether or not anyone currently holds it.
 */
export function revokeCardInstanceFromUser(userId: number, cardInstanceId: number): void {
    stmts.deleteCustodyEventsForUserOnInstance.run(cardInstanceId, userId);
}

/**
 * Admin action: wipes ONE card instance's *entire* custody history, regardless of how many
 * students have held it -- unlike revokeCardInstanceFromUser, which only erases a single
 * user's participation. Any verified_trades rows built from this instance's custody events are
 * deleted first (foreign keys are enforced, same ordering as scripts/import-card-copies.ts's
 * wipe step). The instance row itself is untouched and simply falls back to the available
 * pool, same as revokeCardInstanceFromUser -- it's a real pre-generated physical copy, never
 * deleted.
 */
export function clearCardInstanceHistory(cardInstanceId: number): void {
    db.exec('BEGIN');
    try {
        stmts.deleteVerifiedTradesForInstance.run(cardInstanceId, cardInstanceId);
        stmts.deleteCustodyEventsForInstance.run(cardInstanceId);
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Admin action: wipes *every* card instance's custody history at once, returning the whole
 * pool to unclaimed -- a site-wide version of clearCardInstanceHistory, and the same reset
 * scripts/import-card-copies.ts performs before importing, minus the re-import (the instances
 * and their unique_ids are untouched, only who has ever held them). Does not touch
 * seen_supercards -- "seen" is a separate, non-ownership concept (see its own table comment in
 * the schema above) that this intentionally leaves alone. Irreversible.
 */
export function clearAllOwnership(): void {
    db.exec('BEGIN');
    try {
        stmts.deleteAllVerifiedTrades.run();
        stmts.deleteAllCustodyEvents.run();
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
