import { FlagColor, assert } from './types';

export class User {
    /**
     * AF(id, name, email, team): a registered MIT Campus Trade student account belonging to
     *  the student named `name`, reachable at `email`, uniquely identified by `id`, and on
     *  team `team` (if they've been assigned one -- a team's color is one of the 12 flag
     *  colors freshmen packs come in) or on no team yet if `team` is undefined.
     *
     * RI:
     *  - Number.isInteger(id) && id >= 1
     *  - name.length > 0
     *  - email.length > 0 && email.includes('@')
     *
     * SFRE:
     *  - id, name, email, team are all `readonly` and are primitives (number/string/
     *    string-literal-union), which are immutable in TS/JS, so no defensive copying is
     *    needed anywhere in this class -- there is no mutable state to expose.
     */

    /**
     * Creates a User.
     *
     * @param id unique student account id
     * @param name student's display name
     * @param email student's email address, must contain '@'
     * @param team student's assigned team color, if any
     */
    public constructor(
        public readonly id: number,
        public readonly name: string,
        public readonly email: string,
        public readonly team?: FlagColor,
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
        assert(this.name.length > 0, 'name must be non-empty');
        assert(this.email.length > 0 && this.email.includes('@'), 'email must be non-empty and contain @');
    }
}
