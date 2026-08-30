import { useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MyCardEventJson } from '../types';
import { extractError } from '../lib/api';
import { formatEasternDateTime } from '../lib/format';
import { getSupercard } from '../data/supercards';

/** A card's display title, its "(dex number-printed code)" id (e.g. "02-PSKM" -- same
 *  dex-number-then-id convention as the admin page's instance chips, see AdminPage), link
 *  target, and team color, bundled together since every entry needs all four -- falls back
 *  gracefully in case the content sheet and a very old event ever disagree (supercardN
 *  unresolved, or absent on a synthetic 'removed' entry's sibling lookup). `color` drives each
 *  entry's timeline dot -- see MyNotesPage's own doc comment. */
function cardInfo(
    supercardN: number | null,
    uniqueId: string | null,
): { title: string; id: string | null; href: string | undefined; color: string | undefined } {
    const supercard = supercardN !== null ? getSupercard(supercardN) : undefined;
    return {
        title: supercard?.title ?? 'a card',
        id: supercardN !== null && uniqueId ? `${String(supercardN).padStart(2, '0')}-${uniqueId}` : null,
        href: supercard ? `/cards/${supercard.highlightId}` : undefined,
        color: supercard?.color,
    };
}

/** A card's title plus its smaller, de-emphasized "(dex number-id)" parenthetical -- shared by
 *  every spot a card gets named (an entry's own header, or the card named in its trade
 *  context), so the two-sizes-in-one-name look stays consistent across both. */
function CardLabel({ title, id }: { title: string; id: string | null }) {
    return (
        <>
            {title}
            {id && <span className="my-notes-entry__id"> ({id})</span>}
        </>
    );
}

// white and silver both sit too close to the page's own off-white background (see index.css's
// body background) for the default subtle border to read as a ring at all -- these two need a
// visibly darker one so the dot doesn't just disappear. Every other color has enough of its own
// contrast that the default border is all it needs.
const LOW_CONTRAST_DOT_COLORS = new Set(['white', 'silver']);

/** Inline style for one entry's timeline dot -- see cardInfo and .my-notes-entry__dot. */
function dotStyle(color: string | undefined): { backgroundColor?: string; borderColor?: string } {
    return {
        backgroundColor: color,
        borderColor: color && LOW_CONTRAST_DOT_COLORS.has(color) ? 'rgba(0, 0, 0, 0.45)' : undefined,
    };
}

/**
 * A student-facing history of every card they've picked up (plus whatever notes they left
 * about the conversation -- see PromptBanner's "Trade Notes" prompt) and every point where a
 * card they held moved on to someone else, and lets them go back and edit their own notes
 * later. Deliberately avoids the admin page's internal vocabulary ("verified trade", "exchange
 * event") in favor of plain language; see GET /api/me/card-events and buildMyCardEventsFeed for
 * the server side of this.
 */
