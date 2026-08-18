import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Supercard } from '../card';
import CardArt from './CardArt';

interface ScrollingGalleryProps {
    cards: Supercard[];
}

// Rendered 3x back-to-back so there's always a full page of cards to scroll into in either
// direction; maybeWrap() below silently jumps by one page whenever the middle page would run
// out, which is invisible since all three pages are pixel-identical.
const REPEATS = 3;

const AUTOSCROLL_PX_PER_SEC = 22; // slow, deliberate drift -- not a race
const RESUME_DELAY_MS = 1500; // how long to wait after the viewer lets go before drifting again
const MAX_SCALE = 1.4;
const MIN_SCALE = 0.6;
const SCALE_FALLOFF_PER_CARD = 0.16; // how much scale is lost per card-width of distance

/**
 * A horizontally-scrollable strip of cards, always shown in full color -- this is a
 * promotional showcase, not the ownership-gated collection view. Styled and behaves like a
 * coverflow/wheel: the card nearest the viewport's center renders largest and on top, shrinking
 * (and overlapping its neighbors) toward either edge, always facing straight forward (no 3D
 * rotation, just scale + overlap). Auto-drifts sideways on its own, but a touch/trackpad/mouse
 * drag takes over immediately and autoscroll waits a bit after you let go before resuming.
 * Wraps seamlessly in both directions -- there's no "first" or "last" card. Purely a showcase:
 * cards here aren't clickable (unlike CardThumbnail elsewhere), since this is scroll-driven and
 * a stray click during a drag shouldn't launch a navigation.
 */
