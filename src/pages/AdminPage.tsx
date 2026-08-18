import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { SUPERCARDS } from '../data/supercards';
import { PublicUserJson, PublicCardInstanceJson, AdminUserCardsJson, FlagColor } from '../types';
import { extractError } from '../lib/api';

// Derived from the actual card data rather than hardcoded, so a future content-sheet update
// (a new team color in use, a renamed/added category tag) is reflected here automatically.
const ALL_COLORS = [...new Set(SUPERCARDS.map((sc) => sc.color))].sort();
const ALL_CATEGORIES = [...new Set(SUPERCARDS.flatMap((sc) => sc.categories))].sort();

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

    const loadUsers = useCallback(async () => {
        const res = await fetch('/api/admin/users', { credentials: 'include' });
        if (!res.ok) {
            setUsersError(await extractError(res));
            return;
        }
        const body = await res.json();
        setUsers(body.users);
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
        }
    }, [user, loadUsers]);

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

    async function runAction(fn: () => Promise<Response>) {
        setActionError(null);
        setActionPending(true);
        try {
            const res = await fn();
            if (!res.ok) throw new Error(await extractError(res));
            if (selectedUserId !== null) await loadCardsFor(selectedUserId);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setActionPending(false);
        }
    }

    async function handleToggleCollectionGate(checked: boolean) {
        setSettingsError(null);
        setSettingsPending(true);
        try {
            const res = await fetch('/api/admin/settings/collection-requires-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value: checked }),
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
                        onChange={(e) => handleToggleCollectionGate(e.target.checked)}
                    />
                    Require login to view the Collection page
                </label>
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
                                                                #{instance.cardInstanceId}
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
