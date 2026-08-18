import { describe, it, expect } from 'vitest';
import { extractHighlightId } from './qr';

describe('extractHighlightId', () => {
    it('extracts the id from the bare-domain form printed on physical cards', () => {
        expect(extractHighlightId('mitcampustrade.com/cards/5356671')).toBe('5356671');
    });

    it('extracts the id when the payload has an https:// scheme', () => {
        expect(extractHighlightId('https://mitcampustrade.com/cards/5356671')).toBe('5356671');
    });

    it('extracts the id with a trailing slash', () => {
        expect(extractHighlightId('mitcampustrade.com/cards/5356671/')).toBe('5356671');
    });

    it('extracts the id with a trailing query string', () => {
        expect(extractHighlightId('mitcampustrade.com/cards/5356671?utm_source=qr')).toBe('5356671');
    });

    it("extracts the id from this app's own localhost origin", () => {
        expect(extractHighlightId('http://localhost:5173/cards/5356671')).toBe('5356671');
    });

    it('returns undefined for an unrelated string', () => {
        expect(extractHighlightId('not a card link at all')).toBeUndefined();
    });

    it('returns undefined for a /cards/ path with no id', () => {
        expect(extractHighlightId('mitcampustrade.com/cards/')).toBeUndefined();
    });
});
