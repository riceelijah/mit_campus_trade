import {
    UserRow,
    CardInstanceRow,
    CustodyEventWithUser,
    ExchangeEventRow,
    custodyForCardInstance,
    exchangeEventsForCardInstance,
    noteRevisionsForExchangeEvent,
    exchangeEventsForUser,
    cardInstancesCollectedBy,
    findExchangeEventById,
    unassignedUserId,
    unassignedUserEmail,
} from './db';
import { FlagColor, CollectionViewMode, ExchangeEventJson, MyCardEventJson } from '../src/types';

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

/** Admin-only extension of PublicUser, adding `hidden`. Deliberately kept separate from
 *  sanitizeUser/PublicUser above -- that shared shape is reused by the collect-candidates route
 *  (trade-attribution guessing, shown to any logged-in student) and sanitizeCustodyEvent below
 *  (public card-detail trade history), and leaking which candidate is a hidden account there
 *  would defeat the point of hiding them. Only the admin users list should ever see this. */
export interface AdminUser extends PublicUser {
    hidden: boolean;
}

export function sanitizeUserForAdmin(row: UserRow): AdminUser {
    return {
        ...sanitizeUser(row),
        hidden: row.hidden === 1,
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

/** Powers GET /api/admin/exchange-events -- see listExchangeEvents in db.ts. Admin-only: this
 *  is the one place priorConversationNotes (a note's full edit history) is ever exposed. */
export function sanitizeExchangeEvent(row: ExchangeEventRow): ExchangeEventJson {
    return {
        exchangeEventId: row.exchange_id,
        userName: row.user_name,
        supercardN: row.received_card_type_id,
        cardUniqueId: row.received_card_unique_id,
        tradeTime: row.trade_time,
        receivedFromOtherPerson: row.received_from_other_person,
        conversationNotes: row.conversation_notes,
        priorConversationNotes: noteRevisionsForExchangeEvent(row.exchange_id).map((rev) => ({
            notes: rev.notes,
            replacedAt: rev.replaced_at,
        })),
    };
}

type PickupEntry = Extract<MyCardEventJson, { kind: 'pickup' }>;
type RemovedEntry = Extract<MyCardEventJson, { kind: 'removed' }>;

/** Every point where a card `userId` once held moved on to someone else -- see MyCardEventJson's
 *  'removed' variant for why this has to be synthesized rather than read off a row of its own.
 *  Walks each instance the student has ever appeared in exchange_events for
 *  (cardInstancesCollectedBy) and looks, in its full history, for a spot where `userId` is
 *  immediately followed by a different holder.
 *
 *  `bundledExchangeEventIds` skips any such transition that's *also* the other half of one of
 *  this same student's own confirmed trades (a pickup row's given_card_exchange_id -- see
 *  buildMyCardEventsFeed) -- that card leaving is already told as part of that trade's own
 *  entry ("you gave up X for it"), so it shouldn't also show up here as a second, redundant,
 *  unexplained "this card left your collection". A removal that isn't in this set had no
 *  matching pickup (an admin Return, or a one-sided give with no completed trade), so it still
 *  gets its own bare entry. */
function removalEventsForUser(userId: number, bundledExchangeEventIds: ReadonlySet<number>): RemovedEntry[] {
    const removals: RemovedEntry[] = [];
    for (const instance of cardInstancesCollectedBy(userId)) {
        const history = exchangeEventsForCardInstance(instance.id);
        for (let i = 0; i < history.length - 1; i++) {
            if (history[i].user_id === userId && history[i + 1].user_id !== userId) {
                const next = history[i + 1];
                if (bundledExchangeEventIds.has(next.exchange_id)) continue;
                removals.push({
                    kind: 'removed',
                    cardInstanceId: instance.id,
                    supercardN: instance.supercard_n,
                    // Non-null by construction -- see serializeCardInstance's own comment.
                    cardUniqueId: instance.unique_id!,
                    removedAt: next.trade_time,
                    takenByName: next.user_id === unassignedUserId() ? null : next.user_name,
                });
            }
        }
    }
    return removals;
}

/** Powers GET /api/me/card-events -- the full My Notes feed. Pickups need to see the whole
 *  list at once (to know whether each one was the *first* pickup of that design), so this
 *  builds them here rather than through a per-row sanitizer like sanitizeExchangeEvent, then
 *  merges in every removal (see removalEventsForUser) and sorts everything newest first. */
export function buildMyCardEventsFeed(userId: number): MyCardEventJson[] {
    const rows = exchangeEventsForUser(userId); // newest first

    // Walk oldest-to-newest just to mark each design's first-ever pickup correctly, independent
    // of the outward (newest-first) ordering.
    const isNewToCollection = new Map<number, boolean>(); // exchange_id -> boolean
    const seenDesigns = new Set<number>();
    for (const row of [...rows].reverse()) {
        const isNew = row.received_card_type_id !== null && !seenDesigns.has(row.received_card_type_id);
        if (row.received_card_type_id !== null) seenDesigns.add(row.received_card_type_id);
        isNewToCollection.set(row.exchange_id, isNew);
    }

    const pickups: PickupEntry[] = rows.map((row) => {
        // given_card_exchange_id (once a trade completes) points at the sibling event where
        // this same student received the card they later gave up in return -- see that
        // column's own schema comment in db.ts.
        const tradedAway =
            row.given_card_exchange_id !== null ? findExchangeEventById(row.given_card_exchange_id) : undefined;
        return {
            kind: 'pickup',
            exchangeEventId: row.exchange_id,
            supercardN: row.received_card_type_id,
            cardUniqueId: row.received_card_unique_id,
            tradeTime: row.trade_time,
            isFirstScan: row.received_card_previous_user_name === null,
            isNewToCollection: isNewToCollection.get(row.exchange_id) ?? false,
            fromUserName:
                row.received_card_previous_user_email === unassignedUserEmail()
                    ? null
                    : row.received_card_previous_user_name,
            wasTrade: row.given_card_exchange_id !== null,
            tradedAwaySupercardN: tradedAway?.received_card_type_id ?? null,
            tradedAwayCardUniqueId: tradedAway?.received_card_unique_id ?? null,
            notes: row.conversation_notes,
        };
    });

    const bundledExchangeEventIds = new Set(
        rows.flatMap((row) => (row.given_card_exchange_id !== null ? [row.given_card_exchange_id] : [])),
    );
    const removals = removalEventsForUser(userId, bundledExchangeEventIds);

    // Both kinds' timestamps are the same SQLite datetime('now') format (zero-padded
    // "YYYY-MM-DD HH:MM:SS", UTC), so plain string comparison sorts them chronologically.
    return [...pickups, ...removals].sort((a, b) => {
        const whenA = a.kind === 'pickup' ? a.tradeTime : a.removedAt;
        const whenB = b.kind === 'pickup' ? b.tradeTime : b.removedAt;
        return whenA < whenB ? 1 : whenA > whenB ? -1 : 0;
    });
}
