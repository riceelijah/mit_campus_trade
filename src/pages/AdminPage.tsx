import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { SUPERCARDS, ALL_COLORS, ALL_CATEGORIES } from '../data/supercards';
import {
    PublicUserJson,
    PublicCardInstanceJson,
    AdminUserCardsJson,
    FlagColor,
    VerifiedTradeJson,
} from '../types';
import { extractError } from '../lib/api';

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

export default function AdminPage() {
    const { user, loading } = useAuth();
    const { settings, refreshSettings } = useSettings();

    const [users, setUsers] = useState<PublicUserJson[]>([]);
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
        }
    }, [user, loadUsers, loadVerifiedTrades]);

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

    const selectedUser = users.find((u) => u.id === selectedUserId);

    return (
        <div>
            <h1>Admin</h1>

            <div className="admin-settings">
                <h2>Site settings</h2>
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
            </div>

            <div className="admin-settings admin-danger-zone">
                <h2>Danger zone</h2>
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
            </div>

            <div className="admin-settings">
                <h2>Verified trades</h2>
                <p className="admin-card-row__categories">
                    Two-way trades the system detected automatically -- both sides scanned their new card and
                    correctly said who they got it from.
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
                            {verifiedTrades.map((t) => (
                                <tr key={t.id}>
                                    <td>{t.userX.username}</td>
                                    <td>{t.cardA.uniqueId}</td>
                                    <td>{new Date(t.datetimeX).toLocaleString()}</td>
                                    <td>{t.userY.username}</td>
                                    <td>{t.cardB.uniqueId}</td>
                                    <td>{new Date(t.datetimeY).toLocaleString()}</td>
                                </tr>
                            ))}
                            {verifiedTrades.length === 0 && (
                                <tr>
                                    <td colSpan={6}>No verified trades yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {usersError && <p className="form-error">{usersError}</p>}

            <div className={`admin-layout${selectedUserId === null ? ' admin-layout--single' : ''}`}>
                <div className="admin-users-panel">
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
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((u) => (
                                    <tr
                                        key={u.id}
                                        className={
                                            u.id === selectedUserId ? 'admin-table__row--selected' : ''
                                        }
                                        onClick={() => selectUser(u.id)}
                                    >
                                        <td>{u.username}</td>
                                        <td>{u.name}</td>
                                        <td>{u.email}</td>
                                        <td>{u.team}</td>
                                        <td>{u.isAdmin ? 'yes' : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {selectedUserId !== null && (
                    <div className="admin-detail">
                        <h2>{selectedUser?.username}&rsquo;s cards</h2>

                        {actionError && <p className="form-error">{actionError}</p>}

                        <div className="admin-bulk-actions">
                            <label className="admin-bulk-actions__filter">
                                Apply to
                                <select
                                    value={typeFilterValue}
                                    onChange={(e) => setTypeFilterValue(e.target.value)}
                                >
                                    <option value="">All cards</option>
                                    <optgroup label="Team color">
                                        {ALL_COLORS.map((color) => (
                                            <option key={color} value={`color:${color}`}>
                                                {color}
                                            </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Category">
                                        {ALL_CATEGORIES.map((category) => (
                                            <option key={category} value={`category:${category}`}>
                                                {category}
                                            </option>
                                        ))}
                                    </optgroup>
                                </select>
                            </label>

                            <div className="admin-bulk-actions__groups">
                                {/* Ownership: left-to-right in increasing severity -- grant adds,
                                    return is reversible, revoke is not. */}
                                <div className="admin-bulk-actions__group">
                                    <span className="admin-bulk-actions__group-label">Ownership</span>
                                    <div className="admin-bulk-actions__buttons">
                                        <button
                                            type="button"
                                            disabled={actionPending}
                                            onClick={() => handleBulk('bulk-grant')}
                                        >
                                            Grant
                                        </button>
                                        <button
                                            type="button"
                                            title="Takes matching cards back from them, but keeps the cards in their history"
                                            disabled={actionPending}
                                            onClick={() => handleBulk('bulk-return')}
                                        >
                                            Return
                                        </button>
                                        <button
                                            type="button"
                                            className="admin-button--danger"
                                            title="Permanently erases matching cards from their history -- cannot be undone"
                                            disabled={actionPending}
                                            onClick={() => handleBulk('bulk-revoke')}
                                        >
                                            Revoke
                                        </button>
                                    </div>
                                </div>

                                {/* Seen status: independent of ownership above -- just the
                                    greyscale "seen but not collected" flag. */}
                                <div className="admin-bulk-actions__group">
                                    <span className="admin-bulk-actions__group-label">Seen status</span>
                                    <div className="admin-bulk-actions__buttons">
                                        <button
                                            type="button"
                                            disabled={actionPending}
                                            onClick={() => handleBulk('bulk-see')}
                                        >
                                            See
                                        </button>
                                        <button
                                            type="button"
                                            disabled={actionPending}
                                            onClick={() => handleBulk('bulk-unsee')}
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
                                const instances = instancesBySupercard.get(sc.n) ?? [];
                                const seen = selectedUserSeen.has(sc.n);
                                return (
                                    <li key={sc.n} className="admin-card-row">
                                        <span
                                            className="admin-card-row__swatch"
                                            style={{ backgroundColor: sc.color }}
                                            title={sc.color}
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
                                                    onChange={(e) => handleToggleSeen(sc.n, e.target.checked)}
                                                />
                                                Seen
                                            </label>

                                            <div className="admin-instance-list">
                                                {instances.map((instance) => {
                                                    const ownedByThem =
                                                        currentOwnerId(instance) === selectedUserId;
                                                    return (
                                                        <div
                                                            key={instance.cardInstanceId}
                                                            className="admin-instance-chip"
                                                        >
                                                            <span>
                                                                {instance.uniqueId} (#
                                                                {instance.cardInstanceId})
                                                                {!ownedByThem && (
                                                                    <em className="admin-instance-chip__note">
                                                                        {' '}
                                                                        (no longer held)
                                                                    </em>
                                                                )}
                                                            </span>
                                                            {ownedByThem && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        disabled={actionPending}
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
                                                                        disabled={actionPending}
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
                                                                disabled={actionPending}
                                                                onClick={() =>
                                                                    handleRevoke(instance.cardInstanceId)
                                                                }
                                                            >
                                                                Revoke
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="admin-button--danger"
                                                                title="Wipes this physical card's ENTIRE history -- every student who's ever held it, not just this one -- and returns it to the unclaimed pool. Cannot be undone."
                                                                disabled={actionPending}
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
                                                                        value={transferSearch}
                                                                        onChange={(e) =>
                                                                            setTransferSearch(e.target.value)
                                                                        }
                                                                    />
                                                                    <ul>
                                                                        {transferCandidates.map((u) => (
                                                                            <li key={u.id}>
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={actionPending}
                                                                                    onClick={() =>
                                                                                        handleTransfer(
                                                                                            instance.cardInstanceId,
                                                                                            u.id,
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    {u.username}
                                                                                </button>
                                                                            </li>
                                                                        ))}
                                                                        {transferCandidates.length === 0 && (
                                                                            <li>No matches.</li>
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
                )}
            </div>
        </div>
    );
}
