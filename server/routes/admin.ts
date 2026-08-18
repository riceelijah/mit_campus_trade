import { Router } from 'express';
import { requireAdmin } from '../auth/session';
import {
    listUsers,
    findUserById,
    findCardInstance,
    currentOwnerOfCardInstance,
    cardInstancesOwnedBy,
    cardInstancesCollectedBy,
    grantCardInstance,
    insertCustodyEvent,
    returnCardInstance,
    revokeCardInstanceFromUser,
    unassignedUserId,
    markSupercardSeen,
    unmarkSupercardSeen,
    seenSupercardNumbersFor,
    setSetting,
} from '../db';
import { sanitizeUser, serializeCardInstance } from '../serialize';
import { SUPERCARDS, getSupercard } from '../../src/data/supercards';
import { Supercard } from '../../src/card';
import { SETTING_KEYS } from '../../src/settings';
import { VALID_COLORS, FlagColor, AdminUserCardsJson } from '../../src/types';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Parses a route param expected to be a positive integer id; undefined if it isn't one. */
function parseId(raw: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** A bulk action's optional `{ color, category }` filter body, validated once and shared by
 *  every bulk-* route below. Neither present means "every supercard". */
interface TypeFilter {
    color?: FlagColor;
    category?: string;
}

/** Validates a bulk action's filter body; undefined means the body was invalid. */
function parseTypeFilter(body: unknown): TypeFilter | undefined {
    const { color, category } = (body ?? {}) as { color?: unknown; category?: unknown };
    if (color !== undefined && !VALID_COLORS.has(color as FlagColor)) return undefined;
    if (category !== undefined && (typeof category !== 'string' || category.length === 0)) return undefined;
    return { color: color as FlagColor | undefined, category: category as string | undefined };
}

function matchingSupercards({ color, category }: TypeFilter): Supercard[] {
    return SUPERCARDS.filter((sc) => {
        if (color && sc.color !== color) return false;
        if (category && !sc.categories.includes(category)) return false;
        return true;
    });
}

adminRouter.get('/users', (_req, res) => {
    res.status(200).json({ users: listUsers().map(sanitizeUser) });
});

adminRouter.get('/users/:userId/cards', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const payload: AdminUserCardsJson = {
        cards: cardInstancesCollectedBy(userId).map(serializeCardInstance),
        seen: seenSupercardNumbersFor(userId),
    };
    res.status(200).json(payload);
});

adminRouter.post('/users/:userId/grant-card', (req, res) => {
    const userId = parseId(req.params.userId);
    const { supercardN } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof supercardN !== 'number' || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    const instance = grantCardInstance(supercardN, userId);
    res.status(201).json({ card: serializeCardInstance(instance) });
});

adminRouter.post('/card-instances/:cardInstanceId/transfer', (req, res) => {
    const cardInstanceId = parseId(req.params.cardInstanceId);
    const { newOwnerUserId } = req.body ?? {};

    const instance = cardInstanceId !== undefined ? findCardInstance(cardInstanceId) : undefined;
    if (!instance || cardInstanceId === undefined) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }
    if (typeof newOwnerUserId !== 'number' || !findUserById(newOwnerUserId)) {
        res.status(400).json({ error: 'Not a valid target user' });
        return;
    }

    const currentOwner = currentOwnerOfCardInstance(cardInstanceId);
    if (currentOwner === newOwnerUserId) {
        res.status(400).json({ error: 'That user already owns this card' });
        return;
    }

    insertCustodyEvent(cardInstanceId, newOwnerUserId);
    res.status(200).json({ card: serializeCardInstance(instance) });
});

