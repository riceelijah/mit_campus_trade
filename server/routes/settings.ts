import { Router } from 'express';
import { getSetting } from '../db';
import { SETTING_KEYS, DEFAULT_SETTINGS, PublicSettingsJson } from '../../src/settings';

export const settingsRouter = Router();

// Deliberately NOT behind requireAuth/requireAdmin -- the Collection page needs to check
// collectionRequiresLogin while logged out, which is exactly the case this exists to gate.
settingsRouter.get('/', (_req, res) => {
    const raw =
        getSetting(SETTING_KEYS.COLLECTION_REQUIRES_LOGIN) ??
        DEFAULT_SETTINGS[SETTING_KEYS.COLLECTION_REQUIRES_LOGIN];
    const payload: PublicSettingsJson = { collectionRequiresLogin: raw === 'true' };
    res.status(200).json(payload);
});
