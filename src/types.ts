/**
 * One of the 12 flag colors that MIT Campus Trade teams (and their cards) come in.
 */
export type FlagColor =
    | 'red'
    | 'blue'
    | 'green'
    | 'yellow'
    | 'orange'
    | 'purple'
    | 'pink'
    | 'black'
    | 'white'
    | 'brown'
    | 'gold'
    | 'silver';

export const VALID_COLORS: ReadonlySet<FlagColor> = new Set([
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'black',
    'white',
    'brown',
    'gold',
    'silver',
]);

/**
 * The Collection page's visibility toggle -- 'owned' shows only cards currently held (the
 * narrowest view: a subset of 'collected'), 'collected' shows every card ever collected
 * (including ones since traded away), 'seen' additionally includes scanned-but-not-registered
 * cards, 'all' shows the full dex. Each is a strict superset of the one before it. Persisted
 * per account (see User.collectionViewMode) so it survives across sessions/devices.
 */
export type CollectionViewMode = 'owned' | 'collected' | 'seen' | 'all';

export const VALID_COLLECTION_VIEW_MODES: ReadonlySet<CollectionViewMode> = new Set([
    'owned',
    'collected',
    'seen',
    'all',
]);

/**
 * Throws an Error with `message` if `condition` is false.
 * Used by every class's checkRep() to enforce its rep invariant.
 */
export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * The public-facing shape of a user, as sent/received over the API (no password_hash).
 * Shared between client and server so the two never redeclare it independently and drift.
 */
export interface PublicUserJson {
    id: number;
    username: string;
    name: string;
    email: string;
    team: FlagColor;
    isAdmin: boolean;
    collectionViewMode: CollectionViewMode;
}

/** One entry in a card instance's ownership history, as sent over the API. */
export interface PublicCustodyEventJson {
    acquiredAt: string;
    owner: PublicUserJson;
}

/** One physical/digital card instance and its full custody chain, as sent over the API. */
export interface PublicCardInstanceJson {
    cardInstanceId: number;
    supercardN: number;
    /** The 4-character id printed in this specific copy's QR code / URL, unique among every
     *  copy ever printed -- as opposed to supercardN, which identifies the card *design*. */
    uniqueId: string;
    custody: PublicCustodyEventJson[];
}

/** The shape returned by GET /api/me/cards. */
export interface MyCardsJson {
    collected: PublicCardInstanceJson[];
    /** Supercard (dex) numbers the viewer has scanned via "Just looking" or collected. */
    seen: number[];
}

/** The shape returned by GET /api/admin/users/:userId/cards. */
export interface AdminUserCardsJson {
    /** Every card instance this student has ever held, current or past (their full history --
     *  unlike the self-service endpoint's "collected", named "cards" here since the admin UI
     *  needs to distinguish currently-owned from historical within the same list). */
    cards: PublicCardInstanceJson[];
    seen: number[];
}

/** The shape returned by GET /api/cards/:uniqueId/collect-candidates -- powers the "who'd you
 *  get this from?" popup shown when a scanned/visited card instance already has an owner. */
export interface CollectCandidatesJson {
    /** False when there's no one to ask about (never collected, or the viewer is themselves
     *  the current owner) -- the client should skip straight to collecting, no popup. */
    hasPreviousOwner: boolean;
    /** The previous owner mixed in with up to 3 random other users, already shuffled
     *  server-side, with nothing here indicating which entry is the real previous owner --
     *  that's checked entirely server-side by POST /api/me/collect, specifically so the
     *  correct answer can't be read off this response (e.g. via devtools) to cheat the quiz.
     *  Empty when hasPreviousOwner is false. */
    candidates: PublicUserJson[];
}

/** One row of GET /api/admin/verified-trades -- a two-way trade the system detected by
 *  matching up correctly-attributed custody events on both sides (see server/db.ts's
 *  tryFormVerifiedTrade). */
export interface VerifiedTradeJson {
    id: number;
    userX: { id: number; username: string; name: string };
    cardA: { cardInstanceId: number; uniqueId: string; supercardN: number };
    datetimeX: string;
    userY: { id: number; username: string; name: string };
    cardB: { cardInstanceId: number; uniqueId: string; supercardN: number };
    datetimeY: string;
}
