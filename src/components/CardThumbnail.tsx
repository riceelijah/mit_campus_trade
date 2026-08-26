import { Link } from 'react-router-dom';
import { Supercard } from '../card';
import { CardVisibility } from '../data/ownership';
import CardArt from './CardArt';

interface CardThumbnailProps {
    supercard: Supercard;
    /** When given (see the Hand view's per-copy tiles in CollectionPage), links to that
     *  specific copy's own custody chain via `?instance=` instead of the plain design page. */
    uniqueId?: string;
    /** Defaults to 'collected' -- see CardArt. */
    visibility?: CardVisibility;
}

/**
 * A card face + title, linking through to that card's detail page -- unless it hasn't been
 * seen at all yet, in which case there's nothing to navigate to and it renders as a plain,
 * non-interactive block instead.
 */
export default function CardThumbnail({ supercard, uniqueId, visibility = 'collected' }: CardThumbnailProps) {
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

    const href = uniqueId
        ? `/cards/${supercard.highlightId}?instance=${encodeURIComponent(uniqueId)}`
        : `/cards/${supercard.highlightId}`;

    return (
        <Link to={href} className="card-thumbnail">
            {content}
        </Link>
    );
}
