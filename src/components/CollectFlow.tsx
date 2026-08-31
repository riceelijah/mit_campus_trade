import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Supercard } from '../card';
import { useAuth } from '../auth/AuthContext';
import { useCollectedSupercardNumbers } from '../data/ownership';
import { extractError } from '../lib/api';
import { CollectCandidatesJson, CollectResponseJson, PendingResearchPrompt, PublicUserJson } from '../types';
import CardArt from './CardArt';
import TradeAttributionModal from './TradeAttributionModal';

type FlowState =
    | { status: 'loading' }
    | { status: 'not-logged-in' }
    | { status: 'not-found' }
    | { status: 'load-error'; message: string }
    // `candidates` is empty when there's nothing to ask about (no previous owner, or the
    // viewer already owns this instance) -- see collect-candidates' doc comment. Never shown
    // anywhere in this component; it only ever gets threaded through to the /api/me/collect
    // call and back into 'action-error' so a retry can return to the same popup contents
    // without an extra round-trip.
    | { status: 'choose-action'; candidates: PublicUserJson[] }
    | { status: 'attribution'; candidates: PublicUserJson[] }
    | { status: 'collecting' }
    | { status: 'marking-seen' }
    | { status: 'action-error'; message: string; candidates: PublicUserJson[] };

interface CollectFlowProps {
    supercard: Supercard;
    uniqueId: string;
    /** Called right before navigating away once the flow concludes (collected or marked seen)
     *  -- e.g. so a hosting modal can close itself first. */
    onDone?: () => void;
}

/**
 * Drives collecting one specific card instance (identified by `uniqueId`), from "choose
 * action" through the trade-attribution popup (only shown if the instance has a previous
 * owner) to success -- shared by QrScannerModal (scanning a specific-copy QR) and
 * CardInstancePage (visiting a specific-copy URL directly), so neither has to duplicate this
 * state machine. Always ends by navigating to the card's general `/cards/:highlightId` page.
 */
