import { useState } from 'react';

/**
 * Stands in for the real homepage while the site-wide lockdown setting is on (see
 * src/settings.ts's siteLockedDown / AdminPage's "Site settings" toggle) -- the only other
 * pages reachable while it's active are Register, Login, and Account (see App.tsx). The button doesn't
 * actually explain anything: clicking it swaps in a joke non-answer and the gif in public/,
 * which is the entire point.
 */
export default function LockedHomePage() {
    const [revealed, setRevealed] = useState(false);

    return (
        <div className="locked-home">
            <h1>What is Campus Trade?</h1>

            {!revealed ? (
                <button type="button" className="locked-home__button" onClick={() => setRevealed(true)}>
                    Find out
                </button>
            ) : (
                <div className="locked-home__reveal">
                    <p>Wouldn&rsquo;t you like to know.</p>
                    <img
                        className="locked-home__gif"
                        src="/wouldnt-you-like-to-know-weather-boy-3914946159.gif"
                        alt="A weatherman smugly saying 'wouldn't you like to know'"
                    />
                </div>
            )}
        </div>
    );
}
