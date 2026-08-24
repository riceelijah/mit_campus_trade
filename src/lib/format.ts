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
