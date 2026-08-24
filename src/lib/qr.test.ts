import { describe, it, expect } from 'vitest';
import { parseCardUrl } from './qr';

describe('parseCardUrl', () => {
    it('extracts the highlightId from the bare-domain form printed on physical cards', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5356671')).toEqual({
            highlightId: '5356671',
            uniqueId: undefined,
        });
    });

    it('extracts the highlightId when the payload has an https:// scheme', () => {
        expect(parseCardUrl('https://mitcampustrade.com/cards/5356671')).toEqual({
            highlightId: '5356671',
            uniqueId: undefined,
        });
    });

    it('extracts the highlightId with a trailing slash', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5356671/')).toEqual({
            highlightId: '5356671',
            uniqueId: undefined,
        });
    });

    it('extracts the highlightId with a trailing query string', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5356671?utm_source=qr')).toEqual({
            highlightId: '5356671',
            uniqueId: undefined,
        });
    });

    it("extracts the highlightId from this app's own localhost origin", () => {
        expect(parseCardUrl('http://localhost:5173/cards/5356671')).toEqual({
            highlightId: '5356671',
            uniqueId: undefined,
        });
    });

    it("extracts both highlightId and uniqueId from a specific copy's link", () => {
        expect(parseCardUrl('https://mitcampustrade.com/cards/5357532/AARK')).toEqual({
            highlightId: '5357532',
            uniqueId: 'AARK',
        });
    });

    it('extracts both ids with a trailing slash', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5357532/AARK/')).toEqual({
            highlightId: '5357532',
            uniqueId: 'AARK',
        });
    });

    it('extracts both ids with a trailing query string', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5357532/AARK?utm_source=qr')).toEqual({
            highlightId: '5357532',
            uniqueId: 'AARK',
        });
    });

    it('returns undefined for an unrelated string', () => {
        expect(parseCardUrl('not a card link at all')).toBeUndefined();
    });

    it('returns undefined for a /cards/ path with no id', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/')).toBeUndefined();
    });
});
