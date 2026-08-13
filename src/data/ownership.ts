import { Card } from '../card';

/**
 * Integration stub: this is the one place the app asks "does the current viewer own
 * anything?" There's no auth or persistence layer yet, so both functions below are
 * hardcoded to "nobody owns anything." When real login + ownership data exists, wire it
 * in here -- every page that needs ownership data (CollectionPage, CardDetailPage) already
 * calls through these two functions rather than reaching for owned-card data directly.
 */

/**
 * @param _n a Supercard's collection/dex number
 * @returns the current viewer's Card instance of Supercard `_n`, if they own one
 */
export function getOwnedCardFor(_n: number): Card | undefined {
    return undefined;
}

/**
 * @returns the collection/dex numbers of every Supercard the current viewer owns at least
 *          one instance of
 */
export function getOwnedSupercardNumbers(): ReadonlySet<number> {
    return new Set();
}
