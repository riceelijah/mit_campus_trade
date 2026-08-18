import { Supercard } from '../card';
import { CardVisibility } from '../data/ownership';
import CardThumbnail from './CardThumbnail';

interface CardGridProps {
    cards: Supercard[];
    /** Given a card, how should it render for the current viewer? See CardVisibility. */
    getVisibility: (supercard: Supercard) => CardVisibility;
}

/** A wrapping grid of cards, rendered per-card per the caller's visibility classifier. */
export default function CardGrid({ cards, getVisibility }: CardGridProps) {
    return (
        <div className="card-grid">
            {cards.map((supercard) => (
                <CardThumbnail
                    key={supercard.n}
                    supercard={supercard}
                    visibility={getVisibility(supercard)}
                />
            ))}
        </div>
    );
}
