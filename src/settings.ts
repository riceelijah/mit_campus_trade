/**
 * Admin-toggleable site settings, shared between client and server (imported by
 * server/routes/settings.ts and server/routes/admin.ts via a relative path, same
 * cross-import pattern as src/types.ts). Backed by the `settings` key/value table in
 * server/db.ts.
 */

export const SETTING_KEYS = {
    COLLECTION_REQUIRES_LOGIN: 'collection_requires_login',
    SITE_LOCKED_DOWN: 'site_locked_down',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Fail-closed defaults, used whenever a key has no row yet in the `settings` table. Note
 *  SITE_LOCKED_DOWN defaults to 'false' (fail-open) rather than the usual fail-closed -- it's
 *  an opt-in pre-launch mode an admin switches on deliberately, not a privacy gate like
 *  COLLECTION_REQUIRES_LOGIN where the safe default is the more restrictive one. */
export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
    [SETTING_KEYS.COLLECTION_REQUIRES_LOGIN]: 'true',
    [SETTING_KEYS.SITE_LOCKED_DOWN]: 'false',
};

/** The shape returned by GET /api/settings -- deliberately public, no auth required. */
export interface PublicSettingsJson {
    collectionRequiresLogin: boolean;
    /** Pre-launch lockdown: when true, only the home page (a placeholder, see
     *  LockedHomePage), registration, login, and account management are reachable for
     *  non-admins -- everything else (Collection, Rules, card pages) redirects to home. Admins
     *  always see the full site regardless, so they can keep working while it's on.
     *  Client-side gating only (see App.tsx/NavBar.tsx), same as collectionRequiresLogin --
     *  not a server-side API lockdown. */
    siteLockedDown: boolean;
}
