import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createSession, findSession, deleteSession, findUserById, UserRow } from '../db';

/**
 * Signs the session cookie. Must be set via the SESSION_SECRET env var in any real
 * deployment. In development, an unset SESSION_SECRET falls back to a well-known
 * placeholder; in production, an unset SESSION_SECRET is a hard startup failure -- silently
 * running with a public, hardcoded secret would let anyone forge session cookies.
 */
const DEV_ONLY_SESSION_SECRET = 'dev-only-insecure-secret-change-me';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error(
        'SESSION_SECRET must be set when NODE_ENV=production. Refusing to start with the ' +
            'well-known development default -- see .env.example.',
    );
}

export const SESSION_SECRET = process.env.SESSION_SECRET ?? DEV_ONLY_SESSION_SECRET;

const SESSION_COOKIE = 'campus_trade_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Creates a new session for `userId` and returns its token (the value to put in the cookie).
 */
export function createSessionForUser(userId: number): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    createSession(token, userId, expiresAt);
    return token;
}

export function setSessionCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        // Only over HTTPS in production -- local dev runs on plain http://localhost, which
        // a `secure` cookie would never actually be sent over. Matters a lot in practice:
        // students on the same campus wifi can sniff an insecure cookie in plain HTTP.
        secure: process.env.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS,
        path: '/',
    });
}

export function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionTokenFromRequest(req: Request): string | undefined {
    return req.signedCookies?.[SESSION_COOKIE] as string | undefined;
}

/**
 * @param req an incoming request
 * @returns the logged-in user's DB row, or undefined if the request has no valid session
 */
export function getUserFromRequest(req: Request): UserRow | undefined {
    const token = getSessionTokenFromRequest(req);
    if (!token) return undefined;

    const session = findSession(token);
    if (!session) return undefined;

    if (new Date(session.expires_at).getTime() < Date.now()) {
        deleteSession(token); // lazy cleanup of expired sessions
        return undefined;
    }

    return findUserById(session.user_id);
}

/** Deletes the current request's session (for logout) and returns its token, if any. */
export function endCurrentSession(req: Request): string | undefined {
    const token = getSessionTokenFromRequest(req);
    if (token) deleteSession(token);
    return token;
}

/**
 * Express middleware: 401s if not logged in, otherwise stashes the user row on
 * `res.locals.user` for downstream handlers.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const user = getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    res.locals.user = user;
    next();
}

/**
 * Express middleware: 401s if not logged in, 403s if logged in but not an admin. This (not
 * any client-side route gating) is the real security boundary for admin-only routes.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    const user = getUserFromRequest(req);
    if (!user) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    if (user.is_admin !== 1) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    res.locals.user = user;
    next();
}
