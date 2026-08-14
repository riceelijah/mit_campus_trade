import { Supercard } from '../card';
import CardThumbnail from './CardThumbnail';

interface CardGridProps {
    cards: Supercard[];
    /** Given a card, is it owned (full color) or not (greyscale)? */
    isOwned: (supercard: Supercard) => boolean;
}

/** A wrapping grid of cards, colored or greyscaled per-card by the caller. */
export default function CardGrid({ cards, isOwned }: CardGridProps) {
    return (
        <div className="card-grid">
            {cards.map((supercard) => (
                <CardThumbnail key={supercard.n} supercard={supercard} greyscale={!isOwned(supercard)} />
            ))}
        </div>
    );
}
