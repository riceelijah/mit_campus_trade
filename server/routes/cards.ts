import { Router } from 'express';
import { requireAuth } from '../auth/session';
import {
    findCardInstanceByUniqueId,
    currentOwnerOfCardInstance,
    findUserById,
    randomOtherUsers,
    UserRow,
} from '../db';
import { sanitizeUser } from '../serialize';
import { getSupercard } from '../../src/data/supercards';
import { CollectCandidatesJson, ResolveCardJson } from '../../src/types';

export const cardsRouter = Router();

const RANDOM_OTHER_COUNT = 3;

// Resolves a bare unique_id (no supercard number attached) to the card design it belongs to --
// powers the QR scanner's "enter ID manually" fallback when a student types in just the short
// code and not the full "01-AARK" printed form (the latter carries its own supercard number
// and never needs this, see parsePrintedCardId). No auth required: which design a given code
// belongs to is exactly what the printed QR code/sticker itself already reveals to anyone,
// logged in or not.
cardsRouter.get('/:uniqueId', (req, res) => {
    const uniqueId = Array.isArray(req.params.uniqueId) ? req.params.uniqueId[0] : req.params.uniqueId;
    const instance = findCardInstanceByUniqueId(uniqueId);
    const supercard = instance && getSupercard(instance.supercard_n);
    if (!supercard) {
        res.status(404).json({ error: 'No such card' });
        return;
    }
    res.status(200).json({ highlightId: supercard.highlightId } satisfies ResolveCardJson);
});

/** Fisher-Yates shuffle -- used so the previous owner's position in `candidates` carries no
 *  information (see collect-candidates below): if they always landed in the same slot, that
 *  slot itself would be a tell, label or no label. */
function shuffled<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// Powers the trade-attribution popup: mixes the instance's actual previous owner in with 3
// random other students, in random order, and -- deliberately -- with nothing in the response
// that says which entry is the real previous owner. Whether a chosen answer was correct is
// determined entirely server-side, inside /api/me/collect; if this endpoint instead returned a
// labeled `previousOwner` field (as an earlier version did), anyone with browser devtools open
// could read the right answer straight off the network response, silently defeating the whole
// point of asking. Requires login since it hands back other students' profile info.
//
// There is deliberately no plain "view this instance's custody history" endpoint: exposing a
// scanned/visited card's full ownership history before it's been collected -- to a viewer who
// hasn't collected it, is the exact same shortcut this endpoint's shuffle is designed to close.
cardsRouter.get('/:uniqueId/collect-candidates', requireAuth, (req, res) => {
    // Express 5's route-string type inference treats a param followed by another path segment
    // as possibly-repeated (string | string[]); it's still always a single string at runtime
    // for this route shape, so this narrows rather than actually handling an array.
    const uniqueId = Array.isArray(req.params.uniqueId) ? req.params.uniqueId[0] : req.params.uniqueId;
    const instance = findCardInstanceByUniqueId(uniqueId);
    if (!instance) {
        res.status(404).json({ error: 'No such card' });
        return;
    }
    const viewer = res.locals.user as UserRow;
    const previousOwnerId = currentOwnerOfCardInstance(instance.id);

    // No previous owner (never collected) or the viewer is themselves the current owner --
    // either way there's no meaningful "who'd you get this from?" question to ask, so the
    // client goes straight to collecting with no attribution popup. (If the viewer really is
    // already the current owner, that specific case is caught and reported by
    // POST /api/me/collect itself.)
    if (previousOwnerId === undefined || previousOwnerId === viewer.id) {
        res.status(200).json({ hasPreviousOwner: false, candidates: [] } satisfies CollectCandidatesJson);
        return;
    }

    const previousOwner = findUserById(previousOwnerId);

    // A hidden account (e.g. an admin -- see the `hidden` column's schema comment) is never a
    // valid attribution answer: skip the question entirely rather than asking the student to
    // guess an account they were never meant to see, correctly or not.
    if (previousOwner?.hidden === 1) {
        res.status(200).json({ hasPreviousOwner: false, candidates: [] } satisfies CollectCandidatesJson);
        return;
    }

    const others = randomOtherUsers([viewer.id, previousOwnerId], RANDOM_OTHER_COUNT);
    const candidates = shuffled([...(previousOwner ? [previousOwner] : []), ...others]).map(sanitizeUser);

    const payload: CollectCandidatesJson = { hasPreviousOwner: true, candidates };
    res.status(200).json(payload);
});
