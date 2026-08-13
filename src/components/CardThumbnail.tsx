import { Link } from 'react-router-dom';
import { Supercard } from '../card';
import CardArt from './CardArt';

interface CardThumbnailProps {
    supercard: Supercard;
    greyscale?: boolean;
}

/** A clickable card face + title, linking through to that card's detail page. */
export default function CardThumbnail({ supercard, greyscale = false }: CardThumbnailProps) {
    return (
        <Link to={`/cards/${supercard.n}`} className="card-thumbnail">
            <CardArt supercard={supercard} greyscale={greyscale} />
            <div className="card-thumbnail__title">{supercard.title}</div>
        </Link>
    );
}
