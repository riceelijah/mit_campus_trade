import { useState } from 'react';
import { Supercard } from '../card';

interface CardArtProps {
    supercard: Supercard;
    /** Renders in greyscale (used for cards the viewer doesn't own yet). */
    greyscale?: boolean;
}

/**
 * A card's front face: the real finished render from public/art/fronts/<n>.png if it's
 * there, otherwise a placeholder block in the card's team color. Falls back automatically
 * on image load failure, so art can be added incrementally without touching this component.
 */
export default function CardArt({ supercard, greyscale = false }: CardArtProps) {
    const [artMissing, setArtMissing] = useState(false);

    return (
        <div
            className={`card-art${greyscale ? ' card-art--greyscale' : ''}`}
            style={{ backgroundColor: supercard.color }}
            title={supercard.title}
        >
            {!artMissing && (
                <img
                    className="card-art__image"
                    src={`/art/fronts/${supercard.n}.png`}
                    alt=""
                    onError={() => setArtMissing(true)}
                />
            )}
            {artMissing && <span className="card-art__label">{supercard.title}</span>}
        </div>
    );
}
