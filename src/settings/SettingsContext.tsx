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

async function fetchSettings(): Promise<PublicSettingsJson | null> {
    const res = await fetch('/api/settings');
    return res.ok ? await res.json() : null;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<PublicSettingsJson | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            setSettings(await fetchSettings());
            setLoading(false);
        })();
    }, []);

    const refreshSettings = useCallback(async () => {
        setSettings(await fetchSettings());
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
