import { describe, it, expect } from 'vitest';
import { parseCardUrl, parsePrintedCardId } from './qr';

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

    it('is domain-agnostic: works the same on a CCC-hosted test subdomain', () => {
        expect(parseCardUrl('http://dougb-test-mitcampustrade.ccc-mit.org/cards/5357532/AARK')).toEqual({
            highlightId: '5357532',
            uniqueId: 'AARK',
        });
    });

    it('is domain-agnostic: works the same on the planned CCC-owned root domain', () => {
        expect(parseCardUrl('https://campustrade.ccc-mit.org/cards/5356671')).toEqual({
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

    it('upcases a lowercase unique_id (e.g. a hand-typed/pasted URL)', () => {
        expect(parseCardUrl('mitcampustrade.com/cards/5357532/aark')).toEqual({
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

describe('parsePrintedCardId', () => {
    it('extracts the collection number and unique_id from the printed "01-AARK" form', () => {
        expect(parsePrintedCardId('01-AARK')).toEqual({ n: 1, uniqueId: 'AARK' });
    });

    it('tolerates surrounding whitespace', () => {
        expect(parsePrintedCardId('  01-AARK  ')).toEqual({ n: 1, uniqueId: 'AARK' });
    });

    it('tolerates a collection number with no leading zero', () => {
        expect(parsePrintedCardId('7-J5NX')).toEqual({ n: 7, uniqueId: 'J5NX' });
    });

    it('upcases a lowercase unique_id', () => {
        expect(parsePrintedCardId('01-aark')).toEqual({ n: 1, uniqueId: 'AARK' });
    });

    it('handles a multi-digit collection number', () => {
        expect(parsePrintedCardId('36-8V9E')).toEqual({ n: 36, uniqueId: '8V9E' });
    });

    it('returns undefined for a bare unique_id with no collection number', () => {
        expect(parsePrintedCardId('AARK')).toBeUndefined();
    });

    it('returns undefined for a unique_id that is not 4 characters', () => {
        expect(parsePrintedCardId('01-AAR')).toBeUndefined();
    });

    it('returns undefined for an unrelated string', () => {
        expect(parsePrintedCardId('not a card id at all')).toBeUndefined();
    });
});