export default function ScrollingGallery({ cards }: ScrollingGalleryProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
    const spacingRef = useRef(0); // px between adjacent card centers, measured from the DOM
    const rafRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number | null>(null);
    const interactingRef = useRef(false);
    const resumeTimerRef = useRef<number | null>(null);
    // A separate float accumulator for autoscroll -- the DOM's scrollLeft rounds to an
    // integer on every write, so at ~22px/sec (a fraction of a pixel per frame at 60fps),
    // repeatedly doing `container.scrollLeft += tinyDelta` would have the browser round the
    // same tiny delta away every frame and the carousel would never visibly move. Tracking
    // our own float and only rounding on write avoids that; resynced below whenever the real
    // scrollLeft has moved on its own (manual scroll, maybeWrap's page jump).
    const scrollPositionRef = useRef<number | null>(null);

    const items = useMemo(
        () =>
            Array.from({ length: REPEATS }, (_, copy) =>
                cards.map((supercard) => ({ supercard, key: `${copy}-${supercard.n}` })),
            ).flat(),
        [cards],
    );

    const measureSpacing = useCallback(() => {
        const a = itemRefs.current[0];
        const b = itemRefs.current[1];
        if (a && b) {
            spacingRef.current = b.offsetLeft - a.offsetLeft;
        }
    }, []);

    /** Snaps scroll position so whichever card is currently nearest the viewport's center
     *  lands exactly on it -- used on first load and again on resize, so the carousel reads
     *  as centered regardless of screen width instead of wherever the raw scroll position
     *  happens to land. Picks the *nearest* card (not always the same fixed card) so a
     *  resize doesn't visibly swap out what's showcased mid-view. */
    const centerNearestItem = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const viewportCenter = container.scrollLeft + container.clientWidth / 2;
        let nearest: HTMLDivElement | null = null;
        let nearestDist = Infinity;
        for (const el of itemRefs.current) {
            if (!el) continue;
            const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - viewportCenter);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = el;
            }
        }
        if (nearest) {
            container.scrollLeft = nearest.offsetLeft + nearest.offsetWidth / 2 - container.clientWidth / 2;
        }
        scrollPositionRef.current = null; // force autoscroll to resync instead of undoing this jump
    }, []);

    /** Scales/stacks every rendered card by its distance from the viewport's horizontal
     *  center. Written directly to the DOM (not React state) since it needs to run on every
     *  scroll tick without triggering a re-render of 3x the card list each time. */
    const applyScales = useCallback(() => {
        const container = containerRef.current;
        if (!container || spacingRef.current === 0) return;
        const viewportCenter = container.scrollLeft + container.clientWidth / 2;
        for (const el of itemRefs.current) {
            if (!el) continue;
            const itemCenter = el.offsetLeft + el.offsetWidth / 2;
            const cardsAway = (itemCenter - viewportCenter) / spacingRef.current;
            const scale = Math.max(MIN_SCALE, MAX_SCALE - Math.abs(cardsAway) * SCALE_FALLOFF_PER_CARD);
            el.style.transform = `scale(${scale})`;
            el.style.zIndex = String(1000 - Math.round(Math.abs(cardsAway) * 10));
        }
    }, []);

    /** Jumps scrollLeft by exactly one page (never mid-scroll-animation) whenever the viewer
     *  nears either edge of the middle page, so scrolling continues to feel infinite. */
    const maybeWrap = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const pageWidth = container.scrollWidth / REPEATS;
        if (container.scrollLeft < pageWidth * 0.5) {
            container.scrollLeft += pageWidth;
        } else if (container.scrollLeft > pageWidth * (REPEATS - 0.5)) {
            container.scrollLeft -= pageWidth;
        }
    }, []);

    const onScroll = useCallback(() => {
        applyScales();
        maybeWrap();
    }, [applyScales, maybeWrap]);

    // Start centered in the middle page, once sizes are known -- then snap precisely so a
    // card's center lands exactly on the viewport's center regardless of its width, rather
    // than wherever the page-boundary starting point happens to fall.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        measureSpacing();
        container.scrollLeft = container.scrollWidth / REPEATS;
        centerNearestItem();
        applyScales();

        // Re-snap on resize too, so "centered" holds at any screen size, not just at load.
        const onResize = () => {
            measureSpacing();
            centerNearestItem();
            applyScales();
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [items, measureSpacing, centerNearestItem, applyScales]);

    // Autoscroll loop -- advances scrollLeft at a constant speed, frame-rate independent, but
    // only while the viewer isn't actively dragging/scrolling it themselves.
    useEffect(() => {
        function frame(t: number) {
            const container = containerRef.current;
            if (container && !interactingRef.current) {
                if (lastFrameTimeRef.current !== null) {
                    const dt = (t - lastFrameTimeRef.current) / 1000;
                    // Resync to the real scrollLeft if it's drifted from what we last wrote
                    // (manual scrolling, or maybeWrap's page jump) -- otherwise keep
                    // accumulating in float space so sub-pixel-per-frame progress isn't lost.
                    if (
                        scrollPositionRef.current === null ||
                        Math.abs(scrollPositionRef.current - container.scrollLeft) > 1
                    ) {
                        scrollPositionRef.current = container.scrollLeft;
                    }
                    scrollPositionRef.current += AUTOSCROLL_PX_PER_SEC * dt;
                    container.scrollLeft = scrollPositionRef.current;
                }
                lastFrameTimeRef.current = t;
            } else {
                lastFrameTimeRef.current = null; // don't count paused time as elapsed once resumed
                scrollPositionRef.current = null; // force a resync once autoscroll resumes
            }
            rafRef.current = requestAnimationFrame(frame);
        }
        rafRef.current = requestAnimationFrame(frame);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    const pauseAutoscroll = useCallback(() => {
        interactingRef.current = true;
        if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    }, []);

    const scheduleResume = useCallback(() => {
        if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = window.setTimeout(() => {
            interactingRef.current = false;
        }, RESUME_DELAY_MS);
    }, []);

    // Wheel/trackpad scrolling has no discrete "start/end" event like pointerdown/up does --
    // each wheel tick both pauses autoscroll and (re)schedules its resume, so a continuous
    // scroll gesture keeps pushing the resume time out, and it fires RESUME_DELAY_MS after
    // the *last* wheel tick once scrolling actually stops. Without the scheduleResume() call
    // here, a trackpad/mouse-wheel scroll would pause autoscroll permanently -- nothing else
    // was ever un-pausing it.
    const onWheel = useCallback(() => {
        pauseAutoscroll();
        scheduleResume();
    }, [pauseAutoscroll, scheduleResume]);

    return (
        <div
            ref={containerRef}
            className="gallery"
            onScroll={onScroll}
            onPointerDown={pauseAutoscroll}
            onPointerUp={scheduleResume}
            onPointerCancel={scheduleResume}
            onWheel={onWheel}
            onTouchStart={pauseAutoscroll}
            onTouchEnd={scheduleResume}
        >
            {items.map((item, i) => (
                <div
                    key={item.key}
                    ref={(el) => {
                        itemRefs.current[i] = el;
                    }}
                    className="card-thumbnail gallery__item"
                >
                    <CardArt supercard={item.supercard} />
                    <div className="card-thumbnail__title">{item.supercard.title}</div>
                </div>
            ))}
        </div>
    );
}
