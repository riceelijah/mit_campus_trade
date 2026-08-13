import { Supercard } from '../card';

interface CardArtProps {
    supercard: Supercard;
    /** Renders in greyscale (used for cards the viewer doesn't own yet). */
    greyscale?: boolean;
}

/**
 * Placeholder card face: a block in the card's team color with its title overlaid. Stands
 * in for real art (no art assets exist yet) -- swap this out once `artFile` images exist.
 */
export default function CardArt({ supercard, greyscale = false }: CardArtProps) {
    return (
        <div
            className={`card-art${greyscale ? ' card-art--greyscale' : ''}`}
            style={{ backgroundColor: supercard.color }}
            title={supercard.title}
        >
            <span className="card-art__label">{supercard.title}</span>
        </div>
    );
}
