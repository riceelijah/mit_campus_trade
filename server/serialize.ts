import { UserRow, CardInstanceRow, CustodyEventWithUser, custodyForCardInstance } from './db';
import { FlagColor, CollectionViewMode } from '../src/types';

/** The public-facing shape of a user: everything except password_hash. */
export interface PublicUser {
    id: number;
    username: string;
    name: string;
    email: string;
    team: FlagColor;
    isAdmin: boolean;
    collectionViewMode: CollectionViewMode;
}

// row.team/collection_view_mode are stored as plain TEXT, but every write path (auth.ts's
// register handler, admin.ts's/me.ts's collection-view-mode endpoints) already validates
// them before insert/update, so these casts are safe by construction.
export function sanitizeUser(row: UserRow): PublicUser {
    return {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email,
        team: row.team as FlagColor,
        isAdmin: row.is_admin === 1,
        collectionViewMode: row.collection_view_mode as CollectionViewMode,
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
            team: ev.team as FlagColor, // see sanitizeUser -- validated at insert time
            isAdmin: ev.is_admin === 1,
            collectionViewMode: ev.collection_view_mode as CollectionViewMode,
        },
    };
}

export interface PublicCardInstance {
    cardInstanceId: number;
    supercardN: number;
    uniqueId: string;
    custody: PublicCustodyEvent[];
}

export function serializeCardInstance(instance: CardInstanceRow): PublicCardInstance {
    return {
        cardInstanceId: instance.id,
        supercardN: instance.supercard_n,
        // Non-null by construction: every card_instances row comes from
        // scripts/import-card-copies.ts, which always sets unique_id. The column itself is
        // nullable only to allow the pre-import ALTER TABLE migration step (see db.ts).
        uniqueId: instance.unique_id!,
        custody: custodyForCardInstance(instance.id).map(sanitizeCustodyEvent),
    };
}
