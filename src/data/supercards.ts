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
