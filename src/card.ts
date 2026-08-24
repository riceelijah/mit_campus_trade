import { FlagColor, VALID_COLORS, assert } from './types';
import { User } from './user';

/**
 * The full set of content fields that define a Supercard, as sourced from one row of the
 * "Campus Trade Master Content Sheet - Ordered Card Master" spreadsheet.
 *
 * Deliberately narrower than the sheet itself: columns the app never reads (frame/art asset
 * filenames, working file locations, the interview link/website link/QR code file -- art is
 * located by convention off `n`, not by filename; see CardArt/FlippableCard) aren't parsed
 * into this type at all, so there's no dead data riding along in every Card/Supercard, in
 * supercards.json, or over the API.
 */
export interface SupercardData {
    /** collection/dex number of the card (spreadsheet column: ID) */
    n: number;
    /** card title/name (Card_Title) */
    title: string;
    /** short cover quote (Short_Quote) */
    shortQuote: string;
    /** one or more categories the card is filed under (Categories, comma-separated in sheet) */
    categories: string[];
    /** team flag color the card is printed in (Color) */
    color: FlagColor;
    /** credit for the card art, if known (Graphic Attribution Final) */
    artist?: string;
    /** printed interview excerpt shown on the back of the card (Excerpt (printed)) */
    description: string;
    /** id of the source interview highlight (Highlight ID) */
    highlightId: string;
    /** exchange ritual prompt/question (Exchange question) */
    question: string;
    /** exchange cost tier, 1-3 (Exchange level) */
    cost: number;
    /** who is quoted in `description` (Speaker name) */
    descriptionAttribution: string;
    /** the speaker's role/title (Speaker details) */
    speakerDetails: string;
    /** date of the source highlight, as printed in the sheet (Highlight date) */
    highlightDate: string;
}

const REQUIRED_COLUMNS = [
    'ID',
    'Card_Title',
    'Short_Quote',
    'Categories',
    'Color',
    'Excerpt (printed)',
    'Highlight ID',
    'Exchange question',
    'Exchange level',
    'Speaker name',
    'Speaker details',
    'Highlight date',
] as const;

/**
 * Throws a clear error naming the missing column(s) rather than letting a later
 * `row[key].trim()` throw a cryptic "Cannot read properties of undefined" deep inside
 * parsing -- the master content sheet's headers (including the literal leading space in
 * ' Type') are fragile-by-nature since they're hand-maintained in a spreadsheet.
 */
function assertHasRequiredColumns(row: Record<string, string>): void {
    const missing = REQUIRED_COLUMNS.filter((col) => row[col] === undefined);
    if (missing.length > 0) {
        throw new Error(
            `CSV row is missing required column(s): ${missing.join(', ')}. Check the master ` +
                `content sheet's headers haven't changed (note ' Type' has a leading space).`,
        );
    }
}

/**
 * Parses one already-parsed CSV row (keyed by the master content sheet's exact column
 * headers) into a SupercardData. Does not validate the result's content -- the Supercard/Card
 * constructors do that via checkRep() -- but does check that every expected column is
 * present, so a renamed/missing header fails with a clear message instead of a cryptic one.
 *
 * @param row one row of the Campus Trade Master Content Sheet, keyed by column header
 * @returns the SupercardData described by `row`
 */
export function parseSupercardRow(row: Record<string, string>): SupercardData {
    assertHasRequiredColumns(row);

    const optional = (value: string | undefined): string | undefined => {
        const trimmed = value?.trim();
        return trimmed && trimmed.length > 0 ? trimmed : undefined;
    };

    return {
        n: parseInt(row['ID'], 10),
        title: row['Card_Title'].trim(),
        shortQuote: row['Short_Quote'].trim(),
        categories: row['Categories']
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0),
        color: row['Color'].trim() as FlagColor,
        artist: optional(row['Graphic Attribution Final']),
        description: row['Excerpt (printed)'].trim(),
        highlightId: row['Highlight ID'].trim(),
        question: row['Exchange question'].trim(),
        cost: parseInt(row['Exchange level'], 10),
        descriptionAttribution: row['Speaker name'].trim(),
        speakerDetails: row['Speaker details'].trim(),
        highlightDate: row['Highlight date'].trim(),
    };
}

