import { Router } from 'express';
import { requireAdmin } from '../auth/session';
import {
    listUsers,
    findUserById,
    findCardInstance,
    currentOwnerOfCardInstance,
    cardInstancesOwnedBy,
    cardInstancesCollectedBy,
    grantCardInstance,
    NoAvailableCopiesError,
    insertExchangeEvent,
    returnCardInstance,
    revokeCardInstanceFromUser,
    clearCardInstanceHistory,
    clearAllOwnership,
    unassignedUserId,
    markSupercardSeen,
    unmarkSupercardSeen,
    seenSupercardNumbersFor,
    listVerifiedTrades,
    setSetting,
    setColorChallengeCompleted,
    setSubObjectiveCompleted,
    setIsAdmin,
    setHidden,
    deleteUser,
    deleteAllNonAdminUsers,
    listExchangeEvents,
    findExchangeEventById,
    UserRow,
} from '../db';
import { sanitizeUserForAdmin, serializeCardInstance, sanitizeExchangeEvent } from '../serialize';
import { SUPERCARDS, getSupercard } from '../../src/data/supercards';
import { Supercard } from '../../src/card';
import { SETTING_KEYS } from '../../src/settings';
import {
    VALID_COLORS,
    FlagColor,
    AdminUserCardsJson,
    VerifiedTradeJson,
    ExchangeEventJson,
} from '../../src/types';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Parses a route param expected to be a positive integer id; undefined if it isn't one. */
function parseId(raw: string): number | undefined {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** A bulk action's optional `{ color, category }` filter body, validated once and shared by
 *  every bulk-* route below. Neither present means "every supercard". */
interface TypeFilter {
    color?: FlagColor;
    category?: string;
}

/** Validates a bulk action's filter body; undefined means the body was invalid. */
function parseTypeFilter(body: unknown): TypeFilter | undefined {
    const { color, category } = (body ?? {}) as { color?: unknown; category?: unknown };
    if (color !== undefined && !VALID_COLORS.has(color as FlagColor)) return undefined;
    if (category !== undefined && (typeof category !== 'string' || category.length === 0)) return undefined;
    return { color: color as FlagColor | undefined, category: category as string | undefined };
}

function matchingSupercards({ color, category }: TypeFilter): Supercard[] {
    return SUPERCARDS.filter((sc) => {
        if (color && sc.color !== color) return false;
        if (category && !sc.categories.includes(category)) return false;
        return true;
    });
}

adminRouter.get('/users', (_req, res) => {
    res.status(200).json({ users: listUsers().map(sanitizeUserForAdmin) });
});

adminRouter.get('/users/:userId/cards', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const payload: AdminUserCardsJson = {
        cards: cardInstancesCollectedBy(userId).map(serializeCardInstance),
        seen: seenSupercardNumbersFor(userId),
    };
    res.status(200).json(payload);
});

adminRouter.post('/users/:userId/grant-card', (req, res) => {
    const userId = parseId(req.params.userId);
    const { supercardN } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof supercardN !== 'number' || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    try {
        const instance = grantCardInstance(supercardN, userId);
        res.status(201).json({ card: serializeCardInstance(instance) });
    } catch (err) {
        if (err instanceof NoAvailableCopiesError) {
            res.status(400).json({ error: 'No available copies of that card left' });
        } else {
            throw err;
        }
    }
});

adminRouter.post('/card-instances/:cardInstanceId/transfer', (req, res) => {
    const cardInstanceId = parseId(req.params.cardInstanceId);
    const { newOwnerUserId } = req.body ?? {};

    const instance = cardInstanceId !== undefined ? findCardInstance(cardInstanceId) : undefined;
    if (!instance || cardInstanceId === undefined) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }
    if (typeof newOwnerUserId !== 'number' || !findUserById(newOwnerUserId)) {
        res.status(400).json({ error: 'Not a valid target user' });
        return;
    }

    const currentOwner = currentOwnerOfCardInstance(cardInstanceId);
    if (currentOwner === newOwnerUserId) {
        res.status(400).json({ error: 'That user already owns this card' });
        return;
    }

    insertExchangeEvent(cardInstanceId, newOwnerUserId, null, null);
    res.status(200).json({ card: serializeCardInstance(instance) });
});

