import { Supercard } from '../card';
import CardThumbnail from './CardThumbnail';

interface ScrollingGalleryProps {
    cards: Supercard[];
}

/**
 * A horizontally-scrollable strip of cards, always shown in full color -- this is a
 * promotional showcase, not the ownership-gated collection view.
 */
export default function ScrollingGallery({ cards }: ScrollingGalleryProps) {
    return (
        <div className="gallery">
            {cards.map(supercard => (
                <CardThumbnail key={supercard.n} supercard={supercard} />
            ))}
        </div>
    );
}
