import { Supercard } from '../card';
import { CardVisibility } from '../data/ownership';
import CardThumbnail from './CardThumbnail';

/** One tile to render -- usually one per Supercard design, but the Hand view (see
 *  CollectionPage) passes one entry per owned *copy*, each carrying that copy's own
 *  uniqueId, so duplicate copies of the same design render (and link) separately. */
export interface CardGridEntry {
    supercard: Supercard;
    uniqueId?: string;
}

interface CardGridProps {
    entries: CardGridEntry[];
    /** Given a card, how should it render for the current viewer? See CardVisibility. */
    getVisibility: (supercard: Supercard) => CardVisibility;
}

/** A wrapping grid of cards, rendered per-entry per the caller's visibility classifier. */
export default function CardGrid({ entries, getVisibility }: CardGridProps) {
    return (
        <div className="card-grid">
            {entries.map(({ supercard, uniqueId }) => (
                <CardThumbnail
                    key={uniqueId ?? supercard.n}
                    supercard={supercard}
                    uniqueId={uniqueId}
                    visibility={getVisibility(supercard)}
                />
            ))}
        </div>
    );
}
