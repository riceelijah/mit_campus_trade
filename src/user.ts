import { FlagColor, assert } from './types';

export class User {
    /**
     * AF(id, username, name, email, team, isAdmin): a registered MIT Campus Trade student
     *  account belonging to the student named `name`, reachable at `email`, uniquely
     *  identified by `id` and by `username` (the local part of `email`, before '@'), on team
     *  `team` (one of the 12 flag colors freshmen packs come in), with administrative
     *  privileges over the site iff `isAdmin`.
     *
     * RI:
     *  - Number.isInteger(id) && id >= 1
     *  - username.length > 0
     *  - name.length > 0
     *  - email.length > 0 && email.includes('@')
     *
     * SFRE:
     *  - id, username, name, email, team, isAdmin are all `readonly` and are primitives
     *    (number/string/string-literal-union/boolean), which are immutable in TS/JS, so no
     *    defensive copying is needed anywhere in this class -- there is no mutable state to
     *    expose.
     */

    /**
     * Creates a User.
     *
     * @param id unique student account id
     * @param username unique handle, derived from the local part of email
     * @param name student's display name
     * @param email student's email address, must contain '@'
     * @param team student's assigned team color
     * @param isAdmin whether this account has admin privileges over the site
     */
    public constructor(
        public readonly id: number,
        public readonly username: string,
        public readonly name: string,
        public readonly email: string,
        public readonly team: FlagColor,
        public readonly isAdmin: boolean,
    ) {
        this.checkRep();
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
    }
}
