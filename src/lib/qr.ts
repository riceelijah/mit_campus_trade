/**
 * Parses a scanned QR payload / visited URL of the form `mitcampustrade.com/cards/{highlightId}`
 * or `mitcampustrade.com/cards/{highlightId}/{uniqueId}` -- tolerant of an http(s):// scheme,
 * a trailing slash, and a query string/fragment. `highlightId` identifies the card *design*
 * (a Supercard's Highlight ID); `uniqueId`, present only on a specific physical copy's own QR
 * code, identifies that exact copy. Returns undefined if the payload isn't a recognizable card
 * link.
 */
export function parseCardUrl(scanned: string): { highlightId: string; uniqueId?: string } | undefined {
    const match = scanned.trim().match(/\/cards\/([0-9]+)(?:\/([A-Za-z0-9]+))?(?:[/?#]|$)/);
    if (!match) return undefined;
    return { highlightId: match[1], uniqueId: match[2] };
}