// Takes a card instance back from whoever currently holds it without erasing its history --
// see returnCardInstance's doc comment. The instance stays visible in the previous holder's
// collected/Pokedex history; it just stops counting as currently owned by them.
adminRouter.post('/card-instances/:cardInstanceId/return', (req, res) => {
    const cardInstanceId = parseId(req.params.cardInstanceId);
    const instance = cardInstanceId !== undefined ? findCardInstance(cardInstanceId) : undefined;
    if (!instance || cardInstanceId === undefined) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }

    const currentOwner = currentOwnerOfCardInstance(cardInstanceId);
    if (currentOwner === unassignedUserId()) {
        res.status(400).json({ error: 'That card is already unassigned' });
        return;
    }

    returnCardInstance(cardInstanceId);
    res.status(200).json({ card: serializeCardInstance(instance) });
});

// Fully erases `userId`'s participation in a card instance's history -- unlike /return, this
// is irreversible and removes it from their collected/Pokedex history entirely, not just
// their current ownership. See revokeCardInstanceFromUser's doc comment.
adminRouter.delete('/users/:userId/card-instances/:cardInstanceId', (req, res) => {
    const userId = parseId(req.params.userId);
    const cardInstanceId = parseId(req.params.cardInstanceId);

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (cardInstanceId === undefined || !findCardInstance(cardInstanceId)) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }

    try {
        revokeCardInstanceFromUser(userId, cardInstanceId);
    } catch (err) {
        // revokeCardInstanceFromUser refuses (rather than corrupting the card's history) when
        // userId isn't at one of the two ends of it -- report that as a normal 409, not a
        // generic 500, since it's an expected, actionable outcome for the admin, not a bug.
        res.status(409).json({ error: err instanceof Error ? err.message : 'Could not revoke this card' });
        return;
    }
    res.status(200).json({ ok: true });
});

// Wipes ONE card instance's entire custody history -- every owner it's ever had, not just one
// user's participation (contrast with DELETE .../card-instances/:id above). See
// clearCardInstanceHistory's doc comment. Irreversible.
adminRouter.post('/card-instances/:cardInstanceId/clear-history', (req, res) => {
    const cardInstanceId = parseId(req.params.cardInstanceId);
    if (cardInstanceId === undefined || !findCardInstance(cardInstanceId)) {
        res.status(404).json({ error: 'No such card instance' });
        return;
    }

    clearCardInstanceHistory(cardInstanceId);
    res.status(200).json({ ok: true });
});

// Wipes EVERY card instance's custody history at once, site-wide. See clearAllOwnership's doc
// comment. Irreversible -- the client is expected to confirm this explicitly before calling it.
adminRouter.post('/card-instances/clear-all-history', (_req, res) => {
    clearAllOwnership();
    res.status(200).json({ ok: true });
});

adminRouter.post('/users/:userId/seen', (req, res) => {
    const userId = parseId(req.params.userId);
    const { supercardN } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof supercardN !== 'number' || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    markSupercardSeen(userId, supercardN);
    res.status(200).json({ supercardN });
});

// Manually marks/unmarks a player as having finished the color challenge -- see
// setColorChallengeCompleted's doc comment. Shown as a badge in the users table and on the
// player's own Collection page.
adminRouter.post('/users/:userId/color-challenge', (req, res) => {
    const userId = parseId(req.params.userId);
    const { value } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setColorChallengeCompleted(userId, value);
    res.status(200).json({ colorChallengeCompleted: value });
});

// Same as /color-challenge, for the sub-objective.
adminRouter.post('/users/:userId/sub-objective', (req, res) => {
    const userId = parseId(req.params.userId);
    const { value } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setSubObjectiveCompleted(userId, value);
    res.status(200).json({ subObjectiveCompleted: value });
});

// Grants or revokes admin privileges for another user -- never the caller's own account. That
// restriction is enforced here, not just as a client-side confirm/disabled-checkbox in
// AdminPage, so it holds even against a direct API call: the real security boundary is this
// route, same as requireAdmin's doc comment says for admin access generally.
adminRouter.post('/users/:userId/admin', (req, res) => {
    const userId = parseId(req.params.userId);
    const { value } = req.body ?? {};
    const currentAdmin = res.locals.user as UserRow;

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }
    if (userId === currentAdmin.id) {
        res.status(400).json({ error: 'You cannot change your own admin status' });
        return;
    }

    setIsAdmin(userId, value);
    // Granting admin also force-hides the account (see setIsAdmin's doc comment) -- return the
    // resulting hidden state alongside isAdmin so the client can sync both checkboxes from this
    // one response instead of refetching the whole users list.
    const updated = findUserById(userId)!;
    res.status(200).json({ isAdmin: value, hidden: updated.hidden === 1 });
});

