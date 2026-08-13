import { SUPERCARDS } from '../data/supercards';
import { getOwnedSupercardNumbers } from '../data/ownership';
import CardGrid from '../components/CardGrid';

export default function CollectionPage() {
    const owned = getOwnedSupercardNumbers();

    return (
        <div>
            <h1>Your Collection</h1>
            <p>
                Cards you've collected appear in full color. Everything else is greyed out
                until you trade for it.
            </p>
            <CardGrid cards={SUPERCARDS} isOwned={supercard => owned.has(supercard.n)} />
        </div>
    );
}
