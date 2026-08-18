import { useState } from 'react';
import { Supercard } from '../card';
import { CardVisibility } from '../data/ownership';

interface CardArtProps {
    supercard: Supercard;
    /** Defaults to 'collected' -- the normal, full-color look, for callers outside an
     *  ownership-gated context (the home gallery, the scanner's own success screens). */
    visibility?: CardVisibility;
}

/**
 * A card's front face: the real finished render from public/art/fronts/<n>.png if it's
 * there, otherwise a placeholder block in the card's team color. Falls back automatically
 * on image load failure, so art can be added incrementally without touching this component.
 *
 * `visibility === 'unseen'` renders neither the art nor the team color -- both would leak
 * information about a card the viewer hasn't encountered yet -- and shows its dex number on
 * a solid placeholder instead (like an unseen Pokedex entry).
 */
export default function CardArt({ supercard, visibility = 'collected' }: CardArtProps) {
    const [artMissing, setArtMissing] = useState(false);

    if (visibility === 'unseen') {
        return (
            <div className="card-art card-art--unseen" title="Not yet seen">
                <span className="card-art__number" aria-hidden="true">
                    #{supercard.n}
                </span>
            </div>
        );
    }

    return (
        <div
            className={`card-art${visibility === 'seen' ? ' card-art--greyscale' : ''}`}
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
