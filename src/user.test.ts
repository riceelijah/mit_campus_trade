import { describe, it, expect } from 'vitest';
import { User } from './user';
import { cardFromRow, Card } from './card';

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

function makeCard(id: number, owners: User[]): Card {
    const card = cardFromRow(VALID_ROW, id);
    for (const owner of owners) card.transferTo(owner);
    return card;
}

describe('User', () => {
    it('round-trips its fields when constructed with valid data', () => {
        const user = new User(1, 'student', 'A Student', 'student@mit.edu', 'red', false);
        expect(user.id).toBe(1);
        expect(user.username).toBe('student');
        expect(user.name).toBe('A Student');
        expect(user.email).toBe('student@mit.edu');
        expect(user.team).toBe('red');
        expect(user.isAdmin).toBe(false);
    });

    it('rejects id 0 (RI: id must be a positive integer)', () => {
        expect(() => new User(0, 'student', 'A Student', 'student@mit.edu', 'red', false)).toThrow();
    });

    it('rejects a non-integer id', () => {
        expect(() => new User(1.5, 'student', 'A Student', 'student@mit.edu', 'red', false)).toThrow();
    });

    it('rejects an empty username', () => {
        expect(() => new User(1, '', 'A Student', 'student@mit.edu', 'red', false)).toThrow();
    });

    it('rejects an empty name', () => {
        expect(() => new User(1, 'student', '', 'student@mit.edu', 'red', false)).toThrow();
    });

    it('rejects an email missing "@"', () => {
        expect(() => new User(1, 'student', 'A Student', 'student-mit.edu', 'red', false)).toThrow();
    });

    describe('equals', () => {
        it('is true for two Users with the same id, even with different other fields', () => {
            const a = new User(1, 'student', 'A Student', 'student@mit.edu', 'red', false);
            const b = new User(1, 'other-name', 'Other Name', 'other@mit.edu', 'blue', true);
            expect(a.equals(b)).toBe(true);
        });

        it('is false for two Users with different ids', () => {
            const a = new User(1, 'student', 'A Student', 'student@mit.edu', 'red', false);
            const b = new User(2, 'student', 'A Student', 'student@mit.edu', 'red', false);
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('collected/owned', () => {
        it('accepts an owned card that is present in collected and currently owned by this user', () => {
            const alice = studentAt(1);
            const card = makeCard(1, [alice]);
            expect(
                () => new User(1, 'student1', 'Student 1', 'student1@mit.edu', 'red', false, [card], [card]),
            ).not.toThrow();
        });

        it('rejects an owned card missing from collected', () => {
            const alice = studentAt(1);
            const card = makeCard(1, [alice]);
            expect(
                () => new User(1, 'student1', 'Student 1', 'student1@mit.edu', 'red', false, [], [card]),
            ).toThrow();
        });

        it('rejects an owned card whose current owner is someone else (traded away)', () => {
            const alice = studentAt(1);
            const bob = studentAt(2);
            const card = makeCard(1, [alice, bob]); // now currently owned by bob
            expect(
                () => new User(1, 'student1', 'Student 1', 'student1@mit.edu', 'red', false, [card], [card]),
            ).toThrow();
        });

        it('rejects a collected card this user never actually held', () => {
            const bob = studentAt(2);
            const card = makeCard(1, [bob]);
            expect(
                () => new User(1, 'student1', 'Student 1', 'student1@mit.edu', 'red', false, [card], []),
            ).toThrow();
        });

        it('rejects duplicate card instance ids within collected or owned', () => {
            const alice = studentAt(1);
            const cardA = makeCard(1, [alice]);
            const cardADupe = makeCard(1, [alice]); // same instance id, different object
            expect(
                () =>
                    new User(
                        1,
                        'student1',
                        'Student 1',
                        'student1@mit.edu',
                        'red',
                        false,
                        [cardA, cardADupe],
                        [],
                    ),
            ).toThrow();
        });

        it('collected/owned getters return defensive copies that cannot mutate the user', () => {
            const alice = studentAt(1);
            const card = makeCard(1, [alice]);
            const user = new User(
                1,
                'student1',
                'Student 1',
                'student1@mit.edu',
                'red',
                false,
                [card],
                [card],
            );
            const collected = user.collected;
            collected.pop();
            expect(user.collected).toHaveLength(1);
        });
    });
});
