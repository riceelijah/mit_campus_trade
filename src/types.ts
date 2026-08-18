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
 * The shape of a card's frame.
 */
export type FrameType = 'bubble' | 'rect';

/**
 * The Collection page's visibility toggle -- 'collected' shows only cards ever collected,
 * 'seen' additionally includes scanned-but-not-registered cards, 'all' shows the full dex.
 * Persisted per account (see User.collectionViewMode) so it survives across sessions/devices.
 */
export type CollectionViewMode = 'collected' | 'seen' | 'all';

export const VALID_COLLECTION_VIEW_MODES: ReadonlySet<CollectionViewMode> = new Set([
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