export class Supercard {
    /**
     * AF(n, title, shortQuote, categories, color, artist, description, highlightId, question,
     *    cost, descriptionAttribution, speakerDetails, highlightDate):
     *  the template/definition (as opposed to a specific physical instance) of the MIT Campus
     *  Trade card numbered `n`, titled `title`, with cover quote `shortQuote`, filed under
     *  `categories`, printed in team color `color`, whose art is credited to `artist`, showing
     *  interview excerpt `description` (said by `descriptionAttribution`, whose role is
     *  `speakerDetails`, on `highlightDate`, sourced from `highlightId`), and traded via the
     *  ritual prompted by `question` at exchange cost `cost`.
     *
     * RI:
     *  - Number.isInteger(n) && n >= 1
     *  - title.length > 0 && shortQuote.length > 0
     *  - categories.length >= 1 && every element of categories has length > 0
     *  - color is one of the 12 FlagColor values
     *  - artist, if present, has length > 0
     *  - description.length > 0 && highlightId.length > 0 && question.length > 0
     *  - Number.isInteger(cost) && 1 <= cost <= 3
     *  - descriptionAttribution.length > 0 && speakerDetails.length > 0 && highlightDate.length > 0
     *
     * SFRE:
     *  - Every field except `categories` is `readonly` and a primitive (number/string/
     *    string-literal union), so it's immutable and safe to hand out directly.
     *  - `categories: string[]` is mutable, so it is NOT exposed as a public field. It's
     *    stored in a private `_categories`, and the public `categories` getter returns a
     *    fresh copy on each call, so callers can't mutate the rep by holding onto the
     *    returned array.
     */

    public readonly n: number;
    public readonly title: string;
    public readonly shortQuote: string;
    private readonly _categories: string[];
    public readonly color: FlagColor;
    public readonly artist?: string;
    public readonly description: string;
    public readonly highlightId: string;
    public readonly question: string;
    public readonly cost: number;
    public readonly descriptionAttribution: string;
    public readonly speakerDetails: string;
    public readonly highlightDate: string;

    /**
     * Creates a Supercard.
     *
     * @param data the full set of content fields for this card
     */
    public constructor(data: SupercardData) {
        this.n = data.n;
        this.title = data.title;
        this.shortQuote = data.shortQuote;
        this._categories = [...data.categories];
        this.color = data.color;
        this.artist = data.artist;
        this.description = data.description;
        this.highlightId = data.highlightId;
        this.question = data.question;
        this.cost = data.cost;
        this.descriptionAttribution = data.descriptionAttribution;
        this.speakerDetails = data.speakerDetails;
        this.highlightDate = data.highlightDate;
        // Call Supercard's own checkRep(), not a dynamically-dispatched override: if `this`
        // is actually a Card, `Card`'s fields (e.g. `id`) aren't assigned yet at this point
        // in `super(data)`, so `this.checkRep()` here would run Card's checkRep() too early
        // and spuriously fail. Card's own constructor calls `this.checkRep()` (polymorphic,
        // and safe there) once its own fields are set.
        Supercard.prototype.checkRep.call(this);
    }

    /**
     * Builds a Supercard from one already-parsed row of the Campus Trade Master Content
     * Sheet CSV (keyed by the sheet's exact column headers).
     *
     * @param row one row of the master content sheet
     * @returns the Supercard described by `row`
     */
    public static fromRow(row: Record<string, string>): Supercard {
        return new Supercard(parseSupercardRow(row));
    }

    /**
     * @returns this card's categories; a fresh copy, safe for the caller to mutate
     */
    public get categories(): string[] {
        return [...this._categories];
    }

    protected checkRep(): void {
        assert(Number.isInteger(this.n) && this.n >= 1, 'n must be a positive integer');
        assert(this.title.length > 0, 'title must be non-empty');
        assert(this.shortQuote.length > 0, 'shortQuote must be non-empty');
        assert(this._categories.length >= 1, 'categories must have at least one entry');
        assert(
            this._categories.every((c) => c.length > 0),
            'no category may be empty',
        );
        assert(VALID_COLORS.has(this.color), 'color must be one of the 12 FlagColor values');
        assert(this.artist === undefined || this.artist.length > 0, 'artist, if present, must be non-empty');
        assert(this.description.length > 0, 'description must be non-empty');
        assert(this.highlightId.length > 0, 'highlightId must be non-empty');
        assert(this.question.length > 0, 'question must be non-empty');
        assert(
            Number.isInteger(this.cost) && this.cost >= 1 && this.cost <= 3,
            'cost must be an integer 1-3',
        );
        assert(this.descriptionAttribution.length > 0, 'descriptionAttribution must be non-empty');
        assert(this.speakerDetails.length > 0, 'speakerDetails must be non-empty');
        assert(this.highlightDate.length > 0, 'highlightDate must be non-empty');
    }
}

/**
 * One entry in a Card's ownership history: a student who held the card, and when they
 * acquired it.
 */
export interface CustodyRecord {
    readonly owner: User;
    readonly acquiredAt: Date;
}