// Independently shows/hides a user from the trade-attribution guessing pool -- no
// self-restriction, unlike /admin above, since hiding yourself has no security implication.
// See the `hidden` column's schema comment (server/db.ts) for exactly what this affects.
adminRouter.post('/users/:userId/hidden', (req, res) => {
    const userId = parseId(req.params.userId);
    const { value } = req.body ?? {};

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setHidden(userId, value);
    res.status(200).json({ hidden: value });
});

// Permanently deletes a student's account -- their trade history is kept, reassigned to the
// reserved Unassigned account rather than erased (see deleteUser's doc comment). Admins ARE
// deletable through this single-user route, if another admin explicitly does it -- only the
// bulk delete-all-non-admin route below excludes them. Never allows deleting yourself, same
// enforcement layer as /admin's own self-restriction. Irreversible -- the client is expected to
// confirm this explicitly before calling it.
adminRouter.delete('/users/:userId', (req, res) => {
    const userId = parseId(req.params.userId);
    const currentAdmin = res.locals.user as UserRow;

    if (userId === undefined || !findUserById(userId) || userId === unassignedUserId()) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (userId === currentAdmin.id) {
        res.status(400).json({ error: 'You cannot delete your own account' });
        return;
    }

    deleteUser(userId);
    res.status(200).json({ ok: true });
});

// Deletes every non-admin user account, site-wide -- see deleteAllNonAdminUsers's doc comment.
// Irreversible -- the client is expected to confirm this explicitly before calling it.
adminRouter.post('/users/delete-all-non-admin', (_req, res) => {
    const deleted = deleteAllNonAdminUsers();
    res.status(200).json({ deleted });
});

adminRouter.delete('/users/:userId/seen/:supercardN', (req, res) => {
    const userId = parseId(req.params.userId);
    const supercardN = parseId(req.params.supercardN);

    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    if (supercardN === undefined || !getSupercard(supercardN)) {
        res.status(400).json({ error: 'Not a valid card number' });
        return;
    }

    unmarkSupercardSeen(userId, supercardN);
    res.status(200).json({ supercardN });
});

// Grants one available instance of every supercard matching the filter (or all 72, if no
// filter is given) to the target user. Looped rather than wrapped in one big transaction --
// grantCardInstance already commits each grant on its own, and SQLite doesn't support nested
// transactions, so a mid-loop failure just leaves a partial (still individually-consistent)
// bulk grant rather than rolling back everything. Unlike the old on-scan-manufacture model,
// the pool is finite -- a supercard with no copies left is silently skipped (not counted in
// `granted`) rather than failing the whole batch, since "grant everything you can" is the
// more useful behavior for this admin bulk action.
adminRouter.post('/users/:userId/bulk-grant', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targets = matchingSupercards(filter);
    let granted = 0;
    for (const supercard of targets) {
        try {
            grantCardInstance(supercard.n, userId);
            granted++;
        } catch (err) {
            if (!(err instanceof NoAvailableCopiesError)) throw err;
        }
    }
    res.status(200).json({ granted });
});

// Returns (see /return above) every instance of a matching supercard the target user
// currently owns -- their historical/collected record is untouched.
adminRouter.post('/users/:userId/bulk-return', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targetNs = new Set(matchingSupercards(filter).map((sc) => sc.n));
    const instances = cardInstancesOwnedBy(userId).filter((inst) => targetNs.has(inst.supercard_n));
    for (const instance of instances) returnCardInstance(instance.id);
    res.status(200).json({ returned: instances.length });
});

