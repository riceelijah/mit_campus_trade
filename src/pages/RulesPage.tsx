export default function RulesPage() {
    return (
        <div>
            <h1>Rules</h1>
            <ol>
                <li>On day one of orientation, every freshman gets a pack matching their team's color, with 3 unique cards inside.</li>
                <li>Trade cards with other students to fill out your collection. Every card has an exchange ritual printed on its back -- do it with the other person to complete the trade.</li>
                <li>Try to collect at least one card in each of the 12 flag colors. Speedrunning is discouraged; the point is to make friends.</li>
                <li>On day two, students who attend day-two events get new packs with new cards, plus an objective card (e.g. "collect all 5 Cultural Group cards").</li>
                <li>Upperclassmen may have special packs with cards not available to freshmen.</li>
                <li>Reach a goal, bring your cards to the prize booth on campus, and claim your prize.</li>
            </ol>

            <h1>FAQ</h1>
            <dl>
                <div className="faq-item">
                    <dt>Do I have to do the exchange ritual to trade?</dt>
                    <dd>Yes -- it's part of the game. Some are quick (an icebreaker question), some take a bit longer (grab food together).</dd>
                </div>
                <div className="faq-item">
                    <dt>Can I trade the same card twice?</dt>
                    <dd>Yes, a card can change hands as many times as you like -- its custody chain keeps track of everyone who's held it.</dd>
                </div>
                <div className="faq-item">
                    <dt>What if I lose a card?</dt>
                    <dd>More FAQs coming soon.</dd>
                </div>
            </dl>
        </div>
    );
}
