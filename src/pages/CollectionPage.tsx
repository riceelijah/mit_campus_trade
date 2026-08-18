import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Supercard } from '../card';
import { SUPERCARDS } from '../data/supercards';
import { useCollectedSupercardNumbers, useSeenSupercardNumbers, CardVisibility } from '../data/ownership';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { CollectionViewMode } from '../types';
import CardGrid from '../components/CardGrid';

type SortKey = 'dex' | 'title' | 'cost' | 'color';

const SORTERS: Record<SortKey, (a: Supercard, b: Supercard) => number> = {
    dex: (a, b) => a.n - b.n,
    title: (a, b) => a.title.localeCompare(b.title),
    cost: (a, b) => a.cost - b.cost || a.n - b.n,
    color: (a, b) => a.color.localeCompare(b.color) || a.n - b.n,
};

const SORT_LABELS: Record<SortKey, string> = {
    dex: 'Dex number',
    title: 'Title (A-Z)',
    cost: 'Cost',
    color: 'Color',
};

// "Collected" is a deliberate relabel of what the original spec called "owned" -- it means
// every card ever collected (the full custody history), not this app's separate owned/
// collected split used elsewhere for trading (owned = currently-held-only). Avoids clashing
// with that terminology.
const VISIBILITY_LABELS: Record<CollectionViewMode, string> = {
    collected: 'Collected',
    seen: 'Seen',
    all: 'All',
};

export default function CollectionPage() {
    const { user, loading: authLoading } = useAuth();
    const { settings, loading: settingsLoading } = useSettings();
    const collected = useCollectedSupercardNumbers();
    const seen = useSeenSupercardNumbers();
    const [sortKey, setSortKey] = useState<SortKey>('dex');
    const [visibilityFilter, setVisibilityFilter] = useState<CollectionViewMode>('all');

    // `user` isn't available on the very first render (AuthContext's initial fetch is async),
    // so the visibility filter can't be seeded from the server in useState's initializer --
    // this picks it up as soon as the user loads, but only once, so it doesn't stomp on a
    // choice the viewer has since made (persistToServer below keeps the server copy current
    // regardless).
    const hydratedFromServer = useRef(false);
    useEffect(() => {
        if (!hydratedFromServer.current && user) {
            setVisibilityFilter(user.collectionViewMode);
            hydratedFromServer.current = true;
        }
    }, [user]);

    const setAndPersistVisibilityFilter = useCallback(
        (mode: CollectionViewMode) => {
            setVisibilityFilter(mode);
            if (!user) return; // logged-out viewing (settings toggle) has no account to save to
            fetch('/api/me/collection-view-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ mode }),
            }).catch(() => {
                // best-effort -- the filter already updated locally either way, and it'll just
                // try persisting again next time it's changed
            });
        },
        [user],
    );

    const sortedCards = useMemo(() => [...SUPERCARDS].sort(SORTERS[sortKey]), [sortKey]);

    const visibleCards = useMemo(() => {
        if (visibilityFilter === 'collected') return sortedCards.filter((sc) => collected.has(sc.n));
        if (visibilityFilter === 'seen')
            return sortedCards.filter((sc) => collected.has(sc.n) || seen.has(sc.n));
        return sortedCards;
    }, [sortedCards, visibilityFilter, collected, seen]);

    const getVisibility = useCallback(
        (supercard: Supercard): CardVisibility => {
            if (collected.has(supercard.n)) return 'collected';
            if (seen.has(supercard.n)) return 'seen';
            return 'unseen';
        },
        [collected, seen],
    );

    // All hooks above run unconditionally, before either early return below -- same
    // convention as AccountPage.tsx/CardDetailPage.tsx.
    if (authLoading || settingsLoading) {
        return null;
    }
    const requiresLogin = settings?.collectionRequiresLogin ?? true; // fail closed
    if (requiresLogin && !user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div>
            <h1>Your Collection</h1>
            <p>
                Cards you&rsquo;ve collected appear in full color. Cards you&rsquo;ve seen but not collected
                appear greyed out. Cards you haven&rsquo;t seen yet just show their card number.
            </p>

            <div className="collection-controls">
                <div className="collection-controls__group" role="group" aria-label="Filter by visibility">
                    {(Object.keys(VISIBILITY_LABELS) as CollectionViewMode[]).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            className={
                                'toggle-button' + (visibilityFilter === mode ? ' toggle-button--active' : '')
                            }
                            aria-pressed={visibilityFilter === mode}
                            onClick={() => setAndPersistVisibilityFilter(mode)}
                        >
                            {VISIBILITY_LABELS[mode]}
                        </button>
                    ))}
                </div>

                <label className="collection-controls__sort">
                    Sort by
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                        {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                            <option key={key} value={key}>
                                {SORT_LABELS[key]}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <CardGrid cards={visibleCards} getVisibility={getVisibility} />
        </div>
    );
}
