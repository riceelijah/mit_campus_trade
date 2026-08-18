import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/session';
import {
    cardInstancesCollectedBy,
    grantCardInstance,
    markSupercardSeen,
    seenSupercardNumbersFor,
    updateCollectionViewMode,
    UserRow,
} from '../db';
import { serializeCardInstance } from '../serialize';
import { getSupercardByHighlightId } from '../../src/data/supercards';
import { MyCardsJson, CollectionViewMode, VALID_COLLECTION_VIEW_MODES } from '../../src/types';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/cards', (_req, res) => {
    const user = res.locals.user as UserRow;
    const payload: MyCardsJson = {
        collected: cardInstancesCollectedBy(user.id).map(serializeCardInstance),
        seen: seenSupercardNumbersFor(user.id),
    };
    res.status(200).json(payload);
});

// Shared by /collect and /seen -- both come from the same QR-scanning flow with the same
// abuse shape. Scanning a whole physical pack (6-8 cards) in one sitting is normal usage, so
// this is more generous than authLimiter. Same trust-proxy caveat as authLimiter applies here.
const scanLimiter = rateLimit({
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
meRouter.post('/collect', scanLimiter, (req, res) => {
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

// The QR scanner's "Just looking" option: records that the viewer has scanned a card without
// registering it to their collection. Idempotent (INSERT OR IGNORE server-side), so
// re-scanning an already-seen card is a harmless no-op.
meRouter.post('/seen', scanLimiter, (req, res) => {
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

    markSupercardSeen(user.id, supercard.n);
    res.status(200).json({ supercardN: supercard.n });
});

// Persists the Collection page's Collected/Seen/All toggle so it survives across sessions
// and devices instead of resetting to a default every visit.
meRouter.post('/collection-view-mode', (req, res) => {
    const user = res.locals.user as UserRow;
    const { mode } = req.body ?? {};

    if (typeof mode !== 'string' || !VALID_COLLECTION_VIEW_MODES.has(mode as CollectionViewMode)) {
        res.status(400).json({ error: 'Not a valid view mode' });
        return;
    }

    updateCollectionViewMode(user.id, mode);
    res.status(200).json({ collectionViewMode: mode });
});
