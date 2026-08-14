import { useState } from 'react';
import { Supercard } from '../card';

interface FlippableCardProps {
    supercard: Supercard;
}

/**
 * The card detail page's hero: shows the front render, and flips around (a real 3D
 * rotation, not a crossfade) to the back render on click/Enter/Space. Falls back to a
 * color-placeholder face on either side if that render is missing.
 */
export default function FlippableCard({ supercard }: FlippableCardProps) {
    const [flipped, setFlipped] = useState(false);
    const [frontMissing, setFrontMissing] = useState(false);
    const [backMissing, setBackMissing] = useState(false);

    const toggle = () => setFlipped((f) => !f);

    return (
        <div
            className="flip-card"
            role="button"
            tabIndex={0}
            aria-label={`${supercard.title} card. Click to flip and see the ${flipped ? 'front' : 'back'}.`}
            onClick={toggle}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggle();
                }
            }}
        >
            <div className={`flip-card__inner${flipped ? ' flip-card__inner--flipped' : ''}`}>
                <div
                    className="flip-card__face flip-card__face--front"
                    style={{ backgroundColor: supercard.color }}
                >
                    {!frontMissing ? (
                        <img
                            className="flip-card__image"
                            src={`/art/fronts/${supercard.n}.png`}
                            alt={`${supercard.title} -- front`}
                            onError={() => setFrontMissing(true)}
                        />
                    ) : (
                        <span className="card-art__label">{supercard.title}</span>
                    )}
                </div>
                <div
                    className="flip-card__face flip-card__face--back"
                    style={{ backgroundColor: supercard.color }}
                >
                    {!backMissing ? (
                        <img
                            className="flip-card__image"
                            src={`/art/backs/${supercard.n}.png`}
                            alt={`${supercard.title} -- back`}
                            onError={() => setBackMissing(true)}
                        />
                    ) : (
                        <span className="card-art__label">Back not available</span>
                    )}
                </div>
            </div>
        </div>
    );
}
