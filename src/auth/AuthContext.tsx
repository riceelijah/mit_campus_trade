import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../user';
import { Card } from '../card';
import { FlagColor, PublicUserJson, PublicCardInstanceJson, MyCardsJson } from '../types';
import { getSupercard } from '../data/supercards';
import { extractError } from '../lib/api';

export interface RegisterData {
    name: string;
    email: string;
    team: FlagColor;
    password: string;
    confirmPassword: string;
}

export interface LoginData {
    email: string;
    password: string;
}

export interface ChangePasswordData {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
}

interface AuthContextValue {
    /** The logged-in viewer, or null if nobody's logged in -- collected/owned cards and all. */
    user: User | null;
    /** True until the initial "am I logged in?" check has resolved. */
    loading: boolean;
    register(data: RegisterData): Promise<void>;
    login(data: LoginData): Promise<void>;
    logout(): Promise<void>;
    changePassword(data: ChangePasswordData): Promise<void>;
    /**
     * Re-fetches the logged-in viewer's own profile plus collected/owned cards and replaces
     * `user` with the result. Exposed mainly for upcoming trade functionality: a completed
     * trade changes the viewer's owned/collected lists server-side, and this lets a future
     * trade UI ask AuthContext to pick up the new state without a full page reload.
     */
    refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function userFromJson(
    json: PublicUserJson,
    collected: Card[] = [],
    owned: Card[] = [],
    seen: ReadonlySet<number> = new Set(),
): User {
    return new User(
        json.id,
        json.username,
        json.name,
        json.email,
        json.team,
        json.isAdmin,
        collected,
        owned,
        seen,
        json.collectionViewMode,
        json.colorChallengeCompleted,
        json.subObjectiveCompleted,
    );
}

/**
 * Rebuilds real Card instances (custody chain and all) from the API's JSON. Each custody
 * event is replayed through Card.transferTo(), so the domain model's own RI -- no two
 * consecutive owners the same -- doubles as a sanity check on the server's data.
 */
function cardsFromJson(raw: PublicCardInstanceJson[]): Card[] {
    const cards: Card[] = [];
    for (const item of raw) {
        const supercard = getSupercard(item.supercardN);
        if (!supercard) continue; // defensive: server referenced a card number we don't have
        const card = new Card(supercard, item.cardInstanceId, item.uniqueId);
        for (const event of item.custody) {
            card.transferTo(userFromJson(event.owner), new Date(event.acquiredAt));
        }
        cards.push(card);
    }
    return cards;
}

/**
 * Builds the full logged-in-viewer User -- profile fields plus both card lists -- from a
 * bare profile JSON, by additionally fetching and reconstructing GET /api/me/cards. Used by
 * every place that establishes or refreshes the session (initial load, register, login,
 * refreshUser) so each does exactly one setUser() with the final, fully-populated User,
 * instead of a bare user first and a second render once cards arrive.
 */
async function loadFullUser(json: PublicUserJson): Promise<User> {
    const bareUser = userFromJson(json); // stand-in for currentOwner comparisons below; equals() is by id only

    const res = await fetch('/api/me/cards', { credentials: 'include' });
    if (!res.ok) {
        return bareUser; // still a valid User -- empty collected/owned/seen, not "no user"
    }
    const body: MyCardsJson = await res.json();
    const seen = new Set(body.seen);
    try {
        const collected = cardsFromJson(body.collected);
        const owned = collected.filter((card) => card.currentOwner?.equals(bareUser) ?? false);
        return userFromJson(json, collected, owned, seen);
    } catch (err) {
        // cardsFromJson replays server data through Card.transferTo(), which throws if it's
        // ever handed a corrupted custody chain (see revokeCardInstanceFromUser's doc comment
        // in server/db.ts for the one known way that could happen, now guarded against there
        // too). Degrade to an empty collection rather than let that take down this student's
        // entire login/session-load -- losing their card list is recoverable (an admin fixes
        // the data, they refresh); being stuck on an infinite spinner is not.
        console.error('Failed to rebuild card collection from server data:', err);
        return userFromJson(json, [], [], seen);
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            if (res.ok) {
                const body = await res.json();
                setUser(await loadFullUser(body.user));
            }
            setLoading(false);
        })();
    }, []);

    const register = useCallback(async (data: RegisterData) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const body = await res.json();
        setUser(await loadFullUser(body.user));
    }, []);

    const login = useCallback(async (data: LoginData) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const body = await res.json();
        setUser(await loadFullUser(body.user));
    }, []);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
    }, []);

    const changePassword = useCallback(async (data: ChangePasswordData) => {
        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await extractError(res));
    }, []);

    const refreshUser = useCallback(async () => {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
            setUser(null);
            return;
        }
        const body = await res.json();
        setUser(await loadFullUser(body.user));
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, register, login, logout, changePassword, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return ctx;
}
