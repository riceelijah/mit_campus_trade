import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { getSupercardByHighlightId } from '../data/supercards';
import { useCollectedCardFor } from '../data/ownership';
import FlippableCard from '../components/FlippableCard';
import CustodyChain from '../components/CustodyChain';
import Toast from '../components/Toast';

export default function CardDetailPage() {
    const { highlightId } = useParams<{ highlightId: string }>();
    const supercard = highlightId ? getSupercardByHighlightId(highlightId) : undefined;
    // Called unconditionally, before the early return below, per the Rules of Hooks -- -1 is
    // a sentinel dex number no real Supercard has, so an unmatched route safely resolves to
    // "not collected" instead of skipping the hook.
    const collectedCard = useCollectedCardFor(supercard?.n ?? -1);

    // The QR scanner's "Just looking" option navigates straight here and hands off its
    // confirmation message via router state, rather than showing it inside the scanner modal.
    // Consumed once (guarded by the ref) and stripped from history so a refresh or back-nav
    // doesn't re-show it.
    const location = useLocation();
    const navigate = useNavigate();
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const consumedToast = useRef(false);
    useEffect(() => {
        const state = location.state as { toast?: string } | null;
        if (!consumedToast.current && state?.toast) {
            consumedToast.current = true;
            setToastMessage(state.toast);
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

            <div>
                <FlippableCard supercard={supercard} />
                <p className="flip-card__hint">Click the card to flip it over</p>
            </div>

            <div>
                <h1>{supercard.title}</h1>
                {supercard.artist && <p className="card-detail__attribution">Art by {supercard.artist}</p>}
                <p className="card-detail__quote">{supercard.shortQuote}</p>

                <div className="chip-row">
                    {supercard.categories.map((category) => (
                        <span className="chip" key={category}>
                            {category}
                        </span>
                    ))}
                    <span className="chip">{supercard.color}</span>
                    <span className="chip">Cost {supercard.cost}</span>
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
                        <CustodyChain custody={collectedCard.custody} />
                    ) : (
                        <p className="not-owned-note">You haven't collected this card yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
