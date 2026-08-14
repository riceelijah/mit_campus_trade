import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isValidMitEmail, isValidPassword, isValidTeamColor } from '../../src/validation';
import { hashPassword, verifyPassword } from '../auth/password';
import {
    createSessionForUser,
    setSessionCookie,
    clearSessionCookie,
    getUserFromRequest,
    getSessionTokenFromRequest,
    endCurrentSession,
    requireAuth,
} from '../auth/session';
import {
    findUserByEmail,
    findUserByUsername,
    insertUser,
    updatePasswordHash,
    deleteOtherSessionsForUser,
    UserRow,
} from '../db';
import { sanitizeUser } from '../serialize';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.toLowerCase() ?? 'ejrice@mit.edu';

export const authRouter = Router();

// Precomputed once at startup so /login always pays bcrypt's cost, even for an email that
// doesn't exist -- otherwise "no such account" (fast) is trivially distinguishable by
// response time alone from "account exists, wrong password" (slow), letting anyone enumerate
// registered @mit.edu addresses. Confirmed empirically before this fix: ~1ms vs ~250ms.
const DUMMY_HASH = await hashPassword('not-a-real-password-used-only-for-timing-safety');

// Applied to register/login/change-password -- the endpoints an attacker would hammer to
// guess passwords or credential-stuff. Keyed by IP by default; if this ever runs behind a
// real reverse proxy, `app.set('trust proxy', ...)` needs to be configured so req.ip
// reflects the real client rather than the proxy.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

authRouter.post('/register', authLimiter, async (req, res) => {
    const { name, email, team, password, confirmPassword } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name is required' });
        return;
    }
    if (typeof email !== 'string' || !isValidMitEmail(email)) {
        res.status(400).json({ error: 'Email must be a valid @mit.edu address' });
        return;
    }
    if (typeof team !== 'string' || !isValidTeamColor(team)) {
        res.status(400).json({ error: 'Please choose a valid team color' });
        return;
    }
    if (typeof password !== 'string' || !isValidPassword(password)) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
    }
    if (password !== confirmPassword) {
        res.status(400).json({ error: 'Passwords do not match' });
        return;
    }

    const normalizedEmail = email.toLowerCase();
    const username = normalizedEmail.split('@')[0];

    if (findUserByUsername(username) || findUserByEmail(normalizedEmail)) {
        res.status(409).json({ error: 'An account with that email already exists' });
        return;
    }

    // is_admin is never taken from the request body -- computed purely server-side.
    const isAdmin = normalizedEmail === ADMIN_EMAIL;

    try {
        const passwordHash = await hashPassword(password);
        const row = insertUser({
            username,
            email: normalizedEmail,
            name: name.trim(),
            team,
            password_hash: passwordHash,
            isAdmin,
        });

        const token = createSessionForUser(row.id);
        setSessionCookie(res, token);
        res.status(201).json({ user: sanitizeUser(row) });
    } catch (err) {
        console.error('Failed to create account:', err);
        res.status(500).json({ error: 'Could not create account' });
    }
});

authRouter.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ error: 'Email/username and password are required' });
        return;
    }

    const normalized = email.toLowerCase().trim();
    const row: UserRow | undefined = normalized.includes('@')
        ? findUserByEmail(normalized)
        : findUserByUsername(normalized);

    // Always run bcrypt, on a real hash or the dummy one, so a nonexistent account and a
    // wrong password take the same amount of time -- see DUMMY_HASH above.
    const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !valid) {
        res.status(401).json({ error: 'Incorrect email/username or password' });
        return;
    }

    const token = createSessionForUser(row.id);
    setSessionCookie(res, token);
    res.status(200).json({ user: sanitizeUser(row) });
});

authRouter.post('/logout', (req, res) => {
    endCurrentSession(req);
    clearSessionCookie(res);
    res.status(200).json({ ok: true });
});

authRouter.get('/me', (req, res) => {
    const row = getUserFromRequest(req);
    if (!row) {
        res.status(401).json({ error: 'Not logged in' });
        return;
    }
    res.status(200).json({ user: sanitizeUser(row) });
});

authRouter.post('/change-password', authLimiter, requireAuth, async (req, res) => {
    const user = res.locals.user as UserRow;
    const { currentPassword, newPassword, confirmNewPassword } = req.body ?? {};

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        res.status(400).json({ error: 'Current and new password are required' });
        return;
    }

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
        res.status(401).json({ error: 'Current password is incorrect' });
        return;
    }
    if (!isValidPassword(newPassword)) {
        res.status(400).json({ error: 'New password must be at least 8 characters' });
        return;
    }
    if (newPassword !== confirmNewPassword) {
        res.status(400).json({ error: 'New passwords do not match' });
        return;
    }

    const newHash = await hashPassword(newPassword);
    updatePasswordHash(user.id, newHash);

    // Changing your password logs out every other session for this account.
    const currentToken = getSessionTokenFromRequest(req);
    if (currentToken) {
        deleteOtherSessionsForUser(user.id, currentToken);
    }

    res.status(200).json({ ok: true });
});
