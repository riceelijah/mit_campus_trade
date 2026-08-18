import { describe, it, expect } from 'vitest';
import { SUPERCARDS, getSupercard, getSupercardByHighlightId } from './supercards';

describe('getSupercardByHighlightId', () => {
    it('resolves a known highlightId to the matching Supercard', () => {
        const known = SUPERCARDS[0];
        expect(getSupercardByHighlightId(known.highlightId)).toBe(known);
    });

    it('returns undefined for an unrecognized highlightId', () => {
        expect(getSupercardByHighlightId('not-a-real-id')).toBeUndefined();
    });
});

describe('getSupercard', () => {
    it('resolves a known collection number to the matching Supercard', () => {
        const known = SUPERCARDS[0];
        expect(getSupercard(known.n)).toBe(known);
    });

    it('returns undefined for a collection number no card has', () => {
        expect(getSupercard(-1)).toBeUndefined();
    });
});
