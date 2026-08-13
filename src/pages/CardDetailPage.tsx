import { useParams, Link } from 'react-router-dom';
import { getSupercard } from '../data/supercards';
import { getOwnedCardFor } from '../data/ownership';
import CardArt from '../components/CardArt';
import CustodyChain from '../components/CustodyChain';

export default function CardDetailPage() {
    const { n } = useParams<{ n: string }>();
    const supercard = getSupercard(Number(n));

    if (!supercard) {
        return (
            <div>
                <h1>Card not found</h1>
                <p><Link to="/collection">Back to your collection</Link></p>
            </div>
        );
    }

    const ownedCard = getOwnedCardFor(supercard.n);

    return (
        <div className="card-detail">
            <div>
                <CardArt supercard={supercard} />
            </div>

            <div>
                <h1>{supercard.title}</h1>
                <p className="card-detail__quote">{supercard.shortQuote}</p>

                <div className="chip-row">
                    {supercard.categories.map(category => (
                        <span className="chip" key={category}>{category}</span>
                    ))}
                    <span className="chip">{supercard.color}</span>
                    <span className="chip">{supercard.frameType}</span>
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
                    </p>
                    {supercard.artist && <p>Art by {supercard.artist}</p>}
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
