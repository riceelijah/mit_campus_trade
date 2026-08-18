import { FlagColor, assert } from './types';
import type { Card } from './card';

export class User {
    /**
     * AF(id, username, name, email, team, isAdmin, collected, owned): a registered MIT
     *  Campus Trade student account belonging to the student named `name`, reachable at
     *  `email`, uniquely identified by `id` and by `username` (the local part of `email`,
     *  before '@'), on team `team` (one of the 12 flag colors freshmen packs come in), with
     *  administrative privileges over the site iff `isAdmin`; `collected` is every card
     *  instance this student has ever owned (their "Pokedex" -- includes cards later traded
     *  away), and `owned` is the subset of `collected` this student currently holds (i.e. is
     *  the latest/current owner of).
     *
     * RI:
     *  - Number.isInteger(id) && id >= 1
     *  - username.length > 0
     *  - name.length > 0
     *  - email.length > 0 && email.includes('@')
     *  - no two elements of collected share a card instance id; likewise for owned
     *  - every card in owned also appears (by instance id) in collected, and its
     *    currentOwner equals this User
     *  - every card in collected has this User somewhere in its custody history
     *    (card.hasBeenOwnedBy(this))
     *  - NOTE: collected and owned are allowed to both be empty even for a student who truly
     *    does own cards -- this User class also stands in for *other* students as they
     *    appear inside a Card's custody chain (see card.ts's CustodyRecord), and only their
     *    public profile fields are ever available there, never their own collections. So an
     *    empty collected/owned here means either "this student really has nothing" or "this
     *    User's collection was never loaded"; this class only guarantees that whatever *is*
     *    present is self-consistent, not that non-empty is required.
     *
     * SFRE:
     *  - id, username, name, email, team, isAdmin are all `readonly` and are primitives
     *    (number/string/string-literal-union/boolean), which are immutable in TS/JS, so no
     *    defensive copying is needed anywhere in this class -- there is no mutable state to
     *    expose.
     *  - collected and owned are `Card[]`, and arrays are mutable, so they're stored in
     *    private `_collected`/`_owned` fields and exposed only through getters that return a
     *    fresh copy of the array (so a caller can't splice/push into the rep through the
     *    returned value).
     *  - The individual `Card` elements themselves are aliased, not deep-copied: this class
     *    trusts that a Card, once handed to a User here, is never mutated again. That holds
     *    in practice throughout this app -- Cards are always built fresh from server JSON
     *    (AuthContext's cardsFromJson) and `transferTo` is never called on a Card already
     *    attached to a User's collected/owned list -- but it is a real aliasing tradeoff: if
     *    that usage pattern ever changes, this would need to become a defensive/deep copy.
     */

    private readonly _collected: Card[];
    private readonly _owned: Card[];

    /**
     * Creates a User.
     *
     * @param id unique student account id
     * @param username unique handle, derived from the local part of email
     * @param name student's display name
     * @param email student's email address, must contain '@'
     * @param team student's assigned team color
     * @param isAdmin whether this account has admin privileges over the site
     * @param collected every card instance this student has ever owned, current or past;
     *        defaults to empty. Empty does not necessarily mean "owns nothing" -- see AF.
     * @param owned the subset of `collected` this student currently holds; defaults to empty
     */
    public constructor(
        public readonly id: number,
        public readonly username: string,
        public readonly name: string,
        public readonly email: string,
        public readonly team: FlagColor,
        public readonly isAdmin: boolean,
        collected: Card[] = [],
        owned: Card[] = [],
    ) {
        this._collected = [...collected];
        this._owned = [...owned];
        this.checkRep();
    }

    /**
     * @returns every card instance this student has ever held (current or past); a fresh
     *          copy of the array, safe for the caller to mutate
     */
    public get collected(): Card[] {
        return [...this._collected];
    }

    /**
     * @returns every card instance this student currently holds (i.e. they are the latest
     *          owner of); a fresh copy of the array, safe for the caller to mutate
     */
    public get owned(): Card[] {
        return [...this._owned];
    }

    /**
     * @param other another User
     * @returns true iff `other` refers to the same account as this User
     */
    public equals(other: User): boolean {
        return this.id === other.id;
    }

    private checkRep(): void {
        assert(Number.isInteger(this.id) && this.id >= 1, 'id must be a positive integer');
        assert(this.username.length > 0, 'username must be non-empty');
        assert(this.name.length > 0, 'name must be non-empty');
        assert(this.email.length > 0 && this.email.includes('@'), 'email must be non-empty and contain @');

        const collectedIds = this._collected.map((card) => card.id);
        assert(
            new Set(collectedIds).size === collectedIds.length,
            'collected must not contain duplicate card instances',
        );

        const ownedIds = this._owned.map((card) => card.id);
        assert(new Set(ownedIds).size === ownedIds.length, 'owned must not contain duplicate card instances');

        const collectedIdSet = new Set(collectedIds);
        for (const card of this._owned) {
            assert(collectedIdSet.has(card.id), 'every owned card must also appear in collected');
            assert(
                card.currentOwner?.equals(this) === true,
                'every owned card must currently be owned by this user',
            );
        }

        for (const card of this._collected) {
            assert(
                card.hasBeenOwnedBy(this),
                'every collected card must have this user somewhere in its custody history',
            );
        }
    }
}
