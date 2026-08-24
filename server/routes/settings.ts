import { Router } from 'express';
import { getSetting } from '../db';
import { SETTING_KEYS, DEFAULT_SETTINGS, PublicSettingsJson } from '../../src/settings';

export const settingsRouter = Router();

// Deliberately NOT behind requireAuth/requireAdmin -- both the Collection page (logged out)
// and App.tsx's lockdown gate (before anyone is necessarily logged in) need to read these
// while signed out, which is exactly the case this exists for.
settingsRouter.get('/', (_req, res) => {
    const collectionRequiresLogin =
        (getSetting(SETTING_KEYS.COLLECTION_REQUIRES_LOGIN) ??
            DEFAULT_SETTINGS[SETTING_KEYS.COLLECTION_REQUIRES_LOGIN]) === 'true';
    const siteLockedDown =
        (getSetting(SETTING_KEYS.SITE_LOCKED_DOWN) ?? DEFAULT_SETTINGS[SETTING_KEYS.SITE_LOCKED_DOWN]) ===
        'true';
    const payload: PublicSettingsJson = { collectionRequiresLogin, siteLockedDown };
    res.status(200).json(payload);
});
