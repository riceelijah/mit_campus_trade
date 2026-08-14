import { useParams, Link } from 'react-router-dom';
import { getSupercard } from '../data/supercards';
import { useOwnedCardFor } from '../data/ownership';
import FlippableCard from '../components/FlippableCard';
import CustodyChain from '../components/CustodyChain';

export default function CardDetailPage() {
    const { n } = useParams<{ n: string }>();
    const supercard = getSupercard(Number(n));
    // Called unconditionally, before the early return below, per the Rules of Hooks --
    // Number(n) is always defined even when it doesn't match a real card.
    const ownedCard = useOwnedCardFor(Number(n));

    if (!supercard) {
        return (
            <div>
                <h1>Card not found</h1>
                <p><Link to="/collection">Back to your collection</Link></p>
            </div>
        );
    }

    // The spreadsheet's Website link column points at the not-yet-live mitcampustrade.com --
    // swapped to localhost:5173 (this app's own dev origin) so the printed/QR link on each
    // card is actually followable while the real domain isn't up.
    const localWebsiteLink = supercard.websiteLink.replace(/^mitcampustrade\.com/i, 'localhost:5173');

    return (
        <div className="card-detail">
            <div>
                <FlippableCard supercard={supercard} />
                <p className="flip-card__hint">Click the card to flip it over</p>
            </div>

            <div>
                <h1>{supercard.title}</h1>
                <p className="card-detail__quote">{supercard.shortQuote}</p>

                <div className="chip-row">
                    {supercard.categories.map(category => (
                        <span className="chip" key={category}>{category}</span>
                    ))}
                    <span className="chip">{supercard.color}</span>
                    <span className="chip">Cost {supercard.cost}</span>
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

                <div className="card-detail__section">
                    <h3>Source</h3>
                    <p>
                        <a href={supercard.link} target="_blank" rel="noreferrer">View highlight</a>
                        {' '}&middot; {supercard.highlightDate}
                        {' '}&middot; #{supercard.highlightId}
                    </p>
                    {supercard.artist && <p>Art by {supercard.artist}</p>}
                </div>

                <div className="card-detail__section">
                    <h3>This card's page</h3>
                    <p>
                        <a href={`http://${localWebsiteLink}`} target="_blank" rel="noreferrer">
                            {localWebsiteLink}
                        </a>
                    </p>
                </div>

                <div className="card-detail__section">
                    <h3>Your Card's History</h3>
                    {ownedCard
                        ? <CustodyChain custody={ownedCard.custody} />
                        : <p className="not-owned-note">You don't own this card yet.</p>}
                </div>
            </div>
        </div>
    );
}
