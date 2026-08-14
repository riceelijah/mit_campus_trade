import { Router } from 'express';
import { requireAuth } from '../auth/session';
import { cardInstancesOwnedBy, UserRow } from '../db';
import { serializeCardInstance } from '../serialize';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/cards', (_req, res) => {
    const user = res.locals.user as UserRow;
    res.status(200).json({ cards: cardInstancesOwnedBy(user.id).map(serializeCardInstance) });
});
