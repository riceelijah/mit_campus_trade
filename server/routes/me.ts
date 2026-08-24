import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../auth/session';
import {
    cardInstancesCollectedBy,
    collectCardInstance,
    markSupercardSeen,
    seenSupercardNumbersFor,
    updateCollectionViewMode,
    CardInstanceNotFoundError,
    AlreadyOwnedError,
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

// Lets a logged-in student register a *specific* scanned/visited card copy (identified by its
// unique_id, not the supercard/design id) into their own collection. Physical duplicates of
// the same design are still normal -- what's no longer allowed is collecting the very same
// copy you already currently hold (collectCardInstance throws AlreadyOwnedError for that).
// `claimedFromUserId` is the answer to the "who'd you get this from?" popup (see
// TradeAttributionModal), null if there was no previous owner to ask about or the collector
// picked "Unknown/Other".
meRouter.post('/collect', scanLimiter, (req, res) => {
    const user = res.locals.user as UserRow;
    const { uniqueId, claimedFromUserId } = req.body ?? {};

    if (typeof uniqueId !== 'string' || uniqueId.length === 0) {
        res.status(400).json({ error: 'Not a valid card' });
        return;
    }
    if (
        claimedFromUserId !== undefined &&
        claimedFromUserId !== null &&
        typeof claimedFromUserId !== 'number'
    ) {
        res.status(400).json({ error: 'Not a valid claimed-from user' });
        return;
    }

    try {
        const { instance } = collectCardInstance(uniqueId, user.id, claimedFromUserId ?? null);
        res.status(201).json({ card: serializeCardInstance(instance) });
    } catch (err) {
        if (err instanceof CardInstanceNotFoundError) {
            res.status(404).json({ error: 'Not a valid card' });
        } else if (err instanceof AlreadyOwnedError) {
            res.status(409).json({ error: 'You already own this card' });
        } else {
            throw err;
        }
    }
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
