import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Supercard } from '../card';
import { SUPERCARDS, ALL_COLORS, ALL_CATEGORIES } from '../data/supercards';
import {
    useCollectedSupercardNumbers,
    useOwnedSupercardNumbers,
    useSeenSupercardNumbers,
    CardVisibility,
} from '../data/ownership';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { CollectionViewMode, FlagColor } from '../types';
import CardGrid, { CardGridEntry } from '../components/CardGrid';
import { capitalize } from '../lib/format';

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
// collected split used elsewhere for trading (owned = currently-held-only). "Owned" below
// maps directly onto that latter, narrower concept (see useOwnedSupercardNumbers), so the two
// labels sitting side by side here is intentional, not a naming collision. Ordered narrowest
// to broadest: each mode is a strict superset of the one before it (see CollectionViewMode).
const VISIBILITY_LABELS: Record<CollectionViewMode, string> = {
    owned: 'Hand',
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
 * the two pages, and the resulting URL is itself shareable/bookmarkable. Each of the three
 * keys can repeat (`?category=Music&category=Sports`) via URLSearchParams' own multi-value
 * support, so several values of the same type filter in as OR'd together (a card matching any
 * checked category counts), while the three types still AND together -- same semantics a chip
 * link's single value always had, just generalized.
 */
export default function CollectionPage() {
    const { user, loading: authLoading } = useAuth();
    const { settings, loading: settingsLoading } = useSettings();
    const collected = useCollectedSupercardNumbers();
    const owned = useOwnedSupercardNumbers();
    const seen = useSeenSupercardNumbers();
    const [sortKey, setSortKey] = useState<SortKey>('dex');
    const [visibilityFilter, setVisibilityFilter] = useState<CollectionViewMode>('all');

    const [searchParams, setSearchParams] = useSearchParams();
    const categoryFilter = useMemo(() => new Set(searchParams.getAll('category')), [searchParams]);
    const colorFilter = useMemo(() => new Set(searchParams.getAll('color') as FlagColor[]), [searchParams]);
    const costFilter = useMemo(() => new Set(searchParams.getAll('cost')), [searchParams]);
    const activeFilterCount = categoryFilter.size + colorFilter.size + costFilter.size;
    const hasTypeFilter = activeFilterCount > 0;

    // Starts open if a chip link (or a bookmarked/shared URL) landed here with a filter
    // already checked, so that selection isn't hidden inside a collapsed panel the viewer has
    // to know to open -- but only as an initial default. It deliberately does NOT track
    // hasTypeFilter reactively afterwards, so checking/clearing filters later never yanks the
    // panel open or shut out from under whatever the viewer last chose for it themselves.
    const [filtersOpen, setFiltersOpen] = useState(hasTypeFilter);

    const toggleFilterValue = useCallback(
        (key: 'category' | 'color' | 'cost', value: string) => {
            setSearchParams(
                (prev) => {
                    const current = prev.getAll(key);
                    const next = new URLSearchParams(prev);
                    next.delete(key);
                    (current.includes(value)
                        ? current.filter((v) => v !== value)
                        : [...current, value]
                    ).forEach((v) => next.append(key, v));
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
        if (visibilityFilter === 'owned') cards = cards.filter((sc) => owned.has(sc.n));
        else if (visibilityFilter === 'collected') cards = cards.filter((sc) => collected.has(sc.n));
        else if (visibilityFilter === 'seen')
            cards = cards.filter((sc) => collected.has(sc.n) || seen.has(sc.n));

        if (categoryFilter.size > 0)
            cards = cards.filter((sc) => sc.categories.some((c) => categoryFilter.has(c)));
        if (colorFilter.size > 0) cards = cards.filter((sc) => colorFilter.has(sc.color));
        if (costFilter.size > 0) cards = cards.filter((sc) => costFilter.has(String(sc.cost)));
        return cards;
    }, [sortedCards, visibilityFilter, owned, collected, seen, categoryFilter, colorFilter, costFilter]);

    // In every other visibility mode this is just one entry per design (unchanged behavior).
    // In "Hand" (owned), a player holding multiple copies of the same design gets one entry
    // per owned Card *instance* instead of one collapsed tile -- each carries its own
    // uniqueId, so CardThumbnail links each to its own custody chain (see the `?instance=`
    // param on CardDetailPage).
    const gridEntries = useMemo<CardGridEntry[]>(() => {
        if (visibilityFilter !== 'owned' || !user) {
            return visibleCards.map((supercard) => ({ supercard }));
        }
        const ownedByN = new Map<number, string[]>();
        for (const card of user.owned) {
            if (!ownedByN.has(card.n)) ownedByN.set(card.n, []);
            ownedByN.get(card.n)!.push(card.uniqueId);
        }
        return visibleCards.flatMap((supercard) =>
            (ownedByN.get(supercard.n) ?? []).map((uniqueId) => ({ supercard, uniqueId })),
        );
    }, [visibleCards, visibilityFilter, user]);

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
            <div className="collection-title-row">
                <h1>Your Collection</h1>
                {(user?.colorChallengeCompleted || user?.subObjectiveCompleted) && (
                    <div className="chip-row collection-title-row__badges">
                        {user.colorChallengeCompleted && (
                            <span className="chip" title="Color Challenge complete">
                                🎨
                            </span>
                        )}
                        {user.subObjectiveCompleted && (
                            <span className="chip" title="Sub-Objective complete">
                                🎯
                            </span>
                        )}
                    </div>
                )}
            </div>
            <p>
                Cards you&rsquo;ve collected appear in full color. Cards you&rsquo;ve seen but not collected
                appear greyed out. Cards you haven&rsquo;t seen yet just show their card number.
            </p>

            {/* Everything that narrows down which cards show below -- visibility, sort, and the
                three type filters -- lives in this one panel so it reads as a single "controls"
                block instead of two disconnected rows (it used to be split across two separate
                .collection-controls). See .collection-controls in index.css for how this
                collapses to a single tappable column on mobile. */}
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

                <div className="collection-controls__filters">
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

                    {/* Collapsed by default (see filtersOpen above) -- this, plus folding
                        category/color/cost into checkboxes instead of three separate always-
                        visible <select>s, is what keeps this panel from swallowing half the
                        screen on mobile the way it used to. */}
                    <button
                        type="button"
                        className={
                            'filters-toggle toggle-button' + (hasTypeFilter ? ' toggle-button--active' : '')
                        }
                        aria-expanded={filtersOpen}
                        aria-controls="collection-filters-panel"
                        onClick={() => setFiltersOpen((open) => !open)}
                    >
                        Filters{hasTypeFilter ? ` (${activeFilterCount})` : ''}
                        <svg
                            viewBox="0 0 12 12"
                            className={
                                'filters-toggle__chevron' +
                                (filtersOpen ? ' filters-toggle__chevron--open' : '')
                            }
                            aria-hidden="true"
                        >
                            <path
                                d="M2.5 4.5L6 8L9.5 4.5"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </svg>
                    </button>

                    {hasTypeFilter && (
                        <button
                            type="button"
                            className="toggle-button collection-controls__clear"
                            onClick={clearTypeFilters}
                        >
                            Clear filters
                        </button>
                    )}
                </div>

                {filtersOpen && (
                    <div id="collection-filters-panel" className="collection-filters-panel">
                        <fieldset className="collection-filters-panel__group">
                            <legend>Category</legend>
                            <div className="collection-filters-panel__options">
                                {ALL_CATEGORIES.map((category) => (
                                    <label key={category} className="filter-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={categoryFilter.has(category)}
                                            onChange={() => toggleFilterValue('category', category)}
                                        />
                                        {category}
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className="collection-filters-panel__group">
                            <legend>Color</legend>
                            <div className="collection-filters-panel__options">
                                {ALL_COLORS.map((color) => (
                                    <label key={color} className="filter-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={colorFilter.has(color)}
                                            onChange={() => toggleFilterValue('color', color)}
                                        />
                                        {capitalize(color)}
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset className="collection-filters-panel__group">
                            <legend>Cost</legend>
                            <div className="collection-filters-panel__options">
                                {ALL_COSTS.map((cost) => (
                                    <label key={cost} className="filter-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={costFilter.has(String(cost))}
                                            onChange={() => toggleFilterValue('cost', String(cost))}
                                        />
                                        {cost}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </div>
                )}
            </div>

            <CardGrid entries={gridEntries} getVisibility={getVisibility} />
        </div>
    );
}
