/**
 * Admin-toggleable site settings, shared between client and server (imported by
 * server/routes/settings.ts and server/routes/admin.ts via a relative path, same
 * cross-import pattern as src/types.ts). Backed by the `settings` key/value table in
 * server/db.ts.
 */

export const SETTING_KEYS = {
    COLLECTION_REQUIRES_LOGIN: 'collection_requires_login',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Fail-closed defaults, used whenever a key has no row yet in the `settings` table. */
export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
    [SETTING_KEYS.COLLECTION_REQUIRES_LOGIN]: 'true',
};

/** The shape returned by GET /api/settings -- deliberately public, no auth required. */
export interface PublicSettingsJson {
    collectionRequiresLogin: boolean;
}
