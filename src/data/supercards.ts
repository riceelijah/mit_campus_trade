import { Supercard, SupercardData } from '../card';
import raw from './supercards.json';

/**
 * Every Supercard defined in the Campus Trade Master Content Sheet, sorted by collection
 * number. Constructed as real Supercard instances (not left as plain JSON) so checkRep()
 * and the categories getter's defensive copy both apply.
 */
export const SUPERCARDS: Supercard[] = (raw as SupercardData[])
    .map(data => new Supercard(data))
    .sort((a, b) => a.n - b.n);

const byNumber = new Map(SUPERCARDS.map(supercard => [supercard.n, supercard]));

/**
 * @param n a collection/dex number
 * @returns the Supercard numbered `n`, if one exists
 */
export function getSupercard(n: number): Supercard | undefined {
    return byNumber.get(n);
}
