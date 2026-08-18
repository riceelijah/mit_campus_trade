import { Supercard } from '../card';
import CardThumbnail from './CardThumbnail';

interface CardGridProps {
    cards: Supercard[];
    /** Given a card, has the viewer collected it (full color) or not (greyscale)? */
    isCollected: (supercard: Supercard) => boolean;
}

/** A wrapping grid of cards, colored or greyscaled per-card by the caller. */
export default function CardGrid({ cards, isCollected }: CardGridProps) {
    return (
        <div className="card-grid">
            {cards.map((supercard) => (
                <CardThumbnail key={supercard.n} supercard={supercard} greyscale={!isCollected(supercard)} />
            ))}
        </div>
    );
}
