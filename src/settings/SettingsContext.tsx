import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { PublicSettingsJson } from '../settings';

interface SettingsContextValue {
    /** Site-wide toggleable settings, or null until the initial fetch resolves. */
    settings: PublicSettingsJson | null;
    /** True until the initial fetch has resolved. */
    loading: boolean;
    /** Re-fetches settings and replaces `settings` with the result -- used after an admin
     *  flips a toggle, so the change is reflected immediately without a page reload. */
    refreshSettings(): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

// Purely a paint-time optimization for App.tsx's own lockdown routing decision (see its
// `locked` comment) -- lets a reload render the right homepage on the very first render
// instead of waiting a round-trip and briefly showing the wrong one. Nothing here is
// authoritative: `loading` still means "until the real fetch resolves" everywhere else
// (CollectionPage, AdminPage), this cache just seeds `settings` with last time's answer in the
// meantime, corrected the moment the real fetch comes back.
const SETTINGS_CACHE_KEY = 'campus-trade:settings-cache';

function readCachedSettings(): PublicSettingsJson | null {
    try {
        const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
        return raw ? (JSON.parse(raw) as PublicSettingsJson) : null;
    } catch {
        return null; // private browsing, storage disabled, corrupted value -- fine, it's just a cache
    }
}

function writeCachedSettings(settings: PublicSettingsJson | null): void {
    try {
        if (settings) localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings));
    } catch {
        // storage full/disabled -- ignore, same reasoning as readCachedSettings
    }
}

async function fetchSettings(): Promise<PublicSettingsJson | null> {
    const res = await fetch('/api/settings');
    return res.ok ? await res.json() : null;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<PublicSettingsJson | null>(readCachedSettings);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const fresh = await fetchSettings();
            setSettings(fresh);
            writeCachedSettings(fresh);
            setLoading(false);
        })();
    }, []);

    const refreshSettings = useCallback(async () => {
        const fresh = await fetchSettings();
        setSettings(fresh);
        writeCachedSettings(fresh);
    }, []);

    return (
        <SettingsContext.Provider value={{ settings, loading, refreshSettings }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings(): SettingsContextValue {
    const ctx = useContext(SettingsContext);
    if (!ctx) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return ctx;
}