export default function CollectFlow({ supercard, uniqueId, onDone }: CollectFlowProps) {
    const { user, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [state, setState] = useState<FlowState>({ status: 'loading' });
    // Distinct physical copies of the same design are a normal part of trading (that's the
    // whole point of unique_id), so this is just an informational note on the button, not a
    // blocking confirm-step like the old duplicate-confirm flow -- there's nothing to warn
    // against here that collecting itself doesn't already make obvious.
    const alreadyHasDesign = useCollectedSupercardNumbers().has(supercard.n);

    const loadCandidates = useCallback(async () => {
        if (!user) {
            setState({ status: 'not-logged-in' });
            return;
        }
        setState({ status: 'loading' });
        try {
            const res = await fetch(`/api/cards/${uniqueId}/collect-candidates`, { credentials: 'include' });
            if (res.status === 404) {
                setState({ status: 'not-found' });
                return;
            }
            if (!res.ok) throw new Error(await extractError(res));
            const body: CollectCandidatesJson = await res.json();
            setState({ status: 'choose-action', candidates: body.candidates });
        } catch (err) {
            setState({
                status: 'load-error',
                message: err instanceof Error ? err.message : 'Something went wrong',
            });
        }
    }, [uniqueId, user]);

    useEffect(() => {
        loadCandidates();
    }, [loadCandidates]);

    const finish = useCallback(
        (toast: string, prompt?: PendingResearchPrompt) => {
            onDone?.();
            navigate(`/cards/${supercard.highlightId}`, { state: { toast, prompt } });
        },
        [onDone, navigate, supercard.highlightId],
    );

    const collect = useCallback(
        async (claimedFromUserId: number | null, candidates: PublicUserJson[]) => {
            setState({ status: 'collecting' });
            try {
                const res = await fetch('/api/me/collect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ uniqueId, claimedFromUserId }),
                });
                if (!res.ok) throw new Error(await extractError(res));
                const body: CollectResponseJson = await res.json();
                await refreshUser();
                // The two research prompts are mutually exclusive -- a first-ever scan never
                // has a previous owner to claim, so the attribution popup never happens on that
                // same event. See PendingResearchPrompt's doc comment. Bug fix: this used to
                // additionally require claimedFromUserId !== null before showing the
                // trade-conversation prompt, which meant picking "Unknown / Other" in the
                // attribution popup (still a real previous-owner card, just an unidentified
                // claim) silently skipped the notes prompt entirely -- the actual attribution
                // guess and whether there's a conversation worth remembering are unrelated, so
                // !firstEverScan alone is the right condition here.
                const prompt: PendingResearchPrompt | undefined = body.firstEverScan
                    ? { type: 'received-from-other', exchangeEventId: body.exchangeEventId }
                    : { type: 'trade-conversation', exchangeEventId: body.exchangeEventId };
                finish(`Added "${supercard.title}" to your collection.`, prompt);
            } catch (err) {
                setState({
                    status: 'action-error',
                    message: err instanceof Error ? err.message : 'Something went wrong',
                    candidates,
                });
            }
        },
        [uniqueId, refreshUser, finish, supercard.title],
    );

    const markSeen = useCallback(async () => {
        setState({ status: 'marking-seen' });
        try {
            const res = await fetch('/api/me/seen', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ highlightId: supercard.highlightId }),
            });
            if (!res.ok) throw new Error(await extractError(res));
            await refreshUser();
            finish(
                `Marked "${supercard.title}" as seen. It'll show greyed out in your collection until you register a copy.`,
            );
        } catch (err) {
            setState({
                status: 'action-error',
                message: err instanceof Error ? err.message : 'Something went wrong',
                candidates: [],
            });
        }
    }, [supercard.highlightId, supercard.title, refreshUser, finish]);

    switch (state.status) {
        case 'loading':
            return <p className="qr-modal__message">Loading&hellip;</p>;

        case 'not-logged-in':
            return (
                <div className="qr-modal__message">
                    <div className="qr-modal__art">
                        <CardArt supercard={supercard} />
                    </div>
                    <p>
                        Log in or register to add &ldquo;{supercard.title}&rdquo; to your collection, or just
                        take a look without saving it.
                    </p>
                    <p>
                        <Link to="/login">Log in</Link>
                        {' · '}
                        <Link to="/register">Register</Link>
                    </p>
                    <button
                        type="button"
                        onClick={() =>
                            finish(
                                `Just a peek — log in or register to add "${supercard.title}" to your collection.`,
                            )
                        }
                    >
                        Just looking
                    </button>
                </div>
            );

        case 'not-found':
            return (
                <div className="qr-modal__message">
                    <p>That doesn&rsquo;t look like a valid card code.</p>
                </div>
            );

        case 'load-error':
            return (
                <div className="qr-modal__message">
                    <p>{state.message}</p>
                    <button type="button" onClick={loadCandidates}>
                        Try again
                    </button>
                </div>
            );

        case 'choose-action':
            return (
                <div className="qr-modal__message">
                    <div className="qr-modal__art">
                        <CardArt supercard={supercard} />
                    </div>
                    <p>You got &ldquo;{supercard.title}&rdquo;!</p>
                    {alreadyHasDesign && (
                        <p className="not-owned-note">
                            You already have a copy of this card &mdash; this adds another.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={() =>
                            state.candidates.length > 0
                                ? setState({ status: 'attribution', candidates: state.candidates })
                                : collect(null, state.candidates)
                        }
                    >
                        Add to my collection
                    </button>
                    <button type="button" onClick={markSeen}>
                        Just looking
                    </button>
                </div>
            );

        case 'attribution':
            return (
                <TradeAttributionModal
                    candidates={state.candidates}
                    onChoose={(userId) => collect(userId, state.candidates)}
                />
            );

        case 'collecting':
            return <p className="qr-modal__message">Adding to your collection&hellip;</p>;

        case 'marking-seen':
            return <p className="qr-modal__message">Marking as seen&hellip;</p>;

        case 'action-error':
            return (
                <div className="qr-modal__message">
                    <p>{state.message}</p>
                    <button
                        type="button"
                        onClick={() => setState({ status: 'choose-action', candidates: state.candidates })}
                    >
                        Back
                    </button>
                </div>
            );
    }
}
