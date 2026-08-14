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
