import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/session';
import { cardInstancesCollectedBy, grantCardInstance, UserRow } from '../db';
import { serializeCardInstance } from '../serialize';
import { getSupercardByHighlightId } from '../../src/data/supercards';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/cards', (_req, res) => {
    const user = res.locals.user as UserRow;
    res.status(200).json({ collected: cardInstancesCollectedBy(user.id).map(serializeCardInstance) });
});

// Applied to /collect -- the endpoint the nav bar's QR scanner hits on every successful
// scan. Scanning a whole physical pack (6-8 cards) in one sitting is normal usage, so this
// is more generous than authLimiter. Same trust-proxy caveat as authLimiter applies here.
const collectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many scans. Please wait a few minutes and try again.' },
});

// Self-service version of admin's grant-card action: lets a logged-in student register a
// card they scanned into their own collection. No server-side duplicate check -- a student
// scanning a card they already have is expected (physical duplicates are a normal part of
// trading), and the "you already have this, add another copy?" confirmation is handled
// client-side by the scanner before this is ever called.
meRouter.post('/collect', collectLimiter, (req, res) => {
    const user = res.locals.user as UserRow;
    const { highlightId } = req.body ?? {};

    if (typeof highlightId !== 'string' || highlightId.length === 0) {
        res.status(400).json({ error: 'Not a valid card' });
        return;
    }
    const supercard = getSupercardByHighlightId(highlightId);
    if (!supercard) {
        res.status(400).json({ error: 'Not a valid card' });
        return;
    }

    const instance = grantCardInstance(supercard.n, user.id);
    res.status(201).json({ card: serializeCardInstance(instance) });
});
