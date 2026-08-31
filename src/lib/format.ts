/**
 * Capitalizes just the first character of `s`, leaving the rest untouched. Used to display
 * lowercase-stored values -- currently just FlagColor (team colors and card colors, both
 * stored/matched/URL-encoded lowercase, e.g. 'red') -- in Title Case wherever they're shown to
 * a person, without touching the underlying value anywhere it's actually compared, stored, or
 * used as a literal CSS color keyword (case-insensitive there regardless).
 */
export function capitalize(s: string): string {
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// Every timestamp in the app should read the same for every viewer regardless of their own
// device's timezone -- everyone involved (players, admins) is on campus, so Eastern is the one
// timezone that's actually meaningful here. `timeZoneName: 'short'` on the datetime variant
// spells out "EDT"/"EST" explicitly, so it never gets mistaken for the viewer's local time.
// Spelled out as individual field options rather than dateStyle/timeStyle -- Intl.DateTimeFormat
// throws if timeZoneName is combined with either of those (they're mutually exclusive per the
// spec), so this is the only way to get both the abbreviation and a compact date+time.
const EASTERN_DATETIME = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
});
const EASTERN_DATE = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
});

/**
 * Parses a timestamp as sent by the server into a proper Date -- every timestamp from the API
 * is SQLite's own `datetime('now')` format, `"YYYY-MM-DD HH:MM:SS"`, UTC, with no `T` separator
 * or timezone marker. Bare `new Date(thatString)` is a well-known JS trap: a strict ISO 8601
 * string (with `T` and no offset) is guaranteed parsed as UTC, but this space-separated form
 * falls outside that and gets parsed as *local* time instead (V8's implementation-defined
 * fallback). Left unfixed, every displayed timestamp comes out shifted by the viewer's own UTC
 * offset -- concretely, a real 1:00 AM EDT event was showing as "5:00 AM EDT" for an EDT viewer,
 * since parsing the raw digits as local-EDT and then formatting that instant back to EDT just
 * round-trips the same clock digits unchanged instead of actually converting from UTC. Swapping
 * the separator and appending `Z` makes it unambiguous ISO 8601, parsed as UTC everywhere.
 * Passed a `Date` already (e.g. from AuthContext, which uses this same function while building
 * `Card`'s custody chain), it's returned as-is -- already correctly parsed once, upstream.
 */
export function parseServerTimestamp(when: string | Date): Date {
    return when instanceof Date ? when : new Date(when.replace(' ', 'T') + 'Z');
}

/** Formats `when` (a server timestamp string, or an already-parsed Date) as a date + time in
 *  Eastern time, e.g. "Aug 30, 2026, 3:45 PM EDT" -- regardless of the viewer's own timezone. */
export function formatEasternDateTime(when: string | Date): string {
    return EASTERN_DATETIME.format(parseServerTimestamp(when));
}

/** Same as formatEasternDateTime but date-only, e.g. "Aug 30, 2026" -- for places (like a
 *  card's ownership history) that don't need time-of-day precision. */
export function formatEasternDate(when: string | Date): string {
    return EASTERN_DATE.format(parseServerTimestamp(when));
}
