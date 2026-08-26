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

// A database from before exchange_events was renamed from custody_events has that old table
// name -- rename it in place (preserving every row and its id/exchange_id) before the
// `CREATE TABLE IF NOT EXISTS exchange_events` below ever runs, or that statement would just
// silently create a brand-new *empty* exchange_events table alongside the old one, orphaning
// all existing history. Guarded so this only ever fires once, on the first startup after the
// rename; a fresh database has neither table yet, and this is a no-op.
const existingTableNames = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
    ),
);
if (existingTableNames.has('custody_events') && !existingTableNames.has('exchange_events')) {
    db.exec('ALTER TABLE custody_events RENAME TO exchange_events');
}

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
        -- Manually toggled by an admin (see AdminPage.tsx) once a player finishes the color
        -- challenge / their sub-objective -- not derived from anything else in this schema,
        -- since both challenges happen outside the app. Shown as a badge in the admin panel
        -- and on the player's own Collection page.
        color_challenge_completed INTEGER NOT NULL DEFAULT 0,
        sub_objective_completed INTEGER NOT NULL DEFAULT 0,
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

    -- append-only ownership history -- mirrors Card's CustodyRecord {owner, acquiredAt}. Named
    -- for what it now tracks for research purposes (a specific hand-off of one physical card),
    -- not the earlier "custody_events" name -- card_instance_id/user_id/
    -- authentication_input_user_id are the internal FKs the app's own joins/matching logic
    -- need; every other column below is a denormalized, human-readable copy of data that would
    -- otherwise require those joins, so a researcher reading this table directly never has to
    -- reconstruct it themselves:
    --   * user_name/user_email -- the receiving user (user_id), as of this event
    --   * last_trade_time -- this same user's own previous exchange event's trade_time, or
    --     NULL if this was their first ever (see insertExchangeEvent)
    --   * received_card_unique_id/received_card_type_id -- the card_instances row
    --     (card_instance_id)'s own unique_id (4-char alphanumeric, e.g. 'AARK') and supercard_n
    --     (the card design/type, currently 1-72) -- NEVER stored as a bare renumbering; the
    --     alphanumeric code printed on the physical card is preserved as-is end to end
    --   * received_card_previous_user_name/email -- the card's actual previous holder (ground
    --     truth, from this same table's own history), independent of what the receiver claimed
    --   * authentication_input_user_id/user_authentication_input -- who the receiver said they
    --     got the card from, as both an internal FK (for matching, see
    --     findComplementaryUnmatchedEvent) and that person's plain name (or the literal string
    --     'Unknown/Other' if that's what was picked). Both stay NULL when there was no previous
    --     owner to ask about (no popup was shown at all) -- see collectCardInstance
    --   * dyadic_exchange_authentication_confirmed -- 'Y'/'N' iff a claim was made (NULL
    --     otherwise) and whether it matched the card's actual previous holder
    --   * given_card_exchange_id -- once this event's claim is confirmed AND the other side of
    --     the swap has also been recorded, the exchange_id of the sibling event where this same
    --     user gave up the card they got this one in return for (see tryFormVerifiedTrade) --
    --     filled in retroactively, so it's NULL until (and unless) that happens
    --   * received_from_other_person -- 'Y'/'N', the receiver's own answer to "did you get this
    --     from someone else?", only ever asked when this event had no previous owner to claim
    --     (see collectCardInstance) -- NULL until answered, and never asked again either way
    --   * conversation_notes -- free-text research answer to "tell us about your conversation",
    --     only ever asked when the receiver claimed a specific previous owner -- NULL unless
    --     the player opted in
    CREATE TABLE IF NOT EXISTS exchange_events (
        exchange_id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_instance_id INTEGER NOT NULL REFERENCES card_instances(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        trade_time TEXT NOT NULL DEFAULT (datetime('now')),
        last_trade_time TEXT,
        received_card_unique_id TEXT,
        received_card_type_id INTEGER,
        received_card_previous_user_name TEXT,
        received_card_previous_user_email TEXT,
        authentication_input_user_id INTEGER REFERENCES users(id),
        user_authentication_input TEXT,
        dyadic_exchange_authentication_confirmed TEXT,
        given_card_exchange_id INTEGER REFERENCES exchange_events(exchange_id),
        received_from_other_person TEXT,
        conversation_notes TEXT
    );

    -- exchange_events is append-only and grows across every orientation cycle; both columns
    -- are filtered on read (cardInstancesOwnedBy, custodyForCardInstance below), so index
    -- them rather than full-scanning as trade history accumulates.
    CREATE INDEX IF NOT EXISTS idx_exchange_events_card_instance_id ON exchange_events(card_instance_id);
    CREATE INDEX IF NOT EXISTS idx_exchange_events_user_id ON exchange_events(user_id);

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

    -- One row per verified two-way trade: user_one gave the card identified by
    -- card_given_by_user_one_unique_id to user_two at user_one_trade_time, and user_two gave
    -- card_given_by_user_two_unique_id the other way at user_two_trade_time -- see
    -- tryFormVerifiedTrade below for how this gets populated. Every column here is stored
    -- directly (no join required to read a trade back in a human-readable form): card
    -- identities are the same 4-character alphanumeric unique_id printed on the physical card,
    -- never a bare internal number, and each user's name/email are copied alongside their id.
    -- exchange_event_one_id/exchange_event_two_id (each UNIQUE) point back at the two
    -- exchange_events rows that made up the trade, purely so one exchange event can never be
    -- counted toward more than one verified trade.
    CREATE TABLE IF NOT EXISTS verified_trades (
        trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_one_id INTEGER NOT NULL REFERENCES users(id),
        user_one_name TEXT NOT NULL,
        user_one_email TEXT NOT NULL,
        card_given_by_user_one_unique_id TEXT NOT NULL,
        user_one_trade_time TEXT NOT NULL,
        user_two_id INTEGER NOT NULL REFERENCES users(id),
        user_two_name TEXT NOT NULL,
        user_two_email TEXT NOT NULL,
        card_given_by_user_two_unique_id TEXT NOT NULL,
        user_two_trade_time TEXT NOT NULL,
        exchange_event_one_id INTEGER NOT NULL UNIQUE REFERENCES exchange_events(exchange_id),
        exchange_event_two_id INTEGER NOT NULL UNIQUE REFERENCES exchange_events(exchange_id),
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
if (!userColumns.has('color_challenge_completed')) {
    db.exec('ALTER TABLE users ADD COLUMN color_challenge_completed INTEGER NOT NULL DEFAULT 0');
}
if (!userColumns.has('sub_objective_completed')) {
    db.exec('ALTER TABLE users ADD COLUMN sub_objective_completed INTEGER NOT NULL DEFAULT 0');
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

// exchange_events itself was already renamed from custody_events above (table-level); this
// brings its *columns* up to the same new vocabulary, then adds and backfills every
// research-readable column that's brand new (see the table's own schema comment). Each rename
// is guarded individually since a sufficiently old database might predate
// claimed_from_user_id/matched_expected entirely, not just the rename.
const exchangeEventColumns = new Set(
    (db.prepare('PRAGMA table_info(exchange_events)').all() as { name: string }[]).map((c) => c.name),
);
if (exchangeEventColumns.has('id') && !exchangeEventColumns.has('exchange_id')) {
    db.exec('ALTER TABLE exchange_events RENAME COLUMN id TO exchange_id');
}
if (exchangeEventColumns.has('acquired_at') && !exchangeEventColumns.has('trade_time')) {
    db.exec('ALTER TABLE exchange_events RENAME COLUMN acquired_at TO trade_time');
}
if (
    exchangeEventColumns.has('claimed_from_user_id') &&
    !exchangeEventColumns.has('authentication_input_user_id')
) {
    db.exec('ALTER TABLE exchange_events RENAME COLUMN claimed_from_user_id TO authentication_input_user_id');
}
if (
    exchangeEventColumns.has('matched_expected') &&
    !exchangeEventColumns.has('dyadic_exchange_authentication_confirmed')
) {
    db.exec(
        'ALTER TABLE exchange_events RENAME COLUMN matched_expected TO dyadic_exchange_authentication_confirmed',
    );
}
// A database old enough to predate the self-service collect/trading feature entirely never
// got these two columns added under either name -- same ADD COLUMN fallback as ever.
if (
    !exchangeEventColumns.has('claimed_from_user_id') &&
    !exchangeEventColumns.has('authentication_input_user_id')
) {
    db.exec(
        'ALTER TABLE exchange_events ADD COLUMN authentication_input_user_id INTEGER REFERENCES users(id)',
    );
}
if (
    !exchangeEventColumns.has('matched_expected') &&
    !exchangeEventColumns.has('dyadic_exchange_authentication_confirmed')
) {
    db.exec('ALTER TABLE exchange_events ADD COLUMN dyadic_exchange_authentication_confirmed TEXT');
}

// The research-readable columns are brand new regardless of how old the database is -- add
// each and backfill every pre-existing row in one pass (guarded so this only ever runs once,
// right after the columns themselves first appear), so history recorded before this change is
// just as queryable going forward as anything recorded after it.
const exchangeEventColumnsAfterRename = new Set(
    (db.prepare('PRAGMA table_info(exchange_events)').all() as { name: string }[]).map((c) => c.name),
);
if (!exchangeEventColumnsAfterRename.has('user_name')) {
    db.exec(`
        ALTER TABLE exchange_events ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE exchange_events ADD COLUMN user_email TEXT NOT NULL DEFAULT '';
        ALTER TABLE exchange_events ADD COLUMN last_trade_time TEXT;
        ALTER TABLE exchange_events ADD COLUMN received_card_unique_id TEXT;
        ALTER TABLE exchange_events ADD COLUMN received_card_type_id INTEGER;
        ALTER TABLE exchange_events ADD COLUMN received_card_previous_user_name TEXT;
        ALTER TABLE exchange_events ADD COLUMN received_card_previous_user_email TEXT;
        ALTER TABLE exchange_events ADD COLUMN user_authentication_input TEXT;
        ALTER TABLE exchange_events
            ADD COLUMN given_card_exchange_id INTEGER REFERENCES exchange_events(exchange_id);

        UPDATE exchange_events
        SET user_name = (SELECT u.name FROM users u WHERE u.id = exchange_events.user_id),
            user_email = (SELECT u.email FROM users u WHERE u.id = exchange_events.user_id);

        UPDATE exchange_events
        SET received_card_unique_id =
                (SELECT ci.unique_id FROM card_instances ci WHERE ci.id = exchange_events.card_instance_id),
            received_card_type_id =
                (SELECT ci.supercard_n FROM card_instances ci WHERE ci.id = exchange_events.card_instance_id);

        -- Ground truth, not the claim: the same card_instance's own most recent EARLIER row.
        UPDATE exchange_events
        SET received_card_previous_user_name = (
                SELECT u.name FROM exchange_events prev
                JOIN users u ON u.id = prev.user_id
                WHERE prev.card_instance_id = exchange_events.card_instance_id
                  AND prev.exchange_id < exchange_events.exchange_id
                ORDER BY prev.exchange_id DESC LIMIT 1
            ),
            received_card_previous_user_email = (
                SELECT u.email FROM exchange_events prev
                JOIN users u ON u.id = prev.user_id
                WHERE prev.card_instance_id = exchange_events.card_instance_id
                  AND prev.exchange_id < exchange_events.exchange_id
                ORDER BY prev.exchange_id DESC LIMIT 1
            );

        UPDATE exchange_events
        SET user_authentication_input = CASE
            WHEN authentication_input_user_id IS NOT NULL
                THEN (SELECT u.name FROM users u WHERE u.id = exchange_events.authentication_input_user_id)
            WHEN dyadic_exchange_authentication_confirmed IS NOT NULL THEN 'Unknown/Other'
            ELSE NULL
        END;

        UPDATE exchange_events
        SET last_trade_time = (
            SELECT MAX(prev.trade_time) FROM exchange_events prev
            WHERE prev.user_id = exchange_events.user_id AND prev.exchange_id < exchange_events.exchange_id
        );
    `);
}

// The two research-prompt answer columns are newer still than the research-readability
// rename above -- added and checked independently so a database that already has the
// research-readable columns (from a prior startup) but predates these two doesn't skip them.
if (!exchangeEventColumnsAfterRename.has('received_from_other_person')) {
    db.exec('ALTER TABLE exchange_events ADD COLUMN received_from_other_person TEXT');
}
if (!exchangeEventColumnsAfterRename.has('conversation_notes')) {
    db.exec('ALTER TABLE exchange_events ADD COLUMN conversation_notes TEXT');
}

// verified_trades' pre-rename shape (id/user_x_id/card_instance_a_id/datetime_x/.../
// event_a_id/event_b_id) is cheap to fully reconstruct rather than threading through a long
// RENAME/ADD/DROP COLUMN chain -- this table only ever holds a handful of rows (one per
// confirmed two-way trade), and every value the new shape needs is still derivable from the
// old columns plus a join to users (and, for a very old row predating card_a_unique_id/
// card_b_unique_id, a lookup via the card_instance_a_id/b_id FK it does have).
const verifiedTradesColumns = new Set(
    (db.prepare('PRAGMA table_info(verified_trades)').all() as { name: string }[]).map((c) => c.name),
);
if (!verifiedTradesColumns.has('trade_id')) {
    const legacyTrades = db.prepare('SELECT * FROM verified_trades').all() as Record<string, unknown>[];
    db.exec('DROP TABLE verified_trades');
    db.exec(`
        CREATE TABLE verified_trades (
            trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_one_id INTEGER NOT NULL REFERENCES users(id),
            user_one_name TEXT NOT NULL,
            user_one_email TEXT NOT NULL,
            card_given_by_user_one_unique_id TEXT NOT NULL,
            user_one_trade_time TEXT NOT NULL,
            user_two_id INTEGER NOT NULL REFERENCES users(id),
            user_two_name TEXT NOT NULL,
            user_two_email TEXT NOT NULL,
            card_given_by_user_two_unique_id TEXT NOT NULL,
            user_two_trade_time TEXT NOT NULL,
            exchange_event_one_id INTEGER NOT NULL UNIQUE REFERENCES exchange_events(exchange_id),
            exchange_event_two_id INTEGER NOT NULL UNIQUE REFERENCES exchange_events(exchange_id),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    const insertLegacyTrade = db.prepare(`
        INSERT INTO verified_trades
            (user_one_id, user_one_name, user_one_email, card_given_by_user_one_unique_id, user_one_trade_time,
             user_two_id, user_two_name, user_two_email, card_given_by_user_two_unique_id, user_two_trade_time,
             exchange_event_one_id, exchange_event_two_id, created_at)
        VALUES (@user_one_id, @user_one_name, @user_one_email, @card_one_unique_id, @user_one_trade_time,
                @user_two_id, @user_two_name, @user_two_email, @card_two_unique_id, @user_two_trade_time,
                @exchange_event_one_id, @exchange_event_two_id, @created_at)
    `);
    const findLegacyUser = db.prepare('SELECT name, email FROM users WHERE id = ?');
    const findLegacyCardUniqueId = db.prepare('SELECT unique_id FROM card_instances WHERE id = ?');
    for (const row of legacyTrades) {
        const userOne = findLegacyUser.get(row.user_x_id as number) as
            { name: string; email: string } | undefined;
        const userTwo = findLegacyUser.get(row.user_y_id as number) as
            { name: string; email: string } | undefined;
        const cardOneUniqueId =
            (row.card_a_unique_id as string | null) ??
            (
                findLegacyCardUniqueId.get(row.card_instance_a_id as number) as
                    { unique_id: string } | undefined
            )?.unique_id ??
            '';
        const cardTwoUniqueId =
            (row.card_b_unique_id as string | null) ??
            (
                findLegacyCardUniqueId.get(row.card_instance_b_id as number) as
                    { unique_id: string } | undefined
            )?.unique_id ??
            '';
        insertLegacyTrade.run({
            user_one_id: row.user_x_id as number,
            user_one_name: userOne?.name ?? '',
            user_one_email: userOne?.email ?? '',
            card_one_unique_id: cardOneUniqueId,
            user_one_trade_time: row.datetime_x as string,
            user_two_id: row.user_y_id as number,
            user_two_name: userTwo?.name ?? '',
            user_two_email: userTwo?.email ?? '',
            card_two_unique_id: cardTwoUniqueId,
            user_two_trade_time: row.datetime_y as string,
            exchange_event_one_id: row.event_a_id as number,
            exchange_event_two_id: row.event_b_id as number,
            created_at: row.created_at as string,
        });
    }
    // Field #12 (given_card_exchange_id) for every exchange_events row this migration's
    // now-rebuilt trades cover -- everything recorded going forward gets this set directly by
    // tryFormVerifiedTrade instead.
    db.exec(`
        UPDATE exchange_events
        SET given_card_exchange_id =
            (SELECT vt.exchange_event_two_id FROM verified_trades vt
             WHERE vt.exchange_event_one_id = exchange_events.exchange_id)
        WHERE exchange_id IN (SELECT exchange_event_one_id FROM verified_trades);

        UPDATE exchange_events
        SET given_card_exchange_id =
            (SELECT vt.exchange_event_one_id FROM verified_trades vt
             WHERE vt.exchange_event_two_id = exchange_events.exchange_id)
        WHERE exchange_id IN (SELECT exchange_event_two_id FROM verified_trades);
    `);
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
    color_challenge_completed: number;
    sub_objective_completed: number;
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

/** One exchange event, joined with the receiving user's public fields -- the shape
 *  CustodyChain/the card detail page's history section actually render. `acquired_at` here is
 *  a query-time alias for exchange_events' own `trade_time` column (see custodyForCardInstance
 *  below): this outward-facing shape is deliberately left as-is by the exchange_events
 *  research-readability rename, since it's an established, already-good UI concept and not
 *  what that rename was about. */
export interface CustodyEventWithUser {
    acquired_at: string;
    user_id: number;
    username: string;
    name: string;
    email: string;
    team: string;
    is_admin: number;
    collection_view_mode: string;
    color_challenge_completed: number;
    sub_objective_completed: number;
}

/** A bare exchange_events row -- see that table's own schema comment for what each column
 *  means. Used internally by collectCardInstance/tryFormVerifiedTrade, which need the raw ids
 *  (card_instance_id, authentication_input_user_id) and the denormalized research columns
 *  rather than a further join. */
export interface ExchangeEventRow {
    exchange_id: number;
    card_instance_id: number;
    user_id: number;
    user_name: string;
    user_email: string;
    trade_time: string;
    last_trade_time: string | null;
    received_card_unique_id: string | null;
    received_card_type_id: number | null;
    received_card_previous_user_name: string | null;
    received_card_previous_user_email: string | null;
    authentication_input_user_id: number | null;
    user_authentication_input: string | null;
    dyadic_exchange_authentication_confirmed: 'Y' | 'N' | null;
    given_card_exchange_id: number | null;
    received_from_other_person: 'Y' | 'N' | null;
    conversation_notes: string | null;
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
    updateColorChallengeCompleted: db.prepare('UPDATE users SET color_challenge_completed = ? WHERE id = ?'),
    updateSubObjectiveCompleted: db.prepare('UPDATE users SET sub_objective_completed = ? WHERE id = ?'),
    updateIsAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE id = ?'),
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
    // An instance with zero exchange_events rows has never been handed to anyone -- the LEFT
    // JOIN/IS NULL excludes any instance that has at least one exchange event (current or
    // historical), regardless of how many.
    findAvailableInstance: db.prepare(`
        SELECT ci.* FROM card_instances ci
        LEFT JOIN exchange_events ee ON ee.card_instance_id = ci.id
        WHERE ci.supercard_n = ? AND ee.exchange_id IS NULL
        ORDER BY ci.id
        LIMIT 1
    `),
    // The one INSERT every exchange event goes through (see insertExchangeEvent) -- every
    // research-readable column is supplied by the caller (already looked up there), not
    // computed in SQL, so this statement is just a straight column list.
    insertExchangeEvent: db.prepare(`
        INSERT INTO exchange_events
            (card_instance_id, user_id, user_name, user_email, last_trade_time,
             received_card_unique_id, received_card_type_id,
             received_card_previous_user_name, received_card_previous_user_email,
             authentication_input_user_id, user_authentication_input,
             dyadic_exchange_authentication_confirmed)
        VALUES (@card_instance_id, @user_id, @user_name, @user_email, @last_trade_time,
                @received_card_unique_id, @received_card_type_id,
                @received_card_previous_user_name, @received_card_previous_user_email,
                @authentication_input_user_id, @user_authentication_input,
                @dyadic_exchange_authentication_confirmed)
    `),
    setGivenCardExchangeId: db.prepare(
        'UPDATE exchange_events SET given_card_exchange_id = ? WHERE exchange_id = ?',
    ),
    setReceivedFromOtherPerson: db.prepare(
        'UPDATE exchange_events SET received_from_other_person = ? WHERE exchange_id = ?',
    ),
    setConversationNotes: db.prepare(
        'UPDATE exchange_events SET conversation_notes = ? WHERE exchange_id = ?',
    ),
    findExchangeEventById: db.prepare('SELECT * FROM exchange_events WHERE exchange_id = ?'),
    // Every card-obtained event, not just verified trades or ones with a research answer --
    // powers the admin "Card Events" table. The row already denormalizes everything it needs
    // (user_name, received_card_type_id/unique_id, trade_time), so no joins required.
    listExchangeEvents: db.prepare('SELECT * FROM exchange_events ORDER BY exchange_id DESC'),
    lastTradeTimeForUser: db.prepare(
        'SELECT trade_time FROM exchange_events WHERE user_id = ? ORDER BY exchange_id DESC LIMIT 1',
    ),
    // See tryFormVerifiedTrade's doc comment for what this is matching.
    findComplementaryUnmatchedEvent: db.prepare(`
        SELECT * FROM exchange_events
        WHERE user_id = ? AND authentication_input_user_id = ? AND dyadic_exchange_authentication_confirmed = 'Y'
          AND exchange_id NOT IN (SELECT exchange_event_one_id FROM verified_trades)
          AND exchange_id NOT IN (SELECT exchange_event_two_id FROM verified_trades)
        ORDER BY exchange_id ASC
        LIMIT 1
    `),
    // Every column here is supplied directly by tryFormVerifiedTrade (no join needed) -- see
    // verified_trades' own schema comment.
    insertVerifiedTrade: db.prepare(`
        INSERT INTO verified_trades
            (user_one_id, user_one_name, user_one_email, card_given_by_user_one_unique_id, user_one_trade_time,
             user_two_id, user_two_name, user_two_email, card_given_by_user_two_unique_id, user_two_trade_time,
             exchange_event_one_id, exchange_event_two_id)
        VALUES (@user_one_id, @user_one_name, @user_one_email, @card_given_by_user_one_unique_id, @user_one_trade_time,
                @user_two_id, @user_two_name, @user_two_email, @card_given_by_user_two_unique_id, @user_two_trade_time,
                @exchange_event_one_id, @exchange_event_two_id)
    `),
    listVerifiedTrades: db.prepare('SELECT * FROM verified_trades ORDER BY trade_id DESC'),

    // "latest" = the most recent exchange_events row per card instance, i.e. its current owner.
    cardInstancesOwnedBy: db.prepare(`
        WITH latest AS (
            SELECT card_instance_id, user_id,
                   ROW_NUMBER() OVER (PARTITION BY card_instance_id ORDER BY exchange_id DESC) AS rn
            FROM exchange_events
        )
        SELECT ci.id, ci.supercard_n, ci.unique_id, ci.copy_number
        FROM card_instances ci
        JOIN latest l ON l.card_instance_id = ci.id AND l.rn = 1
        WHERE l.user_id = ?
        ORDER BY ci.id
    `),
    // Every card instance the user has EVER appeared in exchange_events for, current or past
    // owner alike -- the "Pokedex" query, as opposed to cardInstancesOwnedBy's "current owner
    // only". Reuses idx_exchange_events_user_id, same as cardInstancesOwnedBy.
    cardInstancesCollectedBy: db.prepare(`
        SELECT DISTINCT ci.id, ci.supercard_n, ci.unique_id, ci.copy_number
        FROM card_instances ci
        JOIN exchange_events ee ON ee.card_instance_id = ci.id
        WHERE ee.user_id = ?
        ORDER BY ci.id
    `),
    currentOwnerOfCardInstance: db.prepare(`
        SELECT user_id FROM exchange_events
        WHERE card_instance_id = ?
        ORDER BY exchange_id DESC
        LIMIT 1
    `),
    // Powers the public custody-chain display (CustodyEventWithUser) -- trade_time is aliased
    // back to acquired_at here so that outward-facing shape (and everything downstream of it:
    // serialize.ts, the card detail page's history section) never has to know exchange_events
    // renamed its own column; this rename was about the raw table's readability, not that UI.
    custodyForCardInstance: db.prepare(`
        SELECT ee.trade_time AS acquired_at, u.id AS user_id, u.username, u.name, u.email, u.team,
               u.is_admin, u.collection_view_mode, u.color_challenge_completed, u.sub_objective_completed
        FROM exchange_events ee
        JOIN users u ON u.id = ee.user_id
        WHERE ee.card_instance_id = ?
        ORDER BY ee.exchange_id ASC
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

    // given_card_exchange_id is a self-reference (exchange_events -> exchange_events) --
    // deleting a row some OTHER surviving row still points to would violate that FK, so both
    // revokeCardInstanceFromUser and clearCardInstanceHistory below null out any such
    // reference first. Only needed for these *partial* deletes -- clearAllOwnership wipes the
    // whole table in one statement, so nothing is ever left dangling.
    clearGivenCardExchangeIdReferencingUserOnInstance: db.prepare(`
        UPDATE exchange_events SET given_card_exchange_id = NULL
        WHERE given_card_exchange_id IN (
            SELECT exchange_id FROM exchange_events WHERE card_instance_id = ? AND user_id = ?
        )
    `),
    clearGivenCardExchangeIdReferencingInstance: db.prepare(`
        UPDATE exchange_events SET given_card_exchange_id = NULL
        WHERE given_card_exchange_id IN (SELECT exchange_id FROM exchange_events WHERE card_instance_id = ?)
    `),
    // Same FK-ordering reason as deleteVerifiedTradesForInstance below, scoped down to just
    // this user's own events on this instance -- a verified_trades row referencing one of them
    // documents a trade this user was themselves part of (as the giver or receiver of this
    // exact card), so it can't survive that event being erased; revokeCardInstanceFromUser
    // would otherwise hit the same FK violation deleteExchangeEventsForUserOnInstance guards
    // against for given_card_exchange_id, just via verified_trades instead.
    deleteVerifiedTradesForUserOnInstance: db.prepare(`
        DELETE FROM verified_trades
        WHERE exchange_event_one_id IN (
            SELECT exchange_id FROM exchange_events WHERE card_instance_id = ? AND user_id = ?
        )
           OR exchange_event_two_id IN (
            SELECT exchange_id FROM exchange_events WHERE card_instance_id = ? AND user_id = ?
        )
    `),
    deleteExchangeEventsForUserOnInstance: db.prepare(
        'DELETE FROM exchange_events WHERE card_instance_id = ? AND user_id = ?',
    ),

    // Used by clearCardInstanceHistory/clearAllOwnership below -- verified_trades has to go
    // first, same FK-ordering reason as scripts/import-card-copies.ts's wipe step.
    deleteVerifiedTradesForInstance: db.prepare(`
        DELETE FROM verified_trades
        WHERE exchange_event_one_id IN (SELECT exchange_id FROM exchange_events WHERE card_instance_id = ?)
           OR exchange_event_two_id IN (SELECT exchange_id FROM exchange_events WHERE card_instance_id = ?)
    `),
    deleteExchangeEventsForInstance: db.prepare('DELETE FROM exchange_events WHERE card_instance_id = ?'),
    deleteAllVerifiedTrades: db.prepare('DELETE FROM verified_trades'),
    deleteAllExchangeEvents: db.prepare('DELETE FROM exchange_events'),
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

/** Admin action: marks/unmarks a player as having finished the color challenge -- both
 *  challenges happen outside the app, so this is a manual toggle with no derivation. */
export function setColorChallengeCompleted(userId: number, value: boolean): void {
    stmts.updateColorChallengeCompleted.run(value ? 1 : 0, userId);
}

/** Admin action: marks/unmarks a player as having finished their sub-objective. */
export function setSubObjectiveCompleted(userId: number, value: boolean): void {
    stmts.updateSubObjectiveCompleted.run(value ? 1 : 0, userId);
}

/**
 * Admin action: grants or revokes admin privileges for `userId`. This function itself has no
 * "not your own account" guard -- that's enforced one layer up, in the
 * POST /api/admin/users/:userId/admin route, since it's a request-level concern (who's making
 * the call), not something this bare data-layer setter can know on its own.
 */
export function setIsAdmin(userId: number, value: boolean): void {
    stmts.updateIsAdmin.run(value ? 1 : 0, userId);
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

/**
 * Inserts one exchange_events row, denormalizing everything a researcher would otherwise need
 * a join for onto the row itself (see that table's own schema comment): the receiving user's
 * name/email, the received card's unique_id/type id, the card's actual previous holder's
 * name/email (ground truth, independent of any claim), and this user's own last trade time.
 * `authenticationInputUserId`/`dyadicExchangeAuthenticationConfirmed` carry the self-service
 * collect flow's "who'd you get this from?" answer (see collectCardInstance) -- both stay null
 * for admin-initiated events (grant/transfer/return), which make no claim at all.
 */
export function insertExchangeEvent(
    cardInstanceId: number,
    userId: number,
    authenticationInputUserId: number | null,
    dyadicExchangeAuthenticationConfirmed: 'Y' | 'N' | null,
): ExchangeEventRow {
    const instance = findCardInstance(cardInstanceId)!;
    const user = findUserById(userId)!;
    const previousOwnerId = currentOwnerOfCardInstance(cardInstanceId);
    const previousOwner = previousOwnerId !== undefined ? findUserById(previousOwnerId) : undefined;
    const lastTrade = stmts.lastTradeTimeForUser.get(userId) as { trade_time: string } | undefined;
    const authenticationInputUser =
        authenticationInputUserId !== null ? findUserById(authenticationInputUserId) : undefined;
    // A name belongs in user_authentication_input whenever the "who'd you get this from?"
    // popup was actually shown (dyadicExchangeAuthenticationConfirmed !== null), even if the
    // answer was "Unknown/Other" (authenticationInputUserId null but a popup was answered).
    const userAuthenticationInput: string | null =
        dyadicExchangeAuthenticationConfirmed === null
            ? null
            : (authenticationInputUser?.name ?? 'Unknown/Other');

    const info = stmts.insertExchangeEvent.run({
        card_instance_id: cardInstanceId,
        user_id: userId,
        user_name: user.name,
        user_email: user.email,
        last_trade_time: lastTrade?.trade_time ?? null,
        received_card_unique_id: instance.unique_id,
        received_card_type_id: instance.supercard_n,
        received_card_previous_user_name: previousOwner?.name ?? null,
        received_card_previous_user_email: previousOwner?.email ?? null,
        authentication_input_user_id: authenticationInputUserId,
        user_authentication_input: userAuthenticationInput,
        dyadic_exchange_authentication_confirmed: dyadicExchangeAuthenticationConfirmed,
    });
    return stmts.findExchangeEventById.get(Number(info.lastInsertRowid)) as unknown as ExchangeEventRow;
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
        insertExchangeEvent(instance.id, userId, null, null);
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
    exchangeEventId: number;
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
        const newEvent = insertExchangeEvent(instance.id, userId, claimedFromUserId, matchedExpected);
        stmts.insertSeenSupercard.run(userId, instance.supercard_n);

        let verifiedTradeFormed = false;
        if (matchedExpected === 'Y') {
            verifiedTradeFormed = tryFormVerifiedTrade(newEvent);
        }

        db.exec('COMMIT');
        return { instance, exchangeEventId: newEvent.exchange_id, matchedExpected, verifiedTradeFormed };
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Records `userId`'s answer to the "did you receive this from someone else?" banner for one
 * of their own exchange events (only ever asked when that event had no previous owner to
 * claim -- see collectCardInstance). Rejects silently (returns false) rather than throwing if
 * `exchangeEventId` doesn't belong to `userId`, so a crafted id can't overwrite someone else's
 * answer.
 *
 * @returns true iff the event existed and belonged to `userId`
 */
export function setExchangeEventReceivedFromOther(
    exchangeEventId: number,
    userId: number,
    value: boolean,
): boolean {
    const row = findExchangeEventById(exchangeEventId);
    if (!row || row.user_id !== userId) return false;
    stmts.setReceivedFromOtherPerson.run(value ? 'Y' : 'N', exchangeEventId);
    return true;
}

/**
 * Records `userId`'s free-text answer to the trade-conversation research banner for one of
 * their own exchange events. Same ownership check/contract as
 * setExchangeEventReceivedFromOther.
 */
export function setExchangeEventConversationNotes(
    exchangeEventId: number,
    userId: number,
    notes: string,
): boolean {
    const row = findExchangeEventById(exchangeEventId);
    if (!row || row.user_id !== userId) return false;
    stmts.setConversationNotes.run(notes, exchangeEventId);
    return true;
}

/** A bare exchange_events row by its own id, or undefined if it doesn't exist -- e.g. so the
 *  admin verified-trades listing can pull each side's conversation notes without a join. */
export function findExchangeEventById(exchangeEventId: number): ExchangeEventRow | undefined {
    return stmts.findExchangeEventById.get(exchangeEventId) as ExchangeEventRow | undefined;
}

/** Every card-obtained event, current or historical, not just verified trades -- powers the
 *  admin "Card Events" table. Each row's own two research-prompt columns (see exchange_events'
 *  schema comment) are included as-is, null when that particular prompt was never
 *  asked/answered for this event. */
export function listExchangeEvents(): ExchangeEventRow[] {
    return stmts.listExchangeEvents.all() as unknown as ExchangeEventRow[];
}

/**
 * Call immediately after inserting a dyadic_exchange_authentication_confirmed='Y' exchange
 * event `newEvent` (`Q` gave card `Ca` to `P`, and `P` correctly said it came from `Q`). Looks
 * for a previously-recorded, not-yet-consumed complementary event -- `P` gave some card `Cb`
 * to `Q`, and `Q` correctly said it came from `P` -- and if one exists, records the pair as a
 * verified_trades row and links each event to the other via given_card_exchange_id.
 *
 * Deliberately not looking for *consecutive* events: the complementary event, if it exists at
 * all, could have happened hours earlier (or will complete this trade only once it happens
 * later, when *that* event's own tryFormVerifiedTrade call finds this one). The match query is
 * symmetric, so it doesn't matter which side of the swap gets recorded first.
 *
 * @returns true iff a verified trade was formed
 */
function tryFormVerifiedTrade(newEvent: ExchangeEventRow): boolean {
    if (newEvent.authentication_input_user_id === null) return false; // can't happen when confirmed='Y', but keeps this fn's contract explicit

    const complement = stmts.findComplementaryUnmatchedEvent.get(
        newEvent.authentication_input_user_id,
        newEvent.user_id,
    ) as unknown as ExchangeEventRow | undefined;
    if (!complement) return false;

    // newEvent.user_name/user_email are already the receiver (user_two)'s -- and both cards'
    // unique_ids are already denormalized onto each event -- so the only extra lookup needed
    // is the giver (user_one)'s own profile.
    const userOne = findUserById(newEvent.authentication_input_user_id)!;

    stmts.insertVerifiedTrade.run({
        user_one_id: userOne.id,
        user_one_name: userOne.name,
        user_one_email: userOne.email,
        card_given_by_user_one_unique_id: newEvent.received_card_unique_id,
        user_one_trade_time: newEvent.trade_time,
        user_two_id: newEvent.user_id,
        user_two_name: newEvent.user_name,
        user_two_email: newEvent.user_email,
        card_given_by_user_two_unique_id: complement.received_card_unique_id,
        user_two_trade_time: complement.trade_time,
        exchange_event_one_id: newEvent.exchange_id,
        exchange_event_two_id: complement.exchange_id,
    });

    // Each side now points at the sibling event where this same user gave away the card they
    // got this one in return for (field #12, see exchange_events' own schema comment).
    stmts.setGivenCardExchangeId.run(complement.exchange_id, newEvent.exchange_id);
    stmts.setGivenCardExchangeId.run(newEvent.exchange_id, complement.exchange_id);

    return true;
}

export interface VerifiedTradeRow {
    trade_id: number;
    user_one_id: number;
    user_one_name: string;
    user_one_email: string;
    card_given_by_user_one_unique_id: string;
    user_one_trade_time: string;
    user_two_id: number;
    user_two_name: string;
    user_two_email: string;
    card_given_by_user_two_unique_id: string;
    user_two_trade_time: string;
    exchange_event_one_id: number;
    exchange_event_two_id: number;
    created_at: string;
}

export function listVerifiedTrades(): VerifiedTradeRow[] {
    return stmts.listVerifiedTrades.all() as unknown as VerifiedTradeRow[];
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
 * Admin correction: fully erases `userId`'s participation in `cardInstanceId`'s exchange
 * history -- an undo for a mistaken grant/transfer, deliberately breaking exchange_events'
 * usual append-only guarantee (a documented, explicit exception for this one correction
 * tool, not a normal user-facing action). If this leaves the instance with no exchange
 * history at all, it's simply back in the available pool (findAvailableInstance can hand it
 * out again) -- unlike the old on-scan-manufacture model, the instance row itself is never
 * deleted, since it corresponds to a real pre-generated physical copy (see
 * scripts/import-card-copies.ts) that still exists whether or not anyone currently holds it.
 * Also deletes any verified_trades row built from one of the erased events -- it necessarily
 * documented a trade `userId` was themselves part of (as this exact card's giver or receiver),
 * so it can't survive that event being gone; skipping this would otherwise hit a FOREIGN KEY
 * constraint failure partway through, on any card that happens to have formed a verified trade.
 *
 * Refuses (throwing, rolling back, changing nothing) if `userId` isn't at one of the two ends
 * of the instance's history -- i.e. they traded it away and later got it back (A -> B -> A).
 * Erasing just their turn in the middle would leave two directly-adjacent surviving events
 * with the *same* owner, which Card's data model (src/card.ts's checkRep) forbids outright.
 * That's not merely a display glitch: the client rebuilds this exact history through
 * Card.transferTo() every time the affected student's session loads (see
 * AuthContext.cardsFromJson), and an invalid chain throws there -- far from this tool, and
 * with no student-facing recovery. Catching it here, where it can be reported as a clean,
 * actionable error, is much cheaper than that.
 */
export function revokeCardInstanceFromUser(userId: number, cardInstanceId: number): void {
    db.exec('BEGIN');
    try {
        stmts.deleteVerifiedTradesForUserOnInstance.run(cardInstanceId, userId, cardInstanceId, userId);
        stmts.clearGivenCardExchangeIdReferencingUserOnInstance.run(cardInstanceId, userId);
        stmts.deleteExchangeEventsForUserOnInstance.run(cardInstanceId, userId);

        const remaining = stmts.custodyForCardInstance.all(cardInstanceId) as { user_id: number }[];
        for (let i = 1; i < remaining.length; i++) {
            if (remaining[i].user_id === remaining[i - 1].user_id) {
                throw new Error(
                    "Can't revoke -- this student traded the card away and later got it back, so " +
                        'removing just their turn would leave two identical owners in a row in its ' +
                        'history. Use "Reset" on the card instead to wipe its whole history.',
                );
            }
        }

        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Admin action: wipes ONE card instance's *entire* exchange history, regardless of how many
 * students have held it -- unlike revokeCardInstanceFromUser, which only erases a single
 * user's participation. Any verified_trades rows built from this instance's exchange events are
 * deleted first (foreign keys are enforced, same ordering as scripts/import-card-copies.ts's
 * wipe step). The instance row itself is untouched and simply falls back to the available
 * pool, same as revokeCardInstanceFromUser -- it's a real pre-generated physical copy, never
 * deleted.
 */
export function clearCardInstanceHistory(cardInstanceId: number): void {
    db.exec('BEGIN');
    try {
        stmts.deleteVerifiedTradesForInstance.run(cardInstanceId, cardInstanceId);
        stmts.clearGivenCardExchangeIdReferencingInstance.run(cardInstanceId);
        stmts.deleteExchangeEventsForInstance.run(cardInstanceId);
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Admin action: wipes *every* card instance's exchange history at once, returning the whole
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
        stmts.deleteAllExchangeEvents.run();
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
}

/**
 * Admin correction: takes a card instance back from whoever currently holds it without
 * erasing history -- appends an exchange event to the reserved Unassigned account, same
 * mechanism as any other transfer. The previous holder keeps the card in their collected/
 * Pokedex history; it just stops counting as currently owned by them.
 */
export function returnCardInstance(cardInstanceId: number): void {
    insertExchangeEvent(cardInstanceId, unassignedUser.id, null, null);
}
