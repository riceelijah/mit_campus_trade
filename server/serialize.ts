import { UserRow, CardInstanceRow, CustodyEventWithUser, custodyForCardInstance } from './db';

/** The public-facing shape of a user: everything except password_hash. */
export interface PublicUser {
    id: number;
    username: string;
    name: string;
    email: string;
    team: string;
    isAdmin: boolean;
}

export function sanitizeUser(row: UserRow): PublicUser {
    return {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email,
        team: row.team,
        isAdmin: row.is_admin === 1,
    };
}

export interface PublicCustodyEvent {
    acquiredAt: string;
    owner: PublicUser;
}

function sanitizeCustodyEvent(ev: CustodyEventWithUser): PublicCustodyEvent {
    return {
        acquiredAt: ev.acquired_at,
        owner: {
            id: ev.user_id,
            username: ev.username,
            name: ev.name,
            email: ev.email,
            team: ev.team,
            isAdmin: ev.is_admin === 1,
        },
    };
}

export interface PublicCardInstance {
    cardInstanceId: number;
    supercardN: number;
    custody: PublicCustodyEvent[];
}

export function serializeCardInstance(instance: CardInstanceRow): PublicCardInstance {
    return {
        cardInstanceId: instance.id,
        supercardN: instance.supercard_n,
        custody: custodyForCardInstance(instance.id).map(sanitizeCustodyEvent),
    };
}
