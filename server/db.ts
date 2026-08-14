import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, 'campus_trade.db');

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
`);

export interface UserRow {
    id: number;
    username: string;
    email: string;
    name: string;
    team: string;
    password_hash: string;
    is_admin: number;
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
    currentOwnerOfCardInstance: db.prepare(`
        SELECT user_id FROM custody_events
        WHERE card_instance_id = ?
        ORDER BY id DESC
        LIMIT 1
    `),
    custodyForCardInstance: db.prepare(`
        SELECT ce.acquired_at, u.id AS user_id, u.username, u.name, u.email, u.team, u.is_admin
        FROM custody_events ce
        JOIN users u ON u.id = ce.user_id
        WHERE ce.card_instance_id = ?
        ORDER BY ce.id ASC
    `),
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

export function listUsers(): UserRow[] {
    return stmts.listUsers.all() as unknown as UserRow[];
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
        db.exec('COMMIT');
        return instance;
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}
