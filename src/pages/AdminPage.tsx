import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { SUPERCARDS, getSupercard, ALL_COLORS, ALL_CATEGORIES } from '../data/supercards';
import {
    AdminUserJson,
    PublicCardInstanceJson,
    AdminUserCardsJson,
    FlagColor,
    VerifiedTradeJson,
    ExchangeEventJson,
    AdminStatsJson,
} from '../types';
import { extractError } from '../lib/api';
import { capitalize, formatEasternDateTime } from '../lib/format';
import CollapsibleSection from '../components/CollapsibleSection';

interface TypeFilter {
    color?: FlagColor;
    category?: string;
}

/** Decodes a <select> value (e.g. 'color:red' / 'category:Dorms') back into a TypeFilter. */
function valueToFilter(value: string): TypeFilter {
    const [kind, val] = value.split(':');
    if (kind === 'color') return { color: val as FlagColor };
    if (kind === 'category') return { category: val };
    return {};
}

function currentOwnerId(card: PublicCardInstanceJson): number | undefined {
    return card.custody[card.custody.length - 1]?.owner.id;
}

/** Case-insensitive substring match against several fields at once. */
function matches(query: string, ...fields: string[]): boolean {
    const q = query.trim().toLowerCase();
    return q === '' || fields.some((f) => f.toLowerCase().includes(q));
}

/** A design's title plus its dex number, e.g. "Masseeh (01)" -- for the Stats panel's
 *  most-traded-designs list, where there's no specific printed copy to also name (contrast
 *  with My Notes' CardLabel, which additionally has a uniqueId to include). */
function designLabel(supercardN: number): string {
    return `${getSupercard(supercardN)?.title ?? 'Unknown card'} (${String(supercardN).padStart(2, '0')})`;
}

/** A specific physical card's title plus its "(dex number-printed code)" id, e.g.
 *  "Masseeh (01-AARK)" -- same convention as My Notes' CardLabel. */
function cardLabel(supercardN: number, uniqueId: string): string {
    return `${getSupercard(supercardN)?.title ?? 'Unknown card'} (${String(supercardN).padStart(2, '0')}-${uniqueId})`;
}

