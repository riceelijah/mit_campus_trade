import { describe, it, expect } from 'vitest';
import { User } from './user';

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
});
