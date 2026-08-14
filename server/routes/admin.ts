import { Router } from 'express';
import { requireAdmin } from '../auth/session';
import {
    listUsers,
    findUserById,
    findCardInstance,
    currentOwnerOfCardInstance,
    cardInstancesOwnedBy,
    grantCardInstance,
    insertCustodyEvent,
} from '../db';
import { sanitizeUser, serializeCardInstance } from '../serialize';
import { getSupercard } from '../../src/data/supercards';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Parses a route param expected to be a positive integer id; undefined if it isn't one. */
function parseId(raw: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
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
    res.status(200).json({ cards: cardInstancesOwnedBy(userId).map(serializeCardInstance) });
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
