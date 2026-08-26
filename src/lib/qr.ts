/**
 * Parses a scanned QR payload / visited URL of the form `<any-host>/cards/{highlightId}` or
 * `<any-host>/cards/{highlightId}/{uniqueId}` -- deliberately domain-agnostic (the host is
 * never inspected, only the `/cards/...` path), and tolerant of an http(s)://  scheme, a
 * trailing slash, and a query string/fragment. That's by design, not an oversight: which
 * domain the printed stickers/QR codes point to changes across environments (prod, staging
 * subdomains, localhost) and even over the site's lifetime, and this must keep working
 * unchanged through all of it. `highlightId` identifies the card *design* (a Supercard's
 * Highlight ID); `uniqueId`, present only on a specific physical copy's own QR code,
 * identifies that exact copy, and is upcased to match how it's stored (every printed
 * unique_id is uppercase, so a real scan is unaffected -- this only matters for a full URL
 * pasted in by hand with the id typed in lowercase, same as parsePrintedCardId below).
 * Returns undefined if the payload isn't a recognizable card link.
 */
export function parseCardUrl(scanned: string): { highlightId: string; uniqueId?: string } | undefined {
    const match = scanned.trim().match(/\/cards\/([0-9]+)(?:\/([A-Za-z0-9]+))?(?:[/?#]|$)/);
    if (!match) return undefined;
    return { highlightId: match[1], uniqueId: match[2]?.toUpperCase() };
}

/** Every physical card copy's own unique_id is exactly 4 alphanumeric characters -- see
 *  VerifiedTradeJson's doc comment in types.ts. Shared so the manual-entry fallback below can
 *  tell a plausible bare short ID apart from junk input before spending a network round trip
 *  on it. */
export const UNIQUE_ID_RE = /^[A-Za-z0-9]{4}$/;

/**
 * Parses the "{n}-{uniqueId}" short form printed next to a physical card's QR code (e.g.
 * "01-AARK") -- for hand-typing into the QR scanner's manual-entry fallback when the camera
 * isn't usable. `n` here is the card's collection number (Supercard.n, as shown on the card),
 * a different identifier space from parseCardUrl's highlightId, so this is kept as its own
 * parser rather than folded into that one. Tolerant of leading zeroes and surrounding
 * whitespace. Returns undefined if the input isn't that shape.
 */
export function parsePrintedCardId(input: string): { n: number; uniqueId: string } | undefined {
    const match = input.trim().match(/^0*([0-9]+)-([A-Za-z0-9]{4})$/);
    if (!match) return undefined;
    return { n: parseInt(match[1], 10), uniqueId: match[2].toUpperCase() };
}
