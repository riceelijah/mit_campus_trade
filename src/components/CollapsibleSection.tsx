import { useState, ReactNode } from 'react';

interface CollapsibleSectionProps {
    title: string;
    children: ReactNode;
    /** Starts expanded unless explicitly set false -- every current use case wants the fully-
     *  open look on first load, with collapsing offered purely as a way to tidy up afterward. */
    defaultOpen?: boolean;
    className?: string;
}

/**
 * A titled panel that can be collapsed down to just its header -- used throughout AdminPage so
 * a page with a growing number of panels can still be tidied up without losing any of them.
 * Collapse state is local to this component instance (not persisted), so it resets on reload;
 * that's fine here since every panel is cheap to re-expand and none of this is destructive.
 */
export default function CollapsibleSection({
    title,
    children,
    defaultOpen = true,
    className,
}: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={className}>
            <button
                type="button"
                className="collapsible-section__header"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
            >
                <span className="collapsible-section__title">{title}</span>
                <svg
                    viewBox="0 0 12 12"
                    className={
                        'collapsible-section__chevron' + (open ? ' collapsible-section__chevron--open' : '')
                    }
                    aria-hidden="true"
                >
                    <path
                        d="M2.5 4.5L6 8L9.5 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
            {open && <div className="collapsible-section__body">{children}</div>}
        </div>
    );
}
