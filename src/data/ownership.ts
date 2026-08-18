import { Card } from '../card';
import { useAuth } from '../auth/AuthContext';

/**
 * This is the one place the app asks "does the current viewer own/collect anything?" --
 * backed by the `owned`/`collected` card lists on AuthContext's `user` (populated from
 * GET /api/me/cards). All are hooks (not plain functions) since this depends on async, live
 * auth state; call them from component bodies like any other hook.
 *
 * `owned` = cards the viewer currently holds (latest owner) -- what upcoming trade
 * functionality will operate on. `collected` = every card instance the viewer has EVER held,
 * including ones since traded away -- what the collection page and a card's history section
 * show.
 */

/**
 * @param n a Supercard's collection/dex number
 * @returns the current viewer's currently-owned Card instance of Supercard `n`, if any
 */
export function useOwnedCardFor(n: number): Card | undefined {
    const { user } = useAuth();
    return user?.owned.find((card) => card.n === n);
}

/**
 * @returns the collection/dex numbers of every Supercard the current viewer currently owns
 *          at least one instance of
 */
export function useOwnedSupercardNumbers(): ReadonlySet<number> {
    const { user } = useAuth();
    return new Set(user?.owned.map((card) => card.n) ?? []);
}

/**
 * @param n a Supercard's collection/dex number
 * @returns the current viewer's Card instance of Supercard `n` from their full ownership
 *          history (current or past), if they've ever collected one
 */
export function useCollectedCardFor(n: number): Card | undefined {
    const { user } = useAuth();
    return user?.collected.find((card) => card.n === n);
}

/**
 * @returns the collection/dex numbers of every Supercard the current viewer has ever
 *          collected at least one instance of (current or past)
 */
export function useCollectedSupercardNumbers(): ReadonlySet<number> {
    const { user } = useAuth();
    return new Set(user?.collected.map((card) => card.n) ?? []);
}
