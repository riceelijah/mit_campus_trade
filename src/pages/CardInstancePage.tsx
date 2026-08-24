import { useParams, Link } from 'react-router-dom';
import { getSupercardByHighlightId } from '../data/supercards';
import CollectFlow from '../components/CollectFlow';

/**
 * The page a specific physical copy's own QR code/URL points to
 * (`/cards/:highlightId/:uniqueId`) -- "just going to the webpage for the card" is meant to
 * behave the same as scanning it, so this hosts the same CollectFlow used by QrScannerModal,
 * just laid out inline on the page instead of inside a modal. CollectFlow itself navigates to
 * the general `/cards/:highlightId` page (dropping the uniqueId) once it's done, whether that
 * means collecting the card, marking it seen, or discovering the viewer already owns it.
 */
export default function CardInstancePage() {
    const { highlightId, uniqueId } = useParams<{ highlightId: string; uniqueId: string }>();
    const supercard = highlightId ? getSupercardByHighlightId(highlightId) : undefined;

    if (!supercard || !uniqueId) {
        return (
            <div>
                <h1>Card not found</h1>
                <p>
                    <Link to="/collection">Back to your collection</Link>
                </p>
            </div>
        );
    }

    return (
        <div className="card-instance-page">
            <CollectFlow supercard={supercard} uniqueId={uniqueId} />
        </div>
    );
}
