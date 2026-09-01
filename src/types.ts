/**
 * One of the 12 flag colors that MIT Campus Trade teams (and their cards) come in.
 */
export type FlagColor =
    | 'red'
    | 'blue'
    | 'green'
    | 'yellow'
    | 'orange'
    | 'purple'
    | 'pink'
    | 'black'
    | 'white'
    | 'brown'
    | 'gold'
    | 'silver';

export const VALID_COLORS: ReadonlySet<FlagColor> = new Set([
    'red',
    'blue',
    'green',
    'yellow',
    'orange',
    'purple',
    'pink',
    'black',
    'white',
    'brown',
    'gold',
    'silver',
]);

/**
 * The Collection page's visibility toggle -- 'owned' shows only cards currently held (the
 * narrowest view: a subset of 'collected'), 'collected' shows every card ever collected
 * (including ones since traded away), 'seen' additionally includes scanned-but-not-registered
 * cards, 'all' shows the full dex. Each is a strict superset of the one before it. Persisted
 * per account (see User.collectionViewMode) so it survives across sessions/devices.
 */
export type CollectionViewMode = 'owned' | 'collected' | 'seen' | 'all';

export const VALID_COLLECTION_VIEW_MODES: ReadonlySet<CollectionViewMode> = new Set([
    'owned',
    'collected',
    'seen',
    'all',
]);

/**
 * Throws an Error with `message` if `condition` is false.
 * Used by every class's checkRep() to enforce its rep invariant.
 */
