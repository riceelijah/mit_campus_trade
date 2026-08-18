/**
 * Extracts the highlightId path segment from a scanned QR payload of the form
 * `mitcampustrade.com/cards/{highlightId}` -- tolerant of an http(s):// scheme, a trailing
 * slash, and a query string/fragment. Returns undefined if the payload isn't a recognizable
 * card link.
 */
export function extractHighlightId(scanned: string): string | undefined {
    const match = scanned.trim().match(/\/cards\/([0-9]+)(?:[/?#]|$)/);
    return match?.[1];
}
