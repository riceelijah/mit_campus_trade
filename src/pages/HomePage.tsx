import { SUPERCARDS } from '../data/supercards';
import ScrollingGallery from '../components/ScrollingGallery';

export default function HomePage() {
    return (
        <div>
            <h1>Welcome to Campus Trade!</h1>
            <p>
                Campus Trade is a campus-wide trading card game designed to help you meet people, explore MIT,
                and discover the stories that make campus special.
            </p>
            <p>
                Every card features student artwork, an excerpt from an interview with an upperclassman, and
                an Exchange Cost: a conversation starter designed to take you beyond the usual “What’s your
                name?” and “Where are you from?”
            </p>
            <p>
                As you meet people, trade cards, and build your collection, you’ll discover new corners of
                campus and the people who call them home. Log your collection here in the Campus Trade Portal
                and see what parts of MIT you choose to collect.
            </p>
            <p>Meet people. Trade cards. Start conversations.</p>
            <p>Because at the end of the day, the real treasure is the friends you make along the way.</p>
            <ScrollingGallery cards={SUPERCARDS} />
        </div>
    );
}
