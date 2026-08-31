import { CustodyRecord } from '../card';
import { formatEasternDateTime } from '../lib/format';

interface CustodyChainProps {
    custody: readonly CustodyRecord[];
}

/** Renders a card instance's ownership history, oldest first. */
export default function CustodyChain({ custody }: CustodyChainProps) {
    if (custody.length === 0) {
        return <p className="not-owned-note">No ownership history yet.</p>;
    }

    return (
        <ol className="custody-chain">
            {custody.map((record, i) => (
                <li key={i}>
                    {record.owner.name} &mdash; {formatEasternDateTime(record.acquiredAt)}
                </li>
            ))}
        </ol>
    );
}
