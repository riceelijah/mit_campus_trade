import { describe, it, expect } from 'vitest';
import { isValidMitEmail, isValidPassword, isValidTeamColor } from './validation';

describe('isValidMitEmail', () => {
    it('accepts a plain @mit.edu address', () => {
        expect(isValidMitEmail('student@mit.edu')).toBe(true);
    });

    it('accepts dots, hyphens, and digits in the local part', () => {
        expect(isValidMitEmail('stu.dent-1@mit.edu')).toBe(true);
    });

    it('rejects "+" subaddressing, which would let one mailbox register unlimited accounts', () => {
        expect(isValidMitEmail('student+1@mit.edu')).toBe(false);
    });

    it('rejects non-MIT domains', () => {
        expect(isValidMitEmail('student@gmail.com')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isValidMitEmail('')).toBe(false);
    });

    it('rejects a string missing "@mit.edu"', () => {
        expect(isValidMitEmail('not-an-email')).toBe(false);
    });
});

describe('isValidPassword', () => {
    it('rejects a 7-character password', () => {
        expect(isValidPassword('1234567')).toBe(false);
    });

    it('accepts an 8-character password (the minimum)', () => {
        expect(isValidPassword('12345678')).toBe(true);
    });

    it('accepts a longer password', () => {
        expect(isValidPassword('a-very-long-password')).toBe(true);
    });
});

describe('isValidTeamColor', () => {
    const ALL_COLORS = [
        'red',
        'blue',
        'green',
        'yellow',
        'orange',
        'purple',
        'pink',
        'black',
        'white',
        'brown',
        'gold',
        'silver',
    ];

    it.each(ALL_COLORS)('accepts the valid team color "%s"', (color) => {
        expect(isValidTeamColor(color)).toBe(true);
    });

    it('rejects a color that is not one of the 12 flag colors', () => {
        expect(isValidTeamColor('teal')).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isValidTeamColor('')).toBe(false);
    });
});
