import { describe, it, expect } from 'vitest';
import { parseSupercardRow, Supercard, Card, cardFromRow } from './card';
import { User } from './user';

const VALID_ROW: Record<string, string> = {
    ID: '1',
    Card_Title: 'Test Card',
    Short_Quote: 'A short quote',
    Categories: 'Dorms, Clubs',
    Color: 'red',
    'Graphic Attribution Final': '',
    'Excerpt (printed)': 'An interview excerpt.',
    'Highlight ID': 'H1',
    'Exchange question': 'What is your favorite dorm?',
    'Exchange level': '2',
    'Speaker name': 'A Student',
    'Speaker details': 'Sophomore',
    'Highlight date': '2026-01-01',
};

function studentAt(id: number): User {
    return new User(id, `student${id}`, `Student ${id}`, `student${id}@mit.edu`, 'red', false);
}

describe('parseSupercardRow', () => {
    it('parses a well-formed row into the expected SupercardData', () => {
        const data = parseSupercardRow(VALID_ROW);
        expect(data.n).toBe(1);
        expect(data.title).toBe('Test Card');
        expect(data.categories).toEqual(['Dorms', 'Clubs']);
        expect(data.color).toBe('red');
        expect(data.cost).toBe(2);
        expect(data.artist).toBeUndefined();
    });

    it('throws a clear error naming the missing column, instead of a cryptic TypeError', () => {
        const { 'Excerpt (printed)': _omitted, ...rowMissingExcerpt } = VALID_ROW;
        expect(() => parseSupercardRow(rowMissingExcerpt)).toThrow(/missing required column.*Excerpt/i);
    });

    it('throws naming every missing column when several are absent', () => {
        const { ID: _id, Color: _color, ...rowMissingTwo } = VALID_ROW;
        expect(() => parseSupercardRow(rowMissingTwo)).toThrow(/ID.*Color|Color.*ID/);
    });
});

describe('Supercard', () => {
    it('constructs successfully from a valid row via Supercard.fromRow', () => {
        expect(() => Supercard.fromRow(VALID_ROW)).not.toThrow();
    });

    it('rejects an invalid color via checkRep', () => {
        const badRow = { ...VALID_ROW, Color: 'not-a-real-color' };
        expect(() => Supercard.fromRow(badRow)).toThrow();
    });
});

describe('Card', () => {
    it('requires a positive integer instance id', () => {
        const supercard = Supercard.fromRow(VALID_ROW);
        expect(() => new Card(supercard, 0, 'AAAA')).toThrow();
        expect(() => new Card(supercard, 1, 'AAAA')).not.toThrow();
    });

    it('requires a non-empty uniqueId', () => {
        const supercard = Supercard.fromRow(VALID_ROW);
        expect(() => new Card(supercard, 1, '')).toThrow();
    });

    it('has no current owner and empty custody when created without an initial owner', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        expect(card.currentOwner).toBeUndefined();
        expect(card.custody).toEqual([]);
    });

    it('transferTo appends a custody record and updates the current owner', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        const alice = studentAt(1);
        card.transferTo(alice);
        expect(card.currentOwner?.equals(alice)).toBe(true);
        expect(card.custody).toHaveLength(1);
    });

    it('transferTo rejects transferring a card to its current owner', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        const alice = studentAt(1);
        card.transferTo(alice);
        expect(() => card.transferTo(alice)).toThrow();
    });

    it('allows a card to return to a previous (non-consecutive) owner', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        const alice = studentAt(1);
        const bob = studentAt(2);
        card.transferTo(alice);
        card.transferTo(bob);
        expect(() => card.transferTo(alice)).not.toThrow();
        expect(card.currentOwner?.equals(alice)).toBe(true);
        expect(card.custody).toHaveLength(3);
    });

    it('custody getter returns a defensive copy that cannot mutate the card', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA', studentAt(1));
        const custody = card.custody;
        custody.pop();
        expect(card.custody).toHaveLength(1);
    });

    it('hasBeenOwnedBy is true for past and current owners, false for someone who never held it', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        const alice = studentAt(1);
        const bob = studentAt(2);
        const carol = studentAt(3);
        card.transferTo(alice);
        card.transferTo(bob);
        expect(card.hasBeenOwnedBy(alice)).toBe(true);
        expect(card.hasBeenOwnedBy(bob)).toBe(true);
        expect(card.hasBeenOwnedBy(carol)).toBe(false);
    });

    it('hasBeenOwnedBy is false for everyone when a card has never been owned', () => {
        const card = cardFromRow(VALID_ROW, 1, 'AAAA');
        expect(card.hasBeenOwnedBy(studentAt(1))).toBe(false);
    });
});
