import { Link } from 'react-router-dom';
import { Supercard } from '../card';
import { CardVisibility } from '../data/ownership';
import CardArt from './CardArt';

interface CardThumbnailProps {
    supercard: Supercard;
    /** Defaults to 'collected' -- see CardArt. */
    visibility?: CardVisibility;
}

/**
 * A card face + title, linking through to that card's detail page -- unless it hasn't been
 * seen at all yet, in which case there's nothing to navigate to and it renders as a plain,
 * non-interactive block instead.
 */
export default function CardThumbnail({ supercard, visibility = 'collected' }: CardThumbnailProps) {
    const content = (
        <>
            <CardArt supercard={supercard} visibility={visibility} />
            <div className="card-thumbnail__title">{visibility === 'unseen' ? '???' : supercard.title}</div>
        </>
    );

    if (visibility === 'unseen') {
        return (
            <div className="card-thumbnail card-thumbnail--locked" aria-disabled="true">
                {content}
            </div>
        );
    }

    return (
        <Link to={`/cards/${supercard.highlightId}`} className="card-thumbnail">
            {content}
        </Link>
    );
}
