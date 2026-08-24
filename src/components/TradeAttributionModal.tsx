import { PublicUserJson } from '../types';

interface TradeAttributionModalProps {
    /** The instance's real previous owner mixed in with random other students, already
     *  shuffled server-side (see GET /api/cards/:uniqueId/collect-candidates) -- deliberately
     *  received in an order that carries no information about which entry is correct, so this
     *  component just renders them in the order given rather than shuffling again. */
    candidates: PublicUserJson[];
    /** Called with the chosen user's id, or null for "Unknown / Other". */
    onChoose: (userId: number | null) => void;
}

/**
 * Shown when a scanned/visited card instance already has an owner: asks who the collector got
 * it from. The previous owner plus up to 3 random other students are offered as equal options
 * in a 2x2 grid, with a visually separated "Unknown / Other" 5th option for when the collector
 * doesn't know or isn't sure.
 */
export default function TradeAttributionModal({ candidates, onChoose }: TradeAttributionModalProps) {
    return (
        <div className="qr-modal__message trade-attribution">
            <p>Who did you get this card from?</p>
            <div className="trade-attribution__grid">
                {candidates.map((option) => (
                    <button key={option.id} type="button" onClick={() => onChoose(option.id)}>
                        {option.name}
                    </button>
                ))}
            </div>
            <button type="button" className="trade-attribution__other" onClick={() => onChoose(null)}>
                Unknown / Other
            </button>
        </div>
    );
}
