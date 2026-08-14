import { describe, it, expect } from 'vitest';
import { parseSupercardRow, Supercard, Card, cardFromRow } from './card';
import { User } from './user';

const VALID_ROW: Record<string, string> = {
    ID: '1',
    Card_Title: 'Test Card',
    Short_Quote: 'A short quote',
    Categories: 'Dorms, Clubs',
    Color: 'red',
    ' Type': 'rect',
    '@FrontFrame': 'front.png',
    '@BackFrame': 'back.png',
    '@Art_File': 'art.png',
    'Graphic Attribution Final': '',
    'Graphic File Location': '',
    'Excerpt (printed)': 'An interview excerpt.',
    'Link to highlight': 'https://example.com',
    'Highlight ID': 'H1',
    'Website link': 'https://example.com/1',
    '@QR_Code': 'qr.png',
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
        expect(data.frameType).toBe('rect');
        expect(data.cost).toBe(2);
        expect(data.artist).toBeUndefined();
    });

    it('throws a clear error naming the missing column, instead of a cryptic TypeError', () => {
        const { [' Type']: _omitted, ...rowMissingType } = VALID_ROW;
        expect(() => parseSupercardRow(rowMissingType)).toThrow(/missing required column.*Type/i);
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

    it('rejects an invalid frameType via checkRep', () => {
        const badRow = { ...VALID_ROW, ' Type': 'triangle' };
        expect(() => Supercard.fromRow(badRow)).toThrow();
    });
});

describe('Card', () => {
    it('requires a positive integer instance id', () => {
        const supercard = Supercard.fromRow(VALID_ROW);
        expect(() => new Card(supercard, 0)).toThrow();
        expect(() => new Card(supercard, 1)).not.toThrow();
    });

    it('has no current owner and empty custody when created without an initial owner', () => {
        const card = cardFromRow(VALID_ROW, 1);
        expect(card.currentOwner).toBeUndefined();
        expect(card.custody).toEqual([]);
    });

    it('transferTo appends a custody record and updates the current owner', () => {
        const card = cardFromRow(VALID_ROW, 1);
        const alice = studentAt(1);
        card.transferTo(alice);
        expect(card.currentOwner?.equals(alice)).toBe(true);
        expect(card.custody).toHaveLength(1);
    });

    it('transferTo rejects transferring a card to its current owner', () => {
        const card = cardFromRow(VALID_ROW, 1);
        const alice = studentAt(1);
        card.transferTo(alice);
        expect(() => card.transferTo(alice)).toThrow();
    });

    it('allows a card to return to a previous (non-consecutive) owner', () => {
        const card = cardFromRow(VALID_ROW, 1);
        const alice = studentAt(1);
        const bob = studentAt(2);
        card.transferTo(alice);
        card.transferTo(bob);
        expect(() => card.transferTo(alice)).not.toThrow();
        expect(card.currentOwner?.equals(alice)).toBe(true);
        expect(card.custody).toHaveLength(3);
    });

    it('custody getter returns a defensive copy that cannot mutate the card', () => {
        const card = cardFromRow(VALID_ROW, 1, studentAt(1));
        const custody = card.custody;
        custody.pop();
        expect(card.custody).toHaveLength(1);
    });
});
