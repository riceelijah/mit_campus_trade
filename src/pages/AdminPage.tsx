import { useState, useEffect, useCallback, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { SUPERCARDS, getSupercard } from '../data/supercards';
import { PublicUserJson, PublicCardInstanceJson } from '../types';
import { extractError } from '../lib/api';

export default function AdminPage() {
    const { user, loading } = useAuth();

    const [users, setUsers] = useState<PublicUserJson[]>([]);
    const [usersError, setUsersError] = useState<string | null>(null);

    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [selectedUserCards, setSelectedUserCards] = useState<PublicCardInstanceJson[]>([]);

    const [grantSupercardN, setGrantSupercardN] = useState<number | ''>('');
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
        const body = await res.json();
        setSelectedUserCards(body.cards);
    }, []);

    useEffect(() => {
        if (user?.isAdmin) {
            loadUsers();
        }
    }, [user, loadUsers]);

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
        setActionError(null);
        loadCardsFor(userId);
    }

    async function handleGrant(e: FormEvent) {
        e.preventDefault();
        setActionError(null);
        if (selectedUserId === null || grantSupercardN === '') return;

        setActionPending(true);
        try {
            const res = await fetch(`/api/admin/users/${selectedUserId}/grant-card`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ supercardN: grantSupercardN }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            setGrantSupercardN('');
            await loadCardsFor(selectedUserId);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setActionPending(false);
        }
    }

    async function handleTransfer(cardInstanceId: number, newOwnerUserId: number) {
        setActionError(null);
        setActionPending(true);
        try {
            const res = await fetch(`/api/admin/card-instances/${cardInstanceId}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ newOwnerUserId }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            if (selectedUserId !== null) await loadCardsFor(selectedUserId);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setActionPending(false);
        }
    }

    return (
        <div>
            <h1>Admin</h1>

            {usersError && <p className="form-error">{usersError}</p>}

            <div className="admin-layout">
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
                            {users.map((u) => (
                                <tr
                                    key={u.id}
                                    className={u.id === selectedUserId ? 'admin-table__row--selected' : ''}
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

                {selectedUserId !== null && (
                    <div className="admin-detail">
                        <h2>{users.find((u) => u.id === selectedUserId)?.username}&rsquo;s cards</h2>

                        {actionError && <p className="form-error">{actionError}</p>}

                        <ul className="admin-card-list">
                            {selectedUserCards.map((card) => (
                                <li key={card.cardInstanceId}>
                                    #{card.supercardN}{' '}
                                    {getSupercard(card.supercardN)?.title ?? '(unknown card)'}{' '}
                                    <select
                                        disabled={actionPending}
                                        defaultValue=""
                                        onChange={(e) => {
                                            const newOwnerUserId = Number(e.target.value);
                                            if (newOwnerUserId)
                                                handleTransfer(card.cardInstanceId, newOwnerUserId);
                                        }}
                                    >
                                        <option value="" disabled>
                                            Transfer to&hellip;
                                        </option>
                                        {users
                                            .filter((u) => u.id !== selectedUserId)
                                            .map((u) => (
                                                <option key={u.id} value={u.id}>
                                                    {u.username}
                                                </option>
                                            ))}
                                    </select>
                                </li>
                            ))}
                            {selectedUserCards.length === 0 && <li>No cards yet.</li>}
                        </ul>

                        <form className="auth-form" onSubmit={handleGrant}>
                            <label>
                                Grant a card
                                <select
                                    value={grantSupercardN}
                                    onChange={(e) => setGrantSupercardN(Number(e.target.value))}
                                >
                                    <option value="" disabled>
                                        Choose a card&hellip;
                                    </option>
                                    {SUPERCARDS.map((sc) => (
                                        <option key={sc.n} value={sc.n}>
                                            #{sc.n} {sc.title}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button type="submit" disabled={actionPending || grantSupercardN === ''}>
                                Grant
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