export default function AdminPage() {
    const { user, loading } = useAuth();
    const { settings, refreshSettings } = useSettings();

    const [users, setUsers] = useState<AdminUserJson[]>([]);
    const [usersError, setUsersError] = useState<string | null>(null);
    const [userSearch, setUserSearch] = useState('');

    const [settingsError, setSettingsError] = useState<string | null>(null);
    const [settingsPending, setSettingsPending] = useState(false);

    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [selectedUserCards, setSelectedUserCards] = useState<PublicCardInstanceJson[]>([]);
    const [selectedUserSeen, setSelectedUserSeen] = useState<ReadonlySet<number>>(new Set());

    const [cardSearch, setCardSearch] = useState('');
    const [typeFilterValue, setTypeFilterValue] = useState('');
    const typeFilter = valueToFilter(typeFilterValue);

    const [transferringInstanceId, setTransferringInstanceId] = useState<number | null>(null);
    const [transferSearch, setTransferSearch] = useState('');

    const [actionError, setActionError] = useState<string | null>(null);
    const [actionPending, setActionPending] = useState(false);

    const [verifiedTrades, setVerifiedTrades] = useState<VerifiedTradeJson[]>([]);
    const [verifiedTradesError, setVerifiedTradesError] = useState<string | null>(null);
    // Which verified-trade row is expanded to show its research responses, if any -- at most
    // one at a time, click-to-toggle (see the table body below).
    const [expandedTradeId, setExpandedTradeId] = useState<number | null>(null);

    const [exchangeEvents, setExchangeEvents] = useState<ExchangeEventJson[]>([]);
    const [exchangeEventsError, setExchangeEventsError] = useState<string | null>(null);
    // Same click-to-toggle pattern as expandedTradeId above, for showing a card event's note
    // edit history (see priorConversationNotes).
    const [expandedEventId, setExpandedEventId] = useState<number | null>(null);

    const [stats, setStats] = useState<AdminStatsJson | null>(null);
    const [statsError, setStatsError] = useState<string | null>(null);

    const loadUsers = useCallback(async () => {
        const res = await fetch('/api/admin/users', { credentials: 'include' });
        if (!res.ok) {
            setUsersError(await extractError(res));
            return;
        }
        const body = await res.json();
        setUsers(body.users);
    }, []);

    const loadVerifiedTrades = useCallback(async () => {
        const res = await fetch('/api/admin/verified-trades', { credentials: 'include' });
        if (!res.ok) {
            setVerifiedTradesError(await extractError(res));
            return;
        }
        const body = await res.json();
        setVerifiedTrades(body.trades);
    }, []);

    const loadExchangeEvents = useCallback(async () => {
        const res = await fetch('/api/admin/exchange-events', { credentials: 'include' });
        if (!res.ok) {
            setExchangeEventsError(await extractError(res));
            return;
        }
        const body = await res.json();
        setExchangeEvents(body.events);
    }, []);

    const loadStats = useCallback(async () => {
        const res = await fetch('/api/admin/stats', { credentials: 'include' });
        if (!res.ok) {
            setStatsError(await extractError(res));
            return;
        }
        setStats(await res.json());
    }, []);

    const loadCardsFor = useCallback(async (userId: number) => {
        const res = await fetch(`/api/admin/users/${userId}/cards`, { credentials: 'include' });
        if (!res.ok) {
            setActionError(await extractError(res));
            return;
        }
        const body: AdminUserCardsJson = await res.json();
        setSelectedUserCards(body.cards);
        setSelectedUserSeen(new Set(body.seen));
    }, []);

    useEffect(() => {
        if (user?.isAdmin) {
            loadUsers();
            loadVerifiedTrades();
            loadExchangeEvents();
            loadStats();
        }
    }, [user, loadUsers, loadVerifiedTrades, loadExchangeEvents, loadStats]);

    const filteredUsers = useMemo(
        () => users.filter((u) => matches(userSearch, u.username, u.name, u.email)),
        [users, userSearch],
    );

    const filteredCards = useMemo(
        () => SUPERCARDS.filter((sc) => matches(cardSearch, sc.title, sc.color, ...sc.categories)),
        [cardSearch],
    );

    const instancesBySupercard = useMemo(() => {
        const map = new Map<number, PublicCardInstanceJson[]>();
        for (const card of selectedUserCards) {
            const list = map.get(card.supercardN) ?? [];
            list.push(card);
            map.set(card.supercardN, list);
        }
        return map;
    }, [selectedUserCards]);

    const transferCandidates = useMemo(
        () =>
            users.filter(
                (u) => u.id !== selectedUserId && matches(transferSearch, u.username, u.name, u.email),
            ),
        [users, selectedUserId, transferSearch],
    );

    if (loading) {
        return null;
    }
    if (!user || !user.isAdmin) {
        // Client-side gating is UX only -- every /api/admin/* route enforces this for real.
        return <Navigate to="/" replace />;
    }

    function selectUser(userId: number) {
        setSelectedUserId(userId);
        setSelectedUserCards([]);
        setSelectedUserSeen(new Set());
        setCardSearch('');
        setTransferringInstanceId(null);
        setActionError(null);
        loadCardsFor(userId);
    }

    // Clicking an already-selected student row collapses their card detail back down, the
    // same click-to-toggle pattern the verified-trades table uses for its own expandable rows.
    function deselectUser() {
        setSelectedUserId(null);
        setSelectedUserCards([]);
        setSelectedUserSeen(new Set());
        setCardSearch('');
        setTransferringInstanceId(null);
        setActionError(null);
    }

    async function runAction(fn: () => Promise<Response>, opts?: { refreshTrades?: boolean }) {
        setActionError(null);
        setActionPending(true);
        try {
            const res = await fn();
            if (!res.ok) throw new Error(await extractError(res));
            if (selectedUserId !== null) await loadCardsFor(selectedUserId);
            if (opts?.refreshTrades) await loadVerifiedTrades();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setActionPending(false);
        }
    }

    // Shared by both toggles below -- both are the same {value: boolean} POST /api/admin/
    // settings/<key> shape, just a different key.
    async function handleToggleSetting(settingPath: string, value: boolean) {
        setSettingsError(null);
        setSettingsPending(true);
        try {
            const res = await fetch(`/api/admin/settings/${settingPath}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            await refreshSettings();
        } catch (err) {
            setSettingsError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setSettingsPending(false);
        }
    }

    function handleGrant(supercardN: number) {
        if (selectedUserId === null) return;
        runAction(() =>
            fetch(`/api/admin/users/${selectedUserId}/grant-card`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ supercardN }),
            }),
        );
    }

    function handleToggleSeen(supercardN: number, checked: boolean) {
        if (selectedUserId === null) return;
        runAction(() =>
            checked
                ? fetch(`/api/admin/users/${selectedUserId}/seen`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ supercardN }),
                  })
                : fetch(`/api/admin/users/${selectedUserId}/seen/${supercardN}`, {
                      method: 'DELETE',
                      credentials: 'include',
                  }),
        );
    }

    // Shared by both achievement toggles below -- both are the same {value: boolean} POST
    // /api/admin/users/:userId/<kind> shape, just a different kind. Optimistically updates the
    // local `users` list rather than re-fetching the whole table, since that's the only state
    // this touches.
    async function handleToggleAchievement(
        userId: number,
        kind: 'color-challenge' | 'sub-objective',
        value: boolean,
    ) {
        setUsersError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}/${kind}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            const field = kind === 'color-challenge' ? 'colorChallengeCompleted' : 'subObjectiveCompleted';
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, [field]: value } : u)));
        } catch (err) {
            setUsersError(err instanceof Error ? err.message : 'Something went wrong');
        }
    }

    // Grants/revokes admin privileges -- unlike the achievement toggles above, this always
    // confirms first (it changes what someone else can do on the site, not just a display
    // badge) and can never target the caller's own account (the checkbox that calls this is
    // itself disabled for that row -- see the users table below -- and the server enforces the
    // same restriction independently).
    async function handleToggleAdmin(userId: number, username: string, value: boolean) {
        const verb = value ? 'grant' : 'revoke';
        if (!confirm(`Are you sure you want to ${verb} admin access for ${username}?`)) return;

        setUsersError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}/admin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            // Granting admin also force-hides the account server-side -- the response echoes
            // back the resulting hidden state so both checkboxes stay in sync without a refetch.
            const body: { isAdmin: boolean; hidden: boolean } = await res.json();
            setUsers((prev) =>
                prev.map((u) => (u.id === userId ? { ...u, isAdmin: body.isAdmin, hidden: body.hidden } : u)),
            );
        } catch (err) {
            setUsersError(err instanceof Error ? err.message : 'Something went wrong');
        }
    }

    // Independently shows/hides a user from the trade-attribution guessing pool -- no
    // self-restriction (unlike admin above), but still confirmed since it changes what other
    // students can see about them.
    async function handleToggleHidden(userId: number, username: string, value: boolean) {
        const verb = value ? 'hide' : 'unhide';
        if (
            !confirm(
                `Are you sure you want to ${verb} ${username}? Hidden accounts are excluded from ` +
                    'the trade-attribution guessing pool shown to students.',
            )
        )
            return;

        setUsersError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}/hidden`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, hidden: value } : u)));
        } catch (err) {
            setUsersError(err instanceof Error ? err.message : 'Something went wrong');
        }
    }

    // Permanently deletes a student's account -- their trade history is kept, reassigned to the
    // reserved "Unassigned" account rather than erased (see deleteUser's doc comment in
    // server/db.ts). Always confirmed first, same as every other irreversible action here.
    async function handleDeleteUser(userId: number, username: string) {
        if (
            !confirm(
                `Permanently delete ${username}'s account? Their trade history is kept but reassigned ` +
                    'to "Unassigned" rather than erased. This cannot be undone.',
            )
        )
            return;

        setUsersError(null);
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) throw new Error(await extractError(res));
            setUsers((prev) => prev.filter((u) => u.id !== userId));
            if (selectedUserId === userId) deselectUser();
        } catch (err) {
            setUsersError(err instanceof Error ? err.message : 'Something went wrong');
        }
    }

    // Danger-zone bulk action: deletes every non-admin user account, site-wide -- see
    // deleteAllNonAdminUsers's doc comment in server/db.ts. Refreshes the whole users list on
    // success (not runAction, which only refreshes cards/trades).
    function handleDeleteAllNonAdmin() {
        if (
            !confirm(
                'This will permanently delete every non-admin user account, site-wide -- their trade ' +
                    'history is kept but reassigned to "Unassigned" rather than erased. Admin accounts ' +
                    'are not affected. This cannot be undone.\n\nAre you absolutely sure?',
            )
        )
            return;

        setUsersError(null);
        setActionPending(true);
        fetch('/api/admin/users/delete-all-non-admin', { method: 'POST', credentials: 'include' })
            .then(async (res) => {
                if (!res.ok) throw new Error(await extractError(res));
                await loadUsers();
            })
            .catch((err) => setUsersError(err instanceof Error ? err.message : 'Something went wrong'))
            .finally(() => setActionPending(false));
    }

    function handleTransfer(cardInstanceId: number, newOwnerUserId: number) {
        setTransferringInstanceId(null);
        setTransferSearch('');
        runAction(() =>
            fetch(`/api/admin/card-instances/${cardInstanceId}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ newOwnerUserId }),
            }),
        );
    }

    function handleReturn(cardInstanceId: number) {
        runAction(() =>
            fetch(`/api/admin/card-instances/${cardInstanceId}/return`, {
                method: 'POST',
                credentials: 'include',
            }),
        );
    }

    function handleRevoke(cardInstanceId: number) {
        if (selectedUserId === null) return;
        if (!confirm('Permanently erase this card from their history? This cannot be undone.')) return;
        runAction(() =>
            fetch(`/api/admin/users/${selectedUserId}/card-instances/${cardInstanceId}`, {
                method: 'DELETE',
                credentials: 'include',
            }),
        );
    }

    // Unlike handleRevoke above (which only erases the *selected user's* participation), this
    // wipes the physical card's entire ownership/transaction history -- every student who has
    // ever held it -- so it always needs its own, more emphatic confirmation regardless of
    // whose card list it's being clicked from.
    function handleClearInstanceHistory(cardInstanceId: number) {
        if (
            !confirm(
                "Permanently erase this card's ENTIRE history -- every student who has ever " +
                    'held it, not just the current owner. This cannot be undone. Continue?',
            )
        ) {
            return;
        }
        runAction(
            () =>
                fetch(`/api/admin/card-instances/${cardInstanceId}/clear-history`, {
                    method: 'POST',
                    credentials: 'include',
                }),
            { refreshTrades: true },
        );
    }

    function handleClearAllHistory() {
        if (
            !confirm(
                "This will permanently erase EVERY card's ownership and transaction history " +
                    'for ALL students, site-wide -- every card returns to unclaimed. This cannot ' +
                    'be undone.\n\nAre you absolutely sure?',
            )
        ) {
            return;
        }
        runAction(
            () =>
                fetch('/api/admin/card-instances/clear-all-history', {
                    method: 'POST',
                    credentials: 'include',
                }),
            { refreshTrades: true },
        );
    }

    function handleBulk(kind: 'bulk-grant' | 'bulk-return' | 'bulk-revoke' | 'bulk-see' | 'bulk-unsee') {
        if (selectedUserId === null) return;
        if (
            kind === 'bulk-revoke' &&
            !confirm('Permanently erase every matching card from their history? This cannot be undone.')
        ) {
            return;
        }
        runAction(() =>
            fetch(`/api/admin/users/${selectedUserId}/${kind}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(typeFilter),
            }),
        );
    }

    return (
        <div>
            <h1>Admin</h1>

            <CollapsibleSection title="Stats" className="admin-settings">
                {statsError && <p className="form-error">{statsError}</p>}
                {stats && (
                    <>
                        <div className="admin-stats__headline">
                            <div className="admin-stats__stat">
                                <span className="admin-stats__number">{stats.totalCardEvents}</span>
                                <span className="admin-stats__label">Total card events</span>
                            </div>
                            <div className="admin-stats__stat">
                                <span className="admin-stats__number">{stats.totalVerifiedTrades}</span>
                                <span className="admin-stats__label">Verified trades</span>
                            </div>
                            <div className="admin-stats__stat">
                                <span className="admin-stats__number">{stats.totalStudents}</span>
                                <span className="admin-stats__label">Students</span>
                            </div>
                        </div>

                        <div className="admin-stats__lists">
                            <div className="admin-stats__list">
                                <h4>Most-traded cards</h4>
                                {stats.mostTradedCards.length === 0 ? (
                                    <p className="admin-card-row__categories">No verified trades yet.</p>
                                ) : (
                                    <ol>
                                        {stats.mostTradedCards.map((c) => (
                                            <li key={c.uniqueId}>
                                                {cardLabel(c.supercardN, c.uniqueId)}
                                                <span className="admin-stats__count">
                                                    {c.tradeCount} trade{c.tradeCount === 1 ? '' : 's'}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>

                            <div className="admin-stats__list">
                                <h4>Most-traded designs</h4>
                                {stats.mostTradedDesigns.length === 0 ? (
                                    <p className="admin-card-row__categories">No verified trades yet.</p>
                                ) : (
                                    <ol>
                                        {stats.mostTradedDesigns.map((d) => (
                                            <li key={d.supercardN}>
                                                {designLabel(d.supercardN)}
                                                <span className="admin-stats__count">
                                                    {d.tradeCount} trade{d.tradeCount === 1 ? '' : 's'}
                                                </span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </CollapsibleSection>

            <CollapsibleSection title="Site settings" className="admin-settings" defaultOpen={false}>
                {settingsError && <p className="form-error">{settingsError}</p>}
                <label className="admin-settings__toggle">
                    <input
                        type="checkbox"
                        checked={settings?.collectionRequiresLogin ?? true}
                        disabled={settingsPending}
                        onChange={(e) => handleToggleSetting('collection-requires-login', e.target.checked)}
                    />
                    Require login to view the Collection page
                </label>
                <label
                    className="admin-settings__toggle"
                    title="Only Home, Register, Login, and Account stay reachable for everyone else -- admins always see the full site."
                >
                    <input
                        type="checkbox"
                        checked={settings?.siteLockedDown ?? false}
                        disabled={settingsPending}
                        onChange={(e) => handleToggleSetting('site-locked-down', e.target.checked)}
                    />
                    Pre-launch lockdown (only Home/Register/Login/Account reachable, admins exempt)
                </label>
            </CollapsibleSection>

            <CollapsibleSection title="Verified trades" className="admin-settings" defaultOpen={false}>
                <p className="admin-card-row__categories">
                    Two-way trades the system detected automatically -- both sides scanned their new card and
                    correctly said who they got it from. Click a row to see either side&rsquo;s
                    trade-conversation research answer, if they gave one.
                </p>
                {verifiedTradesError && <p className="form-error">{verifiedTradesError}</p>}
                <div className="admin-table__scroll">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Gave up</th>
                                <th>Card A</th>
                                <th>When</th>
                                <th>Gave up</th>
                                <th>Card B</th>
                                <th>When</th>
                            </tr>
                        </thead>
                        <tbody>
                            {verifiedTrades.map((t) => {
                                const expanded = expandedTradeId === t.tradeId;
                                return (
                                    <Fragment key={t.tradeId}>
                                        <tr
                                            aria-expanded={expanded}
                                            onClick={() => setExpandedTradeId(expanded ? null : t.tradeId)}
                                        >
                                            <td>{t.userOne.username}</td>
                                            <td>{t.cardGivenByUserOneUniqueId}</td>
                                            <td>{formatEasternDateTime(t.userOneTradeTime)}</td>
                                            <td>{t.userTwo.username}</td>
                                            <td>{t.cardGivenByUserTwoUniqueId}</td>
                                            <td>{formatEasternDateTime(t.userTwoTradeTime)}</td>
                                        </tr>
                                        {expanded && (
                                            <tr className="admin-table__detail-row">
                                                <td colSpan={6}>
                                                    <div className="admin-trade-detail">
                                                        <div className="admin-trade-detail__side">
                                                            <h4>
                                                                {t.userOne.username}&rsquo;s conversation
                                                                notes
                                                            </h4>
                                                            <p>
                                                                {t.userOneConversationNotes ??
                                                                    'No answer given.'}
                                                            </p>
                                                        </div>
                                                        <div className="admin-trade-detail__side">
                                                            <h4>
                                                                {t.userTwo.username}&rsquo;s conversation
                                                                notes
                                                            </h4>
                                                            <p>
                                                                {t.userTwoConversationNotes ??
                                                                    'No answer given.'}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {verifiedTrades.length === 0 && (
                                <tr>
                                    <td colSpan={6}>No verified trades yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="Card Events" className="admin-settings" defaultOpen={false}>
                <p className="admin-card-row__categories">
                    Every time a card has been obtained, not just verified trades -- including the
                    optional-to-answer research prompts players saw right after (see PromptBanner), when
                    given. Click a row to see a note&rsquo;s earlier versions, if it&rsquo;s been edited.
                </p>
                {exchangeEventsError && <p className="form-error">{exchangeEventsError}</p>}
                <div className="admin-table__scroll">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Card</th>
                                <th>When</th>
                                <th>Received from someone?</th>
                                <th>Conversation notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {exchangeEvents.map((e) => {
                                const expanded = expandedEventId === e.exchangeEventId;
                                return (
                                    <Fragment key={e.exchangeEventId}>
                                        <tr
                                            aria-expanded={expanded}
                                            onClick={() =>
                                                setExpandedEventId(expanded ? null : e.exchangeEventId)
                                            }
                                        >
                                            <td>{e.userName}</td>
                                            <td>{e.cardUniqueId ?? '—'}</td>
                                            <td>{formatEasternDateTime(e.tradeTime)}</td>
                                            <td>
                                                {e.receivedFromOtherPerson === 'Y'
                                                    ? 'Yes'
                                                    : e.receivedFromOtherPerson === 'N'
                                                      ? 'No'
                                                      : '—'}
                                            </td>
                                            <td>{e.conversationNotes ?? '—'}</td>
                                        </tr>
                                        {expanded && (
                                            <tr className="admin-table__detail-row">
                                                <td colSpan={5}>
                                                    <div className="admin-trade-detail">
                                                        <div className="admin-trade-detail__side">
                                                            <h4>Earlier versions of this note</h4>
                                                            {e.priorConversationNotes.length === 0 ? (
                                                                <p>No edits.</p>
                                                            ) : (
                                                                <ol className="admin-note-history">
                                                                    {e.priorConversationNotes.map(
                                                                        (rev, i) => (
                                                                            <li key={i}>
                                                                                <span className="admin-note-history__when">
                                                                                    Replaced{' '}
                                                                                    {formatEasternDateTime(
                                                                                        rev.replacedAt,
                                                                                    )}
                                                                                </span>
                                                                                <p>{rev.notes}</p>
                                                                            </li>
                                                                        ),
                                                                    )}
                                                                </ol>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                            {exchangeEvents.length === 0 && (
                                <tr>
                                    <td colSpan={5}>No card events yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CollapsibleSection>

            {usersError && <p className="form-error">{usersError}</p>}

            <CollapsibleSection title="Students" className="admin-users-panel">
                <input
                    type="search"
                    className="admin-search"
                    placeholder="Search students..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                />
                <div className="admin-table__scroll">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>Username</th>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Team</th>
                                <th>Admin</th>
                                <th>Hidden</th>
                                <th>Color Challenge</th>
                                <th>Sub-Objective</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((u) => {
                                const selected = u.id === selectedUserId;
                                return (
                                    <Fragment key={u.id}>
                                        <tr
                                            className={selected ? 'admin-table__row--selected' : ''}
                                            aria-expanded={selected}
                                            onClick={() => (selected ? deselectUser() : selectUser(u.id))}
                                        >
                                            <td>{u.username}</td>
                                            <td>
                                                <span className="admin-name-cell">
                                                    {u.name}
                                                    {u.colorChallengeCompleted && (
                                                        <span
                                                            className="chip chip--inline"
                                                            title="Color Challenge complete"
                                                        >
                                                            🎨
                                                        </span>
                                                    )}
                                                    {u.subObjectiveCompleted && (
                                                        <span
                                                            className="chip chip--inline"
                                                            title="Sub-Objective complete"
                                                        >
                                                            🎯
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td>{u.email}</td>
                                            <td>{capitalize(u.team)}</td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={u.isAdmin}
                                                    disabled={u.id === user.id}
                                                    title={
                                                        u.id === user.id
                                                            ? "You can't change your own admin status"
                                                            : undefined
                                                    }
                                                    onChange={(e) =>
                                                        handleToggleAdmin(u.id, u.username, e.target.checked)
                                                    }
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={u.hidden}
                                                    onChange={(e) =>
                                                        handleToggleHidden(u.id, u.username, e.target.checked)
                                                    }
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={u.colorChallengeCompleted}
                                                    onChange={(e) =>
                                                        handleToggleAchievement(
                                                            u.id,
                                                            'color-challenge',
                                                            e.target.checked,
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={u.subObjectiveCompleted}
                                                    onChange={(e) =>
                                                        handleToggleAchievement(
                                                            u.id,
                                                            'sub-objective',
                                                            e.target.checked,
                                                        )
                                                    }
                                                />
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    className="admin-button--danger"
                                                    disabled={u.id === user.id}
                                                    title={
                                                        u.id === user.id
                                                            ? "You can't delete your own account"
                                                            : undefined
                                                    }
                                                    onClick={() => handleDeleteUser(u.id, u.username)}
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>

                                        {selected && (
                                            <tr className="admin-table__detail-row">
                                                <td colSpan={9}>
                                                    <div className="admin-student-detail">
                                                        <h3 className="admin-student-detail__heading">
                                                            {u.username}&rsquo;s cards
                                                        </h3>

                                                        {actionError && (
                                                            <p className="form-error">{actionError}</p>
                                                        )}

                                                        <div className="admin-bulk-actions">
                                                            <label className="admin-bulk-actions__filter">
                                                                Apply to
                                                                <select
                                                                    value={typeFilterValue}
                                                                    onChange={(e) =>
                                                                        setTypeFilterValue(e.target.value)
                                                                    }
                                                                >
                                                                    <option value="">All cards</option>
                                                                    <optgroup label="Team color">
                                                                        {ALL_COLORS.map((color) => (
                                                                            <option
                                                                                key={color}
                                                                                value={`color:${color}`}
                                                                            >
                                                                                {capitalize(color)}
                                                                            </option>
                                                                        ))}
                                                                    </optgroup>
                                                                    <optgroup label="Category">
                                                                        {ALL_CATEGORIES.map((category) => (
                                                                            <option
                                                                                key={category}
                                                                                value={`category:${category}`}
                                                                            >
                                                                                {category}
                                                                            </option>
                                                                        ))}
                                                                    </optgroup>
                                                                </select>
                                                            </label>

                                                            <div className="admin-bulk-actions__groups">
                                                                {/* Ownership: left-to-right in increasing
                                                                    severity -- grant adds, return is
                                                                    reversible, revoke is not. */}
                                                                <div className="admin-bulk-actions__group">
                                                                    <span className="admin-bulk-actions__group-label">
                                                                        Ownership
                                                                    </span>
                                                                    <div className="admin-bulk-actions__buttons">
                                                                        <button
                                                                            type="button"
                                                                            disabled={actionPending}
                                                                            onClick={() =>
                                                                                handleBulk('bulk-grant')
                                                                            }
                                                                        >
                                                                            Grant
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            title="Takes matching cards back from them, but keeps the cards in their history"
                                                                            disabled={actionPending}
                                                                            onClick={() =>
                                                                                handleBulk('bulk-return')
                                                                            }
                                                                        >
                                                                            Return
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="admin-button--danger"
                                                                            title="Permanently erases matching cards from their history -- cannot be undone"
                                                                            disabled={actionPending}
                                                                            onClick={() =>
                                                                                handleBulk('bulk-revoke')
                                                                            }
                                                                        >
                                                                            Revoke
                                                                        </button>
                                                                    </div>
                                                                </div>

                                                                {/* Seen status: independent of ownership
                                                                    above -- just the greyscale "seen but
                                                                    not collected" flag. */}
                                                                <div className="admin-bulk-actions__group">
                                                                    <span className="admin-bulk-actions__group-label">
                                                                        Seen status
                                                                    </span>
                                                                    <div className="admin-bulk-actions__buttons">
                                                                        <button
                                                                            type="button"
                                                                            disabled={actionPending}
                                                                            onClick={() =>
                                                                                handleBulk('bulk-see')
                                                                            }
                                                                        >
                                                                            See
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            disabled={actionPending}
                                                                            onClick={() =>
                                                                                handleBulk('bulk-unsee')
                                                                            }
                                                                        >
                                                                            Unsee
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <input
                                                            type="search"
                                                            className="admin-search"
                                                            placeholder="Search cards by title, color, or category..."
                                                            value={cardSearch}
                                                            onChange={(e) => setCardSearch(e.target.value)}
                                                        />

                                                        <ul className="admin-card-list">
                                                            {filteredCards.map((sc) => {
                                                                const instances =
                                                                    instancesBySupercard.get(sc.n) ?? [];
                                                                const seen = selectedUserSeen.has(sc.n);
                                                                return (
                                                                    <li
                                                                        key={sc.n}
                                                                        className="admin-card-row"
                                                                    >
                                                                        <span
                                                                            className="admin-card-row__swatch"
                                                                            style={{
                                                                                backgroundColor: sc.color,
                                                                            }}
                                                                            title={capitalize(sc.color)}
                                                                        />
                                                                        <div className="admin-card-row__body">
                                                                            <div className="admin-card-row__title">
                                                                                {sc.title}
                                                                                <span className="admin-card-row__categories">
                                                                                    {sc.categories.join(', ')}
                                                                                </span>
                                                                            </div>

                                                                            <label className="admin-card-row__seen">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={seen}
                                                                                    disabled={actionPending}
                                                                                    onChange={(e) =>
                                                                                        handleToggleSeen(
                                                                                            sc.n,
                                                                                            e.target.checked,
                                                                                        )
                                                                                    }
                                                                                />
                                                                                Seen
                                                                            </label>

                                                                            <div className="admin-instance-list">
                                                                                {instances.map((instance) => {
                                                                                    const ownedByThem =
                                                                                        currentOwnerId(
                                                                                            instance,
                                                                                        ) === selectedUserId;
                                                                                    return (
                                                                                        <div
                                                                                            key={
                                                                                                instance.cardInstanceId
                                                                                            }
                                                                                            className="admin-instance-chip"
                                                                                        >
                                                                                            <span>
                                                                                                {sc.n}-
                                                                                                {
                                                                                                    instance.cardInstanceId
                                                                                                }
                                                                                                {!ownedByThem && (
                                                                                                    <em className="admin-instance-chip__note">
                                                                                                        {' '}
                                                                                                        (no
                                                                                                        longer
                                                                                                        held)
                                                                                                    </em>
                                                                                                )}
                                                                                            </span>
                                                                                            {ownedByThem && (
                                                                                                <>
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        disabled={
                                                                                                            actionPending
                                                                                                        }
                                                                                                        onClick={() =>
                                                                                                            setTransferringInstanceId(
                                                                                                                transferringInstanceId ===
                                                                                                                    instance.cardInstanceId
                                                                                                                    ? null
                                                                                                                    : instance.cardInstanceId,
                                                                                                            )
                                                                                                        }
                                                                                                    >
                                                                                                        Transfer
                                                                                                    </button>
                                                                                                    <button
                                                                                                        type="button"
                                                                                                        title="Takes it back from them, but keeps it in their history"
                                                                                                        disabled={
                                                                                                            actionPending
                                                                                                        }
                                                                                                        onClick={() =>
                                                                                                            handleReturn(
                                                                                                                instance.cardInstanceId,
                                                                                                            )
                                                                                                        }
                                                                                                    >
                                                                                                        Return
                                                                                                    </button>
                                                                                                </>
                                                                                            )}
                                                                                            <button
                                                                                                type="button"
                                                                                                className="admin-button--danger"
                                                                                                title="Permanently erases this from their history -- cannot be undone"
                                                                                                disabled={
                                                                                                    actionPending
                                                                                                }
                                                                                                onClick={() =>
                                                                                                    handleRevoke(
                                                                                                        instance.cardInstanceId,
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                Revoke
                                                                                            </button>
                                                                                            <button
                                                                                                type="button"
                                                                                                className="admin-button--danger"
                                                                                                title="Wipes this physical card's ENTIRE history -- every student who's ever held it, not just this one -- and returns it to the unclaimed pool. Cannot be undone."
                                                                                                disabled={
                                                                                                    actionPending
                                                                                                }
                                                                                                onClick={() =>
                                                                                                    handleClearInstanceHistory(
                                                                                                        instance.cardInstanceId,
                                                                                                    )
                                                                                                }
                                                                                            >
                                                                                                Reset
                                                                                            </button>

                                                                                            {transferringInstanceId ===
                                                                                                instance.cardInstanceId && (
                                                                                                <div className="admin-transfer-panel">
                                                                                                    <input
                                                                                                        type="search"
                                                                                                        autoFocus
                                                                                                        placeholder="Search students..."
                                                                                                        value={
                                                                                                            transferSearch
                                                                                                        }
                                                                                                        onChange={(e) =>
                                                                                                            setTransferSearch(
                                                                                                                e
                                                                                                                    .target
                                                                                                                    .value,
                                                                                                            )
                                                                                                        }
                                                                                                    />
                                                                                                    <ul>
                                                                                                        {transferCandidates.map(
                                                                                                            (
                                                                                                                candidate,
                                                                                                            ) => (
                                                                                                                <li
                                                                                                                    key={
                                                                                                                        candidate.id
                                                                                                                    }
                                                                                                                >
                                                                                                                    <button
                                                                                                                        type="button"
                                                                                                                        disabled={
                                                                                                                            actionPending
                                                                                                                        }
                                                                                                                        onClick={() =>
                                                                                                                            handleTransfer(
                                                                                                                                instance.cardInstanceId,
                                                                                                                                candidate.id,
                                                                                                                            )
                                                                                                                        }
                                                                                                                    >
                                                                                                                        {
                                                                                                                            candidate.username
                                                                                                                        }
                                                                                                                    </button>
                                                                                                                </li>
                                                                                                            ),
                                                                                                        )}
                                                                                                        {transferCandidates.length ===
                                                                                                            0 && (
                                                                                                            <li>
                                                                                                                No
                                                                                                                matches.
                                                                                                            </li>
                                                                                                        )}
                                                                                                    </ul>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>

                                                                        <button
                                                                            type="button"
                                                                            disabled={actionPending}
                                                                            onClick={() => handleGrant(sc.n)}
                                                                        >
                                                                            + Grant
                                                                        </button>
                                                                    </li>
                                                                );
                                                            })}
                                                        </ul>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Danger zone"
                className="admin-settings admin-danger-zone"
                defaultOpen={false}
            >
                <p className="admin-card-row__categories">
                    Wipes every card&rsquo;s ownership and transaction history site-wide, returning the entire
                    pool to unclaimed. Individual cards can be reset the same way from a student&rsquo;s card
                    list below (look for &ldquo;Reset&rdquo; on each card).
                </p>
                <button
                    type="button"
                    className="admin-button--danger"
                    disabled={actionPending}
                    onClick={handleClearAllHistory}
                >
                    Clear ALL ownership &amp; history
                </button>
                <p className="admin-card-row__categories">
                    Permanently deletes every non-admin user account. Their trade history is kept but
                    reassigned to &ldquo;Unassigned&rdquo; rather than erased.
                </p>
                <button
                    type="button"
                    className="admin-button--danger"
                    disabled={actionPending}
                    onClick={handleDeleteAllNonAdmin}
                >
                    Delete ALL non-admin users
                </button>
            </CollapsibleSection>
        </div>
    );
}
