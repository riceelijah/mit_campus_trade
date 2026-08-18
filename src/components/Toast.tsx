import { useEffect } from 'react';

interface ToastProps {
    message: string;
    onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

/** A transient pop-up notification, fixed to the top of the viewport. Auto-dismisses after a
 *  few seconds, or immediately on click. */
export default function Toast({ message, onDismiss }: ToastProps) {
    useEffect(() => {
        const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="toast" role="status" onClick={onDismiss}>
            <span>{message}</span>
            <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss">
                &times;
            </button>
        </div>
    );
}
