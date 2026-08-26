import {
    UserRow,
    CardInstanceRow,
    CustodyEventWithUser,
    ExchangeEventRow,
    custodyForCardInstance,
} from './db';
import { FlagColor, CollectionViewMode, ExchangeEventJson } from '../src/types';

/** The public-facing shape of a user: everything except password_hash. */
export interface PublicUser {
    id: number;
    username: string;
    name: string;
    email: string;
    team: FlagColor;
    isAdmin: boolean;
    collectionViewMode: CollectionViewMode;
    colorChallengeCompleted: boolean;
    subObjectiveCompleted: boolean;
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
        colorChallengeCompleted: row.color_challenge_completed === 1,
        subObjectiveCompleted: row.sub_objective_completed === 1,
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
            colorChallengeCompleted: ev.color_challenge_completed === 1,
            subObjectiveCompleted: ev.sub_objective_completed === 1,
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

/** Powers GET /api/admin/exchange-events -- see listExchangeEvents in db.ts. */
export function sanitizeExchangeEvent(row: ExchangeEventRow): ExchangeEventJson {
    return {
        exchangeEventId: row.exchange_id,
        userName: row.user_name,
        supercardN: row.received_card_type_id,
        cardUniqueId: row.received_card_unique_id,
        tradeTime: row.trade_time,
        receivedFromOtherPerson: row.received_from_other_person,
        conversationNotes: row.conversation_notes,
    };
}