// Takes a card instance back from whoever currently holds it without erasing its history --
// see returnCardInstance's doc comment. The instance stays visible in the previous holder's
// collected/Pokedex history; it just stops counting as currently owned by them.
adminRouter.post('/card-instances/:cardInstanceId/return', (req, res) => {
    const cardInstanceId = parseId(req.params.cardInstanceId);
    const instance = cardInstanceId !== undefined ? findCardInstance(cardInstanceId) : undefined;
    if (!instance || cardInstanceId === undefined) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }

    const currentOwner = currentOwnerOfCardInstance(cardInstanceId);
    if (currentOwner === unassignedUserId()) {
        res.status(400).json({ error: 'That card is already unassigned' });
        return;
    }

    returnCardInstance(cardInstanceId);
    res.status(200).json({ card: serializeCardInstance(instance) });
});

// Fully erases `userId`'s participation in a card instance's history -- unlike /return, this
// is irreversible and removes it from their collected/Pokedex history entirely, not just
// their current ownership. See revokeCardInstanceFromUser's doc comment.
adminRouter.delete('/users/:userId/card-instances/:cardInstanceId', (req, res) => {
    const userId = parseId(req.params.userId);
    const cardInstanceId = parseId(req.params.cardInstanceId);

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (cardInstanceId === undefined || !findCardInstance(cardInstanceId)) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }

    revokeCardInstanceFromUser(userId, cardInstanceId);
    res.status(200).json({ ok: true });
});

adminRouter.post('/users/:userId/seen', (req, res) => {
    const userId = parseId(req.params.userId);
    const { supercardN } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof supercardN !== 'number' || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    markSupercardSeen(userId, supercardN);
    res.status(200).json({ supercardN });
});

adminRouter.delete('/users/:userId/seen/:supercardN', (req, res) => {
    const userId = parseId(req.params.userId);
    const supercardN = parseId(req.params.supercardN);

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (supercardN === undefined || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    unmarkSupercardSeen(userId, supercardN);
    res.status(200).json({ supercardN });
});

// Grants one fresh instance of every supercard matching the filter (or all 72, if no filter
// is given) to the target user. Looped rather than wrapped in one big transaction --
// grantCardInstance already commits each grant on its own, and SQLite doesn't support nested
// transactions, so a mid-loop failure just leaves a partial (still individually-consistent)
// bulk grant rather than rolling back everything.
adminRouter.post('/users/:userId/bulk-grant', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targets = matchingSupercards(filter);
    for (const supercard of targets) grantCardInstance(supercard.n, userId);
    res.status(200).json({ granted: targets.length });
});

// Returns (see /return above) every instance of a matching supercard the target user
// currently owns -- their historical/collected record is untouched.
adminRouter.post('/users/:userId/bulk-return', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targetNs = new Set(matchingSupercards(filter).map((sc) => sc.n));
    const instances = cardInstancesOwnedBy(userId).filter((inst) => targetNs.has(inst.supercard_n));
    for (const instance of instances) returnCardInstance(instance.id);
    res.status(200).json({ returned: instances.length });
});

// Fully revokes (see DELETE .../card-instances/:id above) every matching-supercard instance
// the target user has ever held, current or past -- irreversible.
adminRouter.post('/users/:userId/bulk-revoke', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targetNs = new Set(matchingSupercards(filter).map((sc) => sc.n));
    const instances = cardInstancesCollectedBy(userId).filter((inst) => targetNs.has(inst.supercard_n));
    for (const instance of instances) revokeCardInstanceFromUser(userId, instance.id);
    res.status(200).json({ revoked: instances.length });
});

// Unmarks every matching supercard as "seen" for the target user -- independent of their
// collected/owned history, this only affects the greyscale "seen but not collected" state.
adminRouter.post('/users/:userId/bulk-unsee', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targets = matchingSupercards(filter);
    for (const supercard of targets) unmarkSupercardSeen(userId, supercard.n);
    res.status(200).json({ unseen: targets.length });
});

adminRouter.post('/settings/collection-requires-login', (req, res) => {
    const { value } = req.body ?? {};
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setSetting(SETTING_KEYS.COLLECTION_REQUIRES_LOGIN, value ? 'true' : 'false');
    res.status(200).json({ collectionRequiresLogin: value });
});