export class Card extends Supercard {
    /**
     * AF(n, ..., id, uniqueId, custody): a specific physical/digital instance, numbered `id`
     *  internally and identified to students by the 4-character `uniqueId` printed in its own
     *  QR code (distinct from every other copy ever printed, including other copies of the
     *  same Supercard `n`), of the Supercard template described by the inherited fields (n,
     *  title, ... highlightDate -- see Supercard's AF), which has changed hands over time as
     *  recorded by `custody`: a chronological list of {owner, acquiredAt} pairs, one per
     *  student who has held this card, in the order they held it (the current owner is the
     *  last entry, or nobody yet if custody is empty).
     *
     * RI:
     *  - Supercard's RI holds for the inherited fields
     *  - Number.isInteger(id) && id >= 1
     *  - uniqueId.length > 0
     *  - for all i, 1 <= i < custody.length: !custody[i].owner.equals(custody[i - 1].owner)
     *    (no student can trade a card to themselves / re-receive it from themselves
     *    consecutively)
     *
     * SFRE:
     *  - `id` and `uniqueId` are `readonly` primitives, safe to expose directly.
     *  - `custody` is mutable (it's an array of records each containing a mutable `Date`),
     *    so it's stored in a private `_custody` and only exposed through:
     *      - the `custody` getter, which returns a new array of new {owner, acquiredAt}
     *        objects, each with a fresh `Date` (`new Date(record.acquiredAt.getTime())`), so
     *        a caller can never mutate the rep through the returned value;
     *      - `transferTo`, which itself stores a *copy* of its `acquiredAt` argument rather
     *        than the caller's `Date` object, so the rep can't later be mutated through a
     *        reference the caller kept.
     *  - `owner: User` references are shared, not copied, because `User` has no mutable
     *    state (all of its fields are `readonly` primitives -- see User's SFRE), so aliasing
     *    it is safe.
     */

    private _custody: CustodyRecord[];

    /**
     * Creates a Card: one instance of a Supercard, distinguished from other instances of the
     * same collection number by `id`/`uniqueId`.
     *
     * @param data the Supercard content fields this card is an instance of
     * @param id individual instance id of this card, unique among cards
     * @param uniqueId the 4-character id printed in this specific copy's QR code, unique
     *        among every copy ever printed
     * @param initialOwner the first student to own this card, if any
     */
    public constructor(
        data: SupercardData,
        public readonly id: number,
        public readonly uniqueId: string,
        initialOwner?: User,
    ) {
        super(data);
        this._custody = initialOwner ? [{ owner: initialOwner, acquiredAt: new Date() }] : [];
        this.checkRep();
    }

    /**
     * @returns this card's ownership history, oldest first; a fresh copy (including fresh
     *          Date objects), safe for the caller to mutate
     */
    public get custody(): CustodyRecord[] {
        return this._custody.map((record) => ({
            owner: record.owner,
            acquiredAt: new Date(record.acquiredAt.getTime()),
        }));
    }

    /**
     * @returns the student who currently owns this card, or undefined if it has never been
     *          owned
     */
    public get currentOwner(): User | undefined {
        return this._custody.length > 0 ? this._custody[this._custody.length - 1].owner : undefined;
    }

    /**
     * @param user a student
     * @returns true iff `user` appears anywhere in this card's custody history (as a past or
     *          current owner)
     */
    public hasBeenOwnedBy(user: User): boolean {
        return this._custody.some((record) => record.owner.equals(user));
    }

    /**
     * Records that this card has been traded to `newOwner`.
     *
     * @param newOwner the student who now owns this card; must not be the current owner
     * @param acquiredAt when the trade happened, defaults to now
     */
    public transferTo(newOwner: User, acquiredAt: Date = new Date()): void {
        const current = this.currentOwner;
        assert(
            current === undefined || !current.equals(newOwner),
            'cannot transfer a card to its current owner',
        );
        this._custody.push({ owner: newOwner, acquiredAt: new Date(acquiredAt.getTime()) });
        this.checkRep();
    }

    protected checkRep(): void {
        super.checkRep();
        assert(Number.isInteger(this.id) && this.id >= 1, 'id must be a positive integer');
        assert(this.uniqueId.length > 0, 'uniqueId must be non-empty');
        for (let i = 1; i < this._custody.length; i++) {
            assert(
                !this._custody[i].owner.equals(this._custody[i - 1].owner),
                'consecutive custody entries must not have the same owner',
            );
        }
    }
}

/**
 * Builds a Card from one already-parsed row of the Campus Trade Master Content Sheet CSV,
 * as a specific numbered instance.
 *
 * Defined as a standalone function rather than a `Card.fromRow` static method because a
 * static method here would need extra required parameters (`id`) beyond `Supercard.fromRow`,
 * which TypeScript disallows for a subclass overriding a same-named static member.
 *
 * @param row one row of the master content sheet
 * @param id individual instance id of this card, unique among cards
 * @param uniqueId the 4-character id printed in this specific copy's QR code
 * @param initialOwner the first student to own this card, if any
 * @returns the Card described by `row`, numbered `id`
 */
export function cardFromRow(
    row: Record<string, string>,
    id: number,
    uniqueId: string,
    initialOwner?: User,
): Card {
    return new Card(parseSupercardRow(row), id, uniqueId, initialOwner);
}