export function assert(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/**
 * The public-facing shape of a user, as sent/received over the API (no password_hash).
 * Shared between client and server so the two never redeclare it independently and drift.
 */
export interface PublicUserJson {
    id: number;
    username: string;
    name: string;
    email: string;
    team: FlagColor;
    isAdmin: boolean;
    collectionViewMode: CollectionViewMode;
    /** Manually toggled by an admin once the player finishes the color challenge -- shown as a
     *  badge in the admin panel and on the player's own Collection page. */
    colorChallengeCompleted: boolean;
    /** Same as colorChallengeCompleted, for the player's sub-objective. */
    subObjectiveCompleted: boolean;
}

/** Admin-only extension of PublicUserJson, adding `hidden` -- the shape returned by
 *  GET /api/admin/users. Deliberately not part of PublicUserJson itself: that shared shape is
 *  also used for CollectCandidatesJson's candidates and PublicCustodyEventJson's owner, both
 *  shown to any logged-in student, and leaking which candidate is hidden there would defeat the
 *  point of hiding them (see server/serialize.ts's AdminUser). */
export interface AdminUserJson extends PublicUserJson {
    /** Admin-only visibility flag: excluded from the trade-attribution "who gave you this
     *  card" guessing pool (as both a distractor and the ground-truth answer), but otherwise
     *  logs in and trades completely normally. Granting admin defaults this to true; it's
     *  independently toggleable afterward. */
    hidden: boolean;
}

/** One entry in a card instance's ownership history, as sent over the API. */
export interface PublicCustodyEventJson {
    acquiredAt: string;
    owner: PublicUserJson;
}

/** One physical/digital card instance and its full custody chain, as sent over the API. */
export interface PublicCardInstanceJson {
    cardInstanceId: number;
    supercardN: number;
    /** The 4-character id printed in this specific copy's QR code / URL, unique among every
     *  copy ever printed -- as opposed to supercardN, which identifies the card *design*. */
    uniqueId: string;
    custody: PublicCustodyEventJson[];
}

/** The shape returned by GET /api/me/cards. */
export interface MyCardsJson {
    collected: PublicCardInstanceJson[];
    /** Supercard (dex) numbers the viewer has scanned via "Just looking" or collected. */
    seen: number[];
}

/** The shape returned by GET /api/admin/users/:userId/cards. */
export interface AdminUserCardsJson {
    /** Every card instance this student has ever held, current or past (their full history --
     *  unlike the self-service endpoint's "collected", named "cards" here since the admin UI
     *  needs to distinguish currently-owned from historical within the same list). */
    cards: PublicCardInstanceJson[];
    seen: number[];
}

/** The shape returned by GET /api/cards/:uniqueId/collect-candidates -- powers the "who'd you
 *  get this from?" popup shown when a scanned/visited card instance already has an owner. */
export interface CollectCandidatesJson {
    /** False when there's no one to ask about (never collected, or the viewer is themselves
     *  the current owner) -- the client should skip straight to collecting, no popup. */
    hasPreviousOwner: boolean;
    /** The previous owner mixed in with up to 3 random other users, already shuffled
     *  server-side, with nothing here indicating which entry is the real previous owner --
     *  that's checked entirely server-side by POST /api/me/collect, specifically so the
     *  correct answer can't be read off this response (e.g. via devtools) to cheat the quiz.
     *  Empty when hasPreviousOwner is false. */
    candidates: PublicUserJson[];
}

/** The shape returned by GET /api/cards/:uniqueId -- resolves a bare unique_id (as typed by
 *  hand into the QR scanner's manual-entry fallback, with no supercard number attached) to the
 *  card design it belongs to, so the client can proceed exactly as if that instance had been
 *  scanned. Unauthenticated: this reveals no more than scanning the QR code itself already
 *  would to a logged-out viewer. */
export interface ResolveCardJson {
    highlightId: string;
}

/** One row of GET /api/admin/verified-trades -- a two-way trade the system detected by
 *  matching up correctly-attributed exchange events on both sides (see server/db.ts's
 *  tryFormVerifiedTrade). Card identities are always the 4-character alphanumeric unique_id
 *  printed on the physical card, never a bare internal number. The two
 *  userOne/TwoConversationNotes fields are each side's own answer to the trade-conversation
 *  research banner (PromptBanner) for the exchange event that made up their half of this
 *  trade -- null if that side never answered. */
export interface VerifiedTradeJson {
    tradeId: number;
    userOne: { id: number; username: string; name: string };
    cardGivenByUserOneUniqueId: string;
    /** Which design cardGivenByUserOneUniqueId belongs to -- lets the admin UI link/tooltip to
     *  the supercard's page. Null only if the unique_id somehow doesn't resolve to a known
     *  card_instance (shouldn't happen in practice). */
    cardGivenByUserOneSupercardN: number | null;
    userOneTradeTime: string;
    userOneConversationNotes: string | null;
    userTwo: { id: number; username: string; name: string };
    cardGivenByUserTwoUniqueId: string;
    cardGivenByUserTwoSupercardN: number | null;
    userTwoTradeTime: string;
    userTwoConversationNotes: string | null;
}

/** The shape returned by GET /api/admin/stats -- a handful of quick-reference numbers for the
 *  admin Stats panel, computed server-side (see computeAdminStats in server/db.ts) so admin
 *  doesn't have to derive them by hand from the Verified trades/Card Events tables. */
export interface AdminStatsJson {
    totalCardEvents: number;
    totalVerifiedTrades: number;
    totalStudents: number;
    /** Top 5 individual physical cards by trade count, i.e. which specific printed copy has
     *  changed hands the most (as opposed to mostTradedDesigns, aggregated by design). */
    mostTradedCards: { supercardN: number; uniqueId: string; tradeCount: number }[];
    /** Top 5 designs by trade count, aggregated across every copy of each. */
    mostTradedDesigns: { supercardN: number; tradeCount: number }[];
}

/** The shape of one research-prompt banner, handed to the client via CollectFlow's navigation
 *  state right after a successful collect -- see PromptBanner. The two variants are mutually
 *  exclusive: a first-ever scan never has a previous owner to claim, so the attribution popup
 *  (and thus 'trade-conversation') never happens on that same event. */
export type PendingResearchPrompt =
    | { type: 'received-from-other'; exchangeEventId: number }
    | { type: 'trade-conversation'; exchangeEventId: number };

/** The shape returned by POST /api/me/collect. */
export interface CollectResponseJson {
    card: PublicCardInstanceJson;
    exchangeEventId: number;
    /** True iff this card instance had never been claimed by anyone before this collect --
     *  the trigger for the "did you receive this from someone?" banner. */
    firstEverScan: boolean;
}

/** One row of GET /api/admin/exchange-events -- every card-obtained event, current or
 *  historical, not just verified trades. The two research-prompt fields (see exchange_events'
 *  own schema comment in server/db.ts) are null when that particular prompt was never
 *  asked/answered for this event. */
export interface ExchangeEventJson {
    exchangeEventId: number;
    userName: string;
    supercardN: number | null;
    cardUniqueId: string | null;
    tradeTime: string;
    receivedFromOtherPerson: 'Y' | 'N' | null;
    conversationNotes: string | null;
    /** Earlier versions of conversationNotes this student has since edited away, oldest
     *  first -- admin-only visibility (students can't see their own edit history on the My
     *  Notes page, only the current text). Empty if the note has never been edited. */
    priorConversationNotes: { notes: string; replacedAt: string }[];
}

/** One entry of GET /api/me/card-events -- one student's own card history, current or
 *  historical. Two kinds, merged into one feed and sorted newest first (see
 *  buildMyCardEventsFeed in server/serialize.ts):
 *
 *  - 'pickup': the student gained a card -- the self-service counterpart to ExchangeEventJson
 *    (no userName, since it's always the caller), plus context an exchange_events row alone
 *    doesn't carry: whether this was the very first scan of this physical card, whether it's a
 *    design new to this student's own collection, and (if it completed a real two-way trade)
 *    what card they gave up for it.
 *  - 'removed': a card the student held moved on to someone else. exchange_events has no row
 *    of its own for losing a card (only ever implicit -- the next holder's own pickup row), so
 *    this is synthesized from the card's full custody chain. Read-only: there's no notes
 *    prompt for something happening to a card, only for a conversation the student themselves
 *    had, so this carries no exchangeEventId to attach notes to.
 */
export type MyCardEventJson =
    | {
          kind: 'pickup';
          exchangeEventId: number;
          supercardN: number | null;
          cardUniqueId: string | null;
          tradeTime: string;
          /** True iff nobody had ever picked up this exact physical card before this event. */
          isFirstScan: boolean;
          /** True iff this was the first time this student ever got a copy of this card's
           *  design, as opposed to a duplicate copy of one they already have. */
          isNewToCollection: boolean;
          /** Who this card actually came from, ground truth independent of any "who'd you get
           *  this from?" claim (right or wrong) -- see insertExchangeEvent. Null if there was
           *  no previous owner to have come from (a first scan, or a grant from the unclaimed
           *  pool). */
          fromUserName: string | null;
          /** True once this pickup was confirmed as a real two-way trade -- both sides scanned
           *  and correctly said who they got their card from. The user-facing name for what
           *  admin calls a "verified trade". */
          wasTrade: boolean;
          /** If wasTrade, the card given up in return. */
          tradedAwaySupercardN: number | null;
          tradedAwayCardUniqueId: string | null;
          notes: string | null;
      }
    | {
          kind: 'removed';
          cardInstanceId: number;
          supercardN: number;
          cardUniqueId: string;
          removedAt: string;
          /** Who holds it now, or null if it went back to the unclaimed pool (an admin Return)
           *  rather than to another student. */
          takenByName: string | null;
      };
