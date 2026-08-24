import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Supercard } from '../card';
import { SUPERCARDS, ALL_COLORS, ALL_CATEGORIES } from '../data/supercards';
import { useCollectedSupercardNumbers, useSeenSupercardNumbers, CardVisibility } from '../data/ownership';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { CollectionViewMode, FlagColor } from '../types';
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

// Derived rather than hardcoded [1, 2, 3], same rationale as ALL_COLORS/ALL_CATEGORIES.
const ALL_COSTS = [...new Set(SUPERCARDS.map((sc) => sc.cost))].sort((a, b) => a - b);

/**
 * Reads the category/color/cost filters straight out of the URL's query string (via
 * useSearchParams below) rather than component state, so a card page's chip links (see
 * CardDetailPage) can deep-link a filtered view of this page just by navigating to
 * `/collection?category=...` etc. -- no separate "apply this filter" plumbing needed between
 * the two pages, and the resulting URL is itself shareable/bookmarkable.
 */
export default function CollectionPage() {
    const { user, loading: authLoading } = useAuth();
    const { settings, loading: settingsLoading } = useSettings();
    const collected = useCollectedSupercardNumbers();
    const seen = useSeenSupercardNumbers();
    const [sortKey, setSortKey] = useState<SortKey>('dex');
    const [visibilityFilter, setVisibilityFilter] = useState<CollectionViewMode>('all');

    const [searchParams, setSearchParams] = useSearchParams();
    const categoryFilter = searchParams.get('category');
    const colorFilter = searchParams.get('color') as FlagColor | null;
    const costFilter = searchParams.get('cost');
    const hasTypeFilter = categoryFilter !== null || colorFilter !== null || costFilter !== null;

    const setFilterParam = useCallback(
        (key: 'category' | 'color' | 'cost', value: string) => {
            setSearchParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (value === '') next.delete(key);
                    else next.set(key, value);
                    return next;
                },
                { replace: true },
            );
        },
        [setSearchParams],
    );

    const clearTypeFilters = useCallback(() => {
        setSearchParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('category');
                next.delete('color');
                next.delete('cost');
                return next;
            },
            { replace: true },
        );
    }, [setSearchParams]);

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
        let cards = sortedCards;
        if (visibilityFilter === 'collected') cards = cards.filter((sc) => collected.has(sc.n));
        else if (visibilityFilter === 'seen')
            cards = cards.filter((sc) => collected.has(sc.n) || seen.has(sc.n));

        if (categoryFilter) cards = cards.filter((sc) => sc.categories.includes(categoryFilter));
        if (colorFilter) cards = cards.filter((sc) => sc.color === colorFilter);
        if (costFilter) cards = cards.filter((sc) => sc.cost === Number(costFilter));
        return cards;
    }, [sortedCards, visibilityFilter, collected, seen, categoryFilter, colorFilter, costFilter]);

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

            <div className="collection-controls">
                <label className="collection-controls__sort">
                    Category
                    <select
                        value={categoryFilter ?? ''}
                        onChange={(e) => setFilterParam('category', e.target.value)}
                    >
                        <option value="">All</option>
                        {ALL_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                                {category}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="collection-controls__sort">
                    Color
                    <select
                        value={colorFilter ?? ''}
                        onChange={(e) => setFilterParam('color', e.target.value)}
                    >
                        <option value="">All</option>
                        {ALL_COLORS.map((color) => (
                            <option key={color} value={color}>
                                {color}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="collection-controls__sort">
                    Cost
                    <select value={costFilter ?? ''} onChange={(e) => setFilterParam('cost', e.target.value)}>
                        <option value="">All</option>
                        {ALL_COSTS.map((cost) => (
                            <option key={cost} value={cost}>
                                {cost}
                            </option>
                        ))}
                    </select>
                </label>

                {hasTypeFilter && (
                    <button type="button" className="toggle-button" onClick={clearTypeFilters}>
                        Clear filters
                    </button>
                )}
            </div>

            <CardGrid cards={visibleCards} getVisibility={getVisibility} />
        </div>
    );
}
