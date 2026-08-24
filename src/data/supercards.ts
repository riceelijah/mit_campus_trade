import { Supercard, SupercardData } from '../card';
import { assert } from '../types';
import raw from './supercards.json';

/**
 * Every Supercard defined in the Campus Trade Master Content Sheet, sorted by collection
 * number. Constructed as real Supercard instances (not left as plain JSON) so checkRep()
 * and the categories getter's defensive copy both apply.
 */
export const SUPERCARDS: Supercard[] = (raw as SupercardData[])
    .map((data) => new Supercard(data))
    .sort((a, b) => a.n - b.n);

const byNumber = new Map(SUPERCARDS.map((supercard) => [supercard.n, supercard]));

/**
 * @param n a collection/dex number
 * @returns the Supercard numbered `n`, if one exists
 */
export function getSupercard(n: number): Supercard | undefined {
    return byNumber.get(n);
}

const byHighlightId = new Map<string, Supercard>();
for (const supercard of SUPERCARDS) {
    assert(!byHighlightId.has(supercard.highlightId), `Duplicate highlightId: ${supercard.highlightId}`);
    byHighlightId.set(supercard.highlightId, supercard);
}

/**
 * Looks up a Supercard by its Highlight ID -- the identifier printed in each physical card's
 * QR code and used as this app's /cards/:highlightId route param, as opposed to `n`
 * (the internal collection/dex number).
 *
 * @param highlightId a card's Highlight ID, as printed in its QR code
 * @returns the Supercard with that highlightId, if one exists
 */
export function getSupercardByHighlightId(highlightId: string): Supercard | undefined {
    return byHighlightId.get(highlightId);
}

/**
 * Every team color actually in use among SUPERCARDS, sorted -- as opposed to types.ts's
 * VALID_COLORS (the full 12-color universe, whether or not a card is printed in it yet).
 * Derived from the real card data rather than hardcoded, so a future content-sheet update (a
 * new color in use) is reflected automatically. Shared by CollectionPage's and AdminPage's
 * color filters, so both stay in sync with each other and with the data by construction.
 */
export const ALL_COLORS = [...new Set(SUPERCARDS.map((sc) => sc.color))].sort();

/** Every category tag actually in use among SUPERCARDS, sorted -- same derivation/sharing
 *  rationale as ALL_COLORS. */
export const ALL_CATEGORIES = [...new Set(SUPERCARDS.flatMap((sc) => sc.categories))].sort();
