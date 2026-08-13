/**
 * One of the 12 flag colors that MIT Campus Trade teams (and their cards) come in.
 */
export type FlagColor = 'red' | 'blue' | 'green' | 'yellow' | 'orange' | 'purple'
    | 'pink' | 'black' | 'white' | 'brown' | 'gold' | 'silver';

export const VALID_COLORS: ReadonlySet<FlagColor> = new Set([
    'red', 'blue', 'green', 'yellow', 'orange', 'purple',
    'pink', 'black', 'white', 'brown', 'gold', 'silver',
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
