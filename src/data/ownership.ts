import { Card } from '../card';
import { useAuth } from '../auth/AuthContext';

/**
 * This is the one place the app asks "does the current viewer own anything?" -- backed by
 * the logged-in viewer's owned cards from AuthContext (fetched from GET /api/me/cards).
 * Both are hooks (not plain functions) since ownership now depends on async, live auth
 * state; call them from component bodies like any other hook.
 */

/**
 * @param n a Supercard's collection/dex number
 * @returns the current viewer's Card instance of Supercard `n`, if they own one
 */
export function useOwnedCardFor(n: number): Card | undefined {
    const { ownedCards } = useAuth();
    return ownedCards.find((card) => card.n === n);
}

/**
 * @returns the collection/dex numbers of every Supercard the current viewer owns at least
 *          one instance of
 */
export function useOwnedSupercardNumbers(): ReadonlySet<number> {
    const { ownedCards } = useAuth();
    return new Set(ownedCards.map((card) => card.n));
}