// Fully revokes (see DELETE .../card-instances/:id above) every matching-supercard instance
// the target user has ever held, current or past -- irreversible.
adminRouter.post('/users/:userId/bulk-revoke', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targetNs = new Set(matchingSupercards(filter).map((sc) => sc.n));
    const instances = cardInstancesCollectedBy(userId).filter((inst) => targetNs.has(inst.supercard_n));
    // Each instance is its own transaction (see revokeCardInstanceFromUser), so a refusal
    // partway through doesn't undo the ones already revoked -- report how many made it through
    // alongside why the rest didn't, rather than a bare 500 with no explanation.
    let revoked = 0;
    try {
        for (const instance of instances) {
            revokeCardInstanceFromUser(userId, instance.id);
            revoked++;
        }
    } catch (err) {
        const reason = err instanceof Error ? err.message : 'Could not revoke this card';
        const progress = revoked > 0 ? ` (${revoked} of ${instances.length} were revoked before this happened.)` : '';
        res.status(409).json({ error: reason + progress });
        return;
    }
    res.status(200).json({ revoked: instances.length });
});

// Marks every matching supercard as "seen" for the target user -- independent of their
// collected/owned history, this only affects the greyscale "seen but not collected" state.
adminRouter.post('/users/:userId/bulk-see', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targets = matchingSupercards(filter);
    for (const supercard of targets) markSupercardSeen(userId, supercard.n);
    res.status(200).json({ seen: targets.length });
});

// Unmarks every matching supercard as "seen" for the target user -- independent of their
// collected/owned history, this only affects the greyscale "seen but not collected" state.
adminRouter.post('/users/:userId/bulk-unsee', (req, res) => {
    const userId = parseId(req.params.userId);
    if (userId === undefined || !findUserById(userId)) {
        res.status(404).json({ error: 'No such user' });
        return;
    }
    const filter = parseTypeFilter(req.body);
    if (!filter) {
        res.status(400).json({ error: 'Not a valid filter' });
        return;
    }

    const targets = matchingSupercards(filter);
    for (const supercard of targets) unmarkSupercardSeen(userId, supercard.n);
    res.status(200).json({ unseen: targets.length });
});

// Read-only listing of every verified two-way trade the system has detected (see
// server/db.ts's tryFormVerifiedTrade) -- mainly so the new verified_trades table is actually
// inspectable rather than write-only. Each side's own conversation-notes research answer (see
// exchange_events' schema comment) is looked up via its own exchange event id, so clicking a
// trade in the admin UI can show both without a second round-trip.
adminRouter.get('/verified-trades', (_req, res) => {
    // Username isn't one of verified_trades' own denormalized columns (it has name/email, per
    // the research-readable spec those came from) -- a quick id lookup here is simpler than
    // adding a fourth per-side column just for this one admin-table display.
    const trades: VerifiedTradeJson[] = listVerifiedTrades().map((t) => ({
        tradeId: t.trade_id,
        userOne: {
            id: t.user_one_id,
            username: findUserById(t.user_one_id)?.username ?? '',
            name: t.user_one_name,
        },
        cardGivenByUserOneUniqueId: t.card_given_by_user_one_unique_id,
        userOneTradeTime: t.user_one_trade_time,
        userOneConversationNotes: findExchangeEventById(t.exchange_event_one_id)?.conversation_notes ?? null,
        userTwo: {
            id: t.user_two_id,
            username: findUserById(t.user_two_id)?.username ?? '',
            name: t.user_two_name,
        },
        cardGivenByUserTwoUniqueId: t.card_given_by_user_two_unique_id,
        userTwoTradeTime: t.user_two_trade_time,
        userTwoConversationNotes: findExchangeEventById(t.exchange_event_two_id)?.conversation_notes ?? null,
    }));
    res.status(200).json({ trades });
});

// Read-only listing of every card-obtained event, not just verified trades -- see
// listExchangeEvents's doc comment.
adminRouter.get('/exchange-events', (_req, res) => {
    const events: ExchangeEventJson[] = listExchangeEvents().map(sanitizeExchangeEvent);
    res.status(200).json({ events });
});

adminRouter.post('/settings/collection-requires-login', (req, res) => {
    const { value } = req.body ?? {};
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setSetting(SETTING_KEYS.COLLECTION_REQUIRES_LOGIN, value ? 'true' : 'false');
    res.status(200).json({ collectionRequiresLogin: value });
});

// Pre-launch lockdown -- see PublicSettingsJson.siteLockedDown's doc comment for what this
// actually gates (client-side routing, not an API lockdown).
adminRouter.post('/settings/site-locked-down', (req, res) => {
    const { value } = req.body ?? {};
    if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'value must be a boolean' });
        return;
    }

    setSetting(SETTING_KEYS.SITE_LOCKED_DOWN, value ? 'true' : 'false');
    res.status(200).json({ siteLockedDown: value });
});
