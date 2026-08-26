import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { getSupercardByHighlightId } from '../data/supercards';
import { useAuth } from '../auth/AuthContext';
import { useCollectedCardFor } from '../data/ownership';
import { capitalize } from '../lib/format';
import { PendingResearchPrompt } from '../types';
import FlippableCard from '../components/FlippableCard';
import CustodyChain from '../components/CustodyChain';
import Toast from '../components/Toast';
import PromptBanner from '../components/PromptBanner';

export default function CardDetailPage() {
    const { highlightId } = useParams<{ highlightId: string }>();
    const supercard = highlightId ? getSupercardByHighlightId(highlightId) : undefined;
    // `?instance=` picks out one specific collected copy (see the Hand view's per-copy tiles
    // in CollectionPage) -- falls back to the first collected copy when absent or unmatched.
    const [searchParams] = useSearchParams();
    const instanceId = searchParams.get('instance') ?? undefined;
    // Called unconditionally, before the early return below, per the Rules of Hooks -- -1 is
    // a sentinel dex number no real Supercard has, so an unmatched route safely resolves to
    // "not collected" instead of skipping the hook.
    const collectedCard = useCollectedCardFor(supercard?.n ?? -1, instanceId);
    // Only used to note which copy is shown below when the viewer has more than one -- see
    // the Hand view's per-copy tiles in CollectionPage.
    const { user } = useAuth();
    const collectedCopyCount = user?.collected.filter((card) => card.n === supercard?.n).length ?? 0;

    // The QR scanner's "Just looking" option navigates straight here and hands off its
    // confirmation message via router state, rather than showing it inside the scanner modal.
    // Consumed once (guarded by the ref) and stripped from history so a refresh or back-nav
    // doesn't re-show it. A successful collect (see CollectFlow.finish) may also hand off an
    // optional-to-answer research prompt (PromptBanner) the same way.
    const location = useLocation();
    const navigate = useNavigate();
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [prompt, setPrompt] = useState<PendingResearchPrompt | null>(null);
    const consumedToast = useRef(false);
    useEffect(() => {
        const state = location.state as { toast?: string; prompt?: PendingResearchPrompt } | null;
        if (!consumedToast.current && (state?.toast || state?.prompt)) {
            consumedToast.current = true;
            if (state.toast) setToastMessage(state.toast);
            if (state.prompt) setPrompt(state.prompt);
            navigate(location.pathname, { replace: true, state: null });
        }
    }, [location, navigate]);

    if (!supercard) {
        return (
            <div>
                <h1>Card not found</h1>
                <p>
                    <Link to="/collection">Back to your collection</Link>
                </p>
                {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
            </div>
        );
    }

    return (
        <div className="card-detail">
            {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
            {prompt && <PromptBanner prompt={prompt} onDone={() => setPrompt(null)} />}

            <div className="card-detail__hero">
                <FlippableCard supercard={supercard} />
                <p className="flip-card__hint">Click the card to flip it over</p>
            </div>

            <div>
                <h1>{supercard.title}</h1>
                {supercard.artist && <p className="card-detail__attribution">Art by {supercard.artist}</p>}
                <p className="card-detail__quote">{supercard.shortQuote}</p>

                <div className="chip-row">
                    {supercard.categories.map((category) => (
                        <Link
                            className="chip chip--clickable"
                            to={`/collection?category=${encodeURIComponent(category)}`}
                            key={category}
                            title={`See every ${category} card`}
                        >
                            {category}
                        </Link>
                    ))}
                    <Link
                        className="chip chip--clickable"
                        to={`/collection?color=${encodeURIComponent(supercard.color)}`}
                        title={`See every ${capitalize(supercard.color)} card`}
                    >
                        {capitalize(supercard.color)}
                    </Link>
                    <Link
                        className="chip chip--clickable"
                        to={`/collection?cost=${supercard.cost}`}
                        title={`See every cost ${supercard.cost} card`}
                    >
                        Cost {supercard.cost}
                    </Link>
                </div>

                <div className="card-detail__section">
                    <h3>Source</h3>
                    <iframe
                        className="cortico-embed"
                        src={`https://embed.cortico.ai/?hid=${supercard.highlightId}`}
                        scrolling="no"
                        title={`${supercard.descriptionAttribution}'s interview highlight`}
                    />
                    <p>
                        {supercard.highlightDate} &middot; #{supercard.highlightId}
                    </p>
                </div>

                <div className="card-detail__section">
                    <h3>Description</h3>
                    <p>{supercard.description}</p>
                    <p>
                        &mdash; {supercard.descriptionAttribution}, {supercard.speakerDetails}
                    </p>
                </div>

                <div className="card-detail__section">
                    <h3>Exchange Question</h3>
                    <p>{supercard.question}</p>
                </div>

                {/* "This card's page" section (mitcampustrade.com link) is temporarily hidden --
                    the site it points to isn't live yet and the link is currently broken.
                    Re-enable once mitcampustrade.com is up. */}

                <div className="card-detail__section">
                    <h3>Your Card's History</h3>
                    {collectedCard ? (
                        <>
                            {collectedCopyCount > 1 && (
                                <p className="not-owned-note">
                                    Showing history for copy {collectedCard.uniqueId} (you have{' '}
                                    {collectedCopyCount} copies of this card).
                                </p>
                            )}
                            <CustodyChain custody={collectedCard.custody} />
                        </>
                    ) : (
                        <p className="not-owned-note">You haven't collected this card yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
