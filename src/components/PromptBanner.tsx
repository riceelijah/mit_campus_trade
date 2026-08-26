import { useState } from 'react';
import { PendingResearchPrompt } from '../types';

interface PromptBannerProps {
    prompt: PendingResearchPrompt;
    /** Called once the banner is done with -- either answered or dismissed. Nothing is
     *  written to the database unless the viewer actually submits an answer, so a dismiss
     *  here is the end of it (the banner is delivered as one-shot navigation state, so it
     *  can never come back for this same card -- see CollectFlow.finish). */
    onDone: () => void;
}

/**
 * An optional-to-answer research prompt shown at the top of a card's detail page right after
 * collecting it (see CollectFlow/CardDetailPage) -- unlike Toast, this doesn't auto-dismiss,
 * since it's asking for an actual answer rather than just confirming something happened.
 */
export default function PromptBanner({ prompt, onDone }: PromptBannerProps) {
    const [submitting, setSubmitting] = useState(false);
    const [notes, setNotes] = useState('');

    const answerReceivedFromOther = async (value: boolean) => {
        setSubmitting(true);
        try {
            await fetch(`/api/me/exchange-events/${prompt.exchangeEventId}/received-from-other`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ value }),
            });
        } finally {
            onDone();
        }
    };

    const submitConversationNotes = async () => {
        if (notes.trim().length === 0) return;
        setSubmitting(true);
        try {
            await fetch(`/api/me/exchange-events/${prompt.exchangeEventId}/conversation-notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ notes }),
            });
        } finally {
            onDone();
        }
    };

    return (
        <div className="prompt-banner" role="status">
            <button
                type="button"
                className="prompt-banner__close"
                onClick={onDone}
                aria-label="Dismiss"
                disabled={submitting}
            >
                &times;
            </button>

            {prompt.type === 'received-from-other' ? (
                <>
                    <p>Did you receive this card from someone else?</p>
                    <div className="prompt-banner__actions">
                        <button
                            type="button"
                            onClick={() => answerReceivedFromOther(true)}
                            disabled={submitting}
                        >
                            Yes
                        </button>
                        <button
                            type="button"
                            onClick={() => answerReceivedFromOther(false)}
                            disabled={submitting}
                        >
                            No
                        </button>
                    </div>
                </>
            ) : (
                <>
                    <p>
                        Want to help with our research? Tell us a little bit about your conversation when you
                        traded this card.
                    </p>
                    <textarea
                        className="prompt-banner__notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="What did you talk about?"
                        rows={3}
                        disabled={submitting}
                    />
                    <div className="prompt-banner__actions">
                        <button
                            type="button"
                            onClick={submitConversationNotes}
                            disabled={submitting || notes.trim().length === 0}
                        >
                            Submit
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
