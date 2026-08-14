import { SUPERCARDS } from '../data/supercards';
import ScrollingGallery from '../components/ScrollingGallery';

export default function HomePage() {
    return (
        <div>
            <h1>MIT Campus Trade</h1>
            <p>
                Campus Trade is a trading card game for MIT orientation. On day one, every freshman gets a
                pack of cards matching their team's color -- 12 flag colors in all. Each card features artwork
                of a person, place, event, dorm, or club on campus, made by an MIT student, with an excerpt
                from an interview with someone on that topic on the back.
            </p>
            <p>
                The goal is simple: make friends, and try to collect a card in every one of the 12 flag
                colors. Trading a card requires completing its exchange ritual with the other person -- an
                icebreaker question, a selfie, a plan to grab food, whatever it asks for. New packs and
                objectives get added as orientation continues, so there's always a reason to keep trading.
            </p>
            <h2>Browse the cards</h2>
            <ScrollingGallery cards={SUPERCARDS} />
        </div>
    );
}
