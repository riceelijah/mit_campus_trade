import { FlagColor, VALID_COLORS } from './types';

/**
 * Matches a valid MIT email's local part. Deliberately excludes '+' -- mail systems that
 * support it would otherwise let one person register unlimited accounts against a single
 * mailbox (student+1@mit.edu, student+2@mit.edu, ...).
 *
 * Shared between client and server so the two never validate registration/login differently.
 */
export const MIT_EMAIL_RE = /^[a-z0-9._-]+@mit\.edu$/i;

export const MIN_PASSWORD_LENGTH = 8;

export function isValidMitEmail(email: string): boolean {
    return MIT_EMAIL_RE.test(email);
}

export function isValidPassword(password: string): boolean {
    return password.length >= MIN_PASSWORD_LENGTH;
}

export function isValidTeamColor(team: string): team is FlagColor {
    return VALID_COLORS.has(team as FlagColor);
}
