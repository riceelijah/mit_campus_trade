import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User } from '../user';
import { Card } from '../card';
import { FlagColor } from '../types';
import { getSupercard } from '../data/supercards';

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
    /** The logged-in viewer, or null if nobody's logged in. */
    user: User | null;
    /** The logged-in viewer's owned card instances, custody chains and all. */
    ownedCards: Card[];
    /** True until the initial "am I logged in?" check has resolved. */
    loading: boolean;
    register(data: RegisterData): Promise<void>;
    login(data: LoginData): Promise<void>;
    logout(): Promise<void>;
    changePassword(data: ChangePasswordData): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface PublicUserJson {
    id: number;
    username: string;
    name: string;
    email: string;
    team: FlagColor;
    isAdmin: boolean;
}

function userFromJson(json: PublicUserJson): User {
    return new User(json.id, json.username, json.name, json.email, json.team, json.isAdmin);
}

interface PublicCardInstanceJson {
    cardInstanceId: number;
    supercardN: number;
    custody: { acquiredAt: string; owner: PublicUserJson }[];
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
        const card = new Card(supercard, item.cardInstanceId);
        for (const event of item.custody) {
            card.transferTo(userFromJson(event.owner), new Date(event.acquiredAt));
        }
        cards.push(card);
    }
    return cards;
}

async function extractError(res: Response): Promise<string> {
    try {
        const body = await res.json();
        return typeof body.error === 'string' ? body.error : 'Something went wrong';
    } catch {
        return 'Something went wrong';
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [ownedCards, setOwnedCards] = useState<Card[]>([]);
    const [loading, setLoading] = useState(true);

    const refreshOwnedCards = useCallback(async () => {
        const res = await fetch('/api/me/cards', { credentials: 'include' });
        if (!res.ok) {
            setOwnedCards([]);
            return;
        }
        const body = await res.json();
        setOwnedCards(cardsFromJson(body.cards));
    }, []);

    useEffect(() => {
        (async () => {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            if (res.ok) {
                const body = await res.json();
                setUser(userFromJson(body.user));
                await refreshOwnedCards();
            }
            setLoading(false);
        })();
    }, [refreshOwnedCards]);

    const register = useCallback(async (data: RegisterData) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const body = await res.json();
        setUser(userFromJson(body.user));
        await refreshOwnedCards();
    }, [refreshOwnedCards]);

    const login = useCallback(async (data: LoginData) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const body = await res.json();
        setUser(userFromJson(body.user));
        await refreshOwnedCards();
    }, [refreshOwnedCards]);

    const logout = useCallback(async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
        setOwnedCards([]);
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

    return (
        <AuthContext.Provider value={{ user, ownedCards, loading, register, login, logout, changePassword }}>
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