export default function MyNotesPage() {
    const { user, loading: authLoading } = useAuth();

    const [events, setEvents] = useState<MyCardEventJson[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Which pickup's notes are currently being edited, if any (keyed by exchangeEventId) --
    // at most one at a time, same click-to-toggle idea as the admin page's expandable rows.
    // Removed entries are never editable -- there's no notes prompt for something happening to
    // a card, only for a conversation the student themselves had.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        (async () => {
            const res = await fetch('/api/me/card-events', { credentials: 'include' });
            if (cancelled) return;
            if (!res.ok) {
                setLoadError(await extractError(res));
                return;
            }
            const body = (await res.json()) as { events: MyCardEventJson[] };
            setEvents(body.events);
        })();
        return () => {
            cancelled = true;
        };
    }, [user]);

    if (authLoading) {
        return null;
    }
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    function startEdit(exchangeEventId: number, currentNotes: string | null) {
        setEditingId(exchangeEventId);
        setDraft(currentNotes ?? '');
        setSaveError(null);
    }

    function cancelEdit() {
        setEditingId(null);
        setSaveError(null);
    }

    async function saveEdit(exchangeEventId: number) {
        if (draft.trim().length === 0) {
            setSaveError("Notes can't be empty.");
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const res = await fetch(`/api/me/exchange-events/${exchangeEventId}/conversation-notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ notes: draft }),
            });
            if (!res.ok) {
                setSaveError(await extractError(res));
                return;
            }
            // Mirrors the server's own trim/length clamp (see setExchangeEventConversationNotes'
            // caller in server/routes/me.ts) so what's shown here matches what actually got saved.
            const savedNotes = draft.trim().slice(0, 1000);
            setEvents(
                (prev) =>
                    prev?.map((e) =>
                        e.kind === 'pickup' && e.exchangeEventId === exchangeEventId
                            ? { ...e, notes: savedNotes }
                            : e,
                    ) ?? prev,
            );
            setEditingId(null);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <h1>My Notes</h1>
            <p className="my-notes-intro">
                Every card you&rsquo;ve picked up, and any notes you left about the conversation. You can
                come back and edit a note any time.
            </p>

            {loadError && <p className="form-error">{loadError}</p>}

            {events && events.length === 0 && (
                <p className="my-notes-empty">You haven&rsquo;t picked up any cards yet.</p>
            )}

            {events && events.length > 0 && (
                <ol className="my-notes-list">
                    {events.map((event) => {
                        if (event.kind === 'removed') {
                            const card = cardInfo(event.supercardN, event.cardUniqueId);
                            return (
                                <li
                                    className="my-notes-entry my-notes-entry--removed"
                                    key={`removed-${event.cardInstanceId}-${event.removedAt}`}
                                >
                                    <span className="my-notes-entry__dot" style={dotStyle(card.color)} />
                                    <div className="my-notes-entry__header">
                                        {card.href ? (
                                            <Link to={card.href} className="my-notes-entry__title">
                                                <CardLabel title={card.title} id={card.id} />
                                            </Link>
                                        ) : (
                                            <span className="my-notes-entry__title">
                                                <CardLabel title={card.title} id={card.id} />
                                            </span>
                                        )}
                                        <span className="my-notes-entry__when">
                                            {formatEasternDateTime(event.removedAt)}
                                        </span>
                                    </div>
                                    <p className="my-notes-entry__removed-note">
                                        This card left your collection
                                        {event.takenByName ? ` — now with ${event.takenByName}.` : '.'}
                                    </p>
                                </li>
                            );
                        }

                        const editing = editingId === event.exchangeEventId;
                        const card = cardInfo(event.supercardN, event.cardUniqueId);
                        const tradedAway = event.wasTrade
                            ? cardInfo(event.tradedAwaySupercardN, event.tradedAwayCardUniqueId)
                            : null;

                        return (
                            <li className="my-notes-entry" key={event.exchangeEventId}>
                                <span className="my-notes-entry__dot" style={dotStyle(card.color)} />
                                <div className="my-notes-entry__header">
                                    {card.href ? (
                                        <Link to={card.href} className="my-notes-entry__title">
                                            <CardLabel title={card.title} id={card.id} />
                                        </Link>
                                    ) : (
                                        <span className="my-notes-entry__title">
                                            <CardLabel title={card.title} id={card.id} />
                                        </span>
                                    )}
                                    <span className="my-notes-entry__when">
                                        {formatEasternDateTime(event.tradeTime)}
                                    </span>
                                    {event.isFirstScan && <span className="chip">🆕 First scan</span>}
                                    {event.isNewToCollection && <span className="chip">✨ New to your collection</span>}
                                    {/* Naming the partner right in the trade chip (rather than a separate "From
                                        X" line) is what makes this read as one bundled trade story, not two
                                        loosely-related facts -- see removalEventsForUser's own doc comment for
                                        the other half of this (suppressing the redundant separate "card left
                                        your collection" entry for the same trade). */}
                                    {event.wasTrade && (
                                        <span className="chip">🤝 Traded with {event.fromUserName}</span>
                                    )}
                                </div>

                                {event.wasTrade && tradedAway ? (
                                    <p className="my-notes-entry__context">
                                        Gave up <CardLabel title={tradedAway.title} id={tradedAway.id} /> for it.
                                    </p>
                                ) : (
                                    event.fromUserName && (
                                        <p className="my-notes-entry__context">From {event.fromUserName}.</p>
                                    )
                                )}

                                <div className="my-notes-entry__notes">
                                    {editing ? (
                                        <div className="my-notes-entry__edit-form">
                                            <textarea
                                                className="my-notes-entry__textarea"
                                                value={draft}
                                                onChange={(e) => setDraft(e.target.value)}
                                                placeholder="What do you want to remember about this conversation?"
                                                rows={3}
                                                maxLength={1000}
                                                disabled={saving}
                                            />
                                            {saveError && <p className="form-error">{saveError}</p>}
                                            <div className="my-notes-entry__edit-actions">
                                                <button
                                                    type="button"
                                                    className="my-notes-entry__save"
                                                    disabled={saving || draft.trim().length === 0}
                                                    onClick={() => saveEdit(event.exchangeEventId)}
                                                >
                                                    {saving ? 'Saving…' : 'Save'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="my-notes-entry__cancel"
                                                    disabled={saving}
                                                    onClick={cancelEdit}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            {event.notes ? (
                                                <p>{event.notes}</p>
                                            ) : (
                                                <p className="my-notes-entry__notes--empty">No notes yet.</p>
                                            )}
                                            <button
                                                type="button"
                                                className="my-notes-entry__edit-button"
                                                onClick={() => startEdit(event.exchangeEventId, event.notes)}
                                            >
                                                {event.notes ? 'Edit notes' : 'Add notes'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
