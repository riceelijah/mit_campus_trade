import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { Supercard } from '../card';
import { useAuth } from '../auth/AuthContext';
import { getSupercardByHighlightId } from '../data/supercards';
import { extractHighlightId } from '../lib/qr';
import { extractError } from '../lib/api';
import CardArt from './CardArt';

type ScannerState =
    | { status: 'requesting-camera' }
    | { status: 'scanning' }
    | { status: 'camera-error'; message: string }
    | { status: 'not-found' }
    | { status: 'not-logged-in'; supercard: Supercard }
    | { status: 'choose-action'; supercard: Supercard }
    | { status: 'duplicate-confirm'; supercard: Supercard }
    | { status: 'registering'; supercard: Supercard }
    | { status: 'marking-seen'; supercard: Supercard }
    | { status: 'collect-error'; supercard: Supercard; message: string }
    | { status: 'seen-error'; supercard: Supercard; message: string }
    | { status: 'success'; supercard: Supercard };

const DECODE_INTERVAL_MS = 250;

interface QrScannerModalProps {
    onClose: () => void;
}

/**
 * A camera-driven QR scanner, opened from the nav bar. Decodes a card's printed QR code
 * (a URL of the form mitcampustrade.com/cards/{highlightId}) and offers the logged-in viewer
 * a choice: register it to their collection, or "Just looking" -- mark it seen without
 * claiming it (shows greyed out in their collection afterward). Warns (but doesn't block) on
 * a card already collected, since physical duplicates are a normal part of trading. If
 * signed out, "Just looking" is an ephemeral, unsaved peek (there's no account to attach it
 * to), alongside links to log in/register in order to actually claim it. Either way, "Just
 * looking" closes the scanner and takes the viewer straight to the card's own page, handing
 * off a confirmation message for it to show as a pop-up (see Toast/CardDetailPage) rather
 * than showing that message here in the modal.
 */
export default function QrScannerModal({ onClose }: QrScannerModalProps) {
    const { user, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [state, setState] = useState<ScannerState>({ status: 'requesting-camera' });

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const intervalRef = useRef<number | null>(null);
    const busyRef = useRef(false);

    const stopCamera = useCallback(() => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, []);

    // Always release the camera on unmount, no matter what state we were in.
    useEffect(() => stopCamera, [stopCamera]);

    const collect = useCallback(
        async (supercard: Supercard) => {
            setState({ status: 'registering', supercard });
            try {
                const res = await fetch('/api/me/collect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ highlightId: supercard.highlightId }),
                });
                if (!res.ok) throw new Error(await extractError(res));
                await refreshUser();
                setState({ status: 'success', supercard });
            } catch (err) {
                setState({
                    status: 'collect-error',
                    supercard,
                    message: err instanceof Error ? err.message : 'Something went wrong',
                });
            }
        },
        [refreshUser],
    );

    const goToCardWithToast = useCallback(
        (supercard: Supercard, toast: string) => {
            onClose();
            navigate(`/cards/${supercard.highlightId}`, { state: { toast } });
        },
        [onClose, navigate],
    );

    const markSeen = useCallback(
        async (supercard: Supercard) => {
            setState({ status: 'marking-seen', supercard });
            try {
                const res = await fetch('/api/me/seen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ highlightId: supercard.highlightId }),
                });
                if (!res.ok) throw new Error(await extractError(res));
                await refreshUser();
                goToCardWithToast(
                    supercard,
                    `Marked "${supercard.title}" as seen. It'll show greyed out in your collection until you register a copy.`,
                );
            } catch (err) {
                setState({
                    status: 'seen-error',
                    supercard,
                    message: err instanceof Error ? err.message : 'Something went wrong',
                });
            }
        },
        [refreshUser, goToCardWithToast],
    );

    const handleDecoded = useCallback(
        (raw: string) => {
            stopCamera();
            const highlightId = extractHighlightId(raw);
            const supercard = highlightId ? getSupercardByHighlightId(highlightId) : undefined;
            if (!supercard) {
                setState({ status: 'not-found' });
                return;
            }
            if (!user) {
                setState({ status: 'not-logged-in', supercard });
                return;
            }
            const alreadyHave = user.collected.some((card) => card.n === supercard.n);
            if (alreadyHave) {
                setState({ status: 'duplicate-confirm', supercard });
            } else {
                setState({ status: 'choose-action', supercard });
            }
        },
        [stopCamera, user],
    );

    const startDecodeLoop = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (window.BarcodeDetector) {
            const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            intervalRef.current = window.setInterval(async () => {
                if (busyRef.current) return;
                busyRef.current = true;
                try {
                    const codes = await detector.detect(video);
                    if (codes.length > 0) handleDecoded(codes[0].rawValue);
                } catch {
                    // transient decode failure -- ignore, retry next tick
                } finally {
                    busyRef.current = false;
                }
            }, DECODE_INTERVAL_MS);
        } else {
            // Safari/iOS has no BarcodeDetector -- decode video frames via jsQR instead.
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) return;
            intervalRef.current = window.setInterval(() => {
                if (busyRef.current || video.readyState !== video.HAVE_ENOUGH_DATA) return;
                busyRef.current = true;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const result = jsQR(imageData.data, imageData.width, imageData.height);
                if (result) handleDecoded(result.data);
                busyRef.current = false;
            }, DECODE_INTERVAL_MS);
        }
    }, [handleDecoded]);

    useEffect(() => {
        if (state.status !== 'requesting-camera') return;
        let cancelled = false;

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
                setState({ status: 'scanning' });
                startDecodeLoop();
            } catch {
                if (!cancelled) {
                    setState({
                        status: 'camera-error',
                        message: 'Could not access the camera. Check your camera permission and try again.',
                    });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [state.status, startDecodeLoop]);

    const scanAgain = () => setState({ status: 'requesting-camera' });

    return (
        <div className="qr-modal__backdrop" onClick={onClose}>
            <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    className="qr-modal__close"
                    onClick={onClose}
                    aria-label="Close scanner"
                >
                    &times;
                </button>

                {(state.status === 'requesting-camera' || state.status === 'scanning') && (
                    <div className="qr-modal__viewfinder">
                        <video ref={videoRef} className="qr-modal__video" muted playsInline />
                        <canvas ref={canvasRef} hidden />
                        <p className="qr-modal__hint">Point your camera at a card&rsquo;s QR code</p>
                    </div>
                )}

                {state.status === 'camera-error' && (
                    <div className="qr-modal__message">
                        <p>{state.message}</p>
                        <button type="button" onClick={scanAgain}>
                            Try again
                        </button>
                    </div>
                )}

                {state.status === 'not-found' && (
                    <div className="qr-modal__message">
                        <p>That doesn&rsquo;t look like a Campus Trade card code.</p>
                        <button type="button" onClick={scanAgain}>
                            Scan again
                        </button>
                    </div>
                )}

                {state.status === 'not-logged-in' && (
                    <div className="qr-modal__message">
                        <p>
                            Log in or register to add &ldquo;{state.supercard.title}&rdquo; to your
                            collection, or just take a look without saving it.
                        </p>
                        <p>
                            <Link to="/login" onClick={onClose}>
                                Log in
                            </Link>
                            {' · '}
                            <Link to="/register" onClick={onClose}>
                                Register
                            </Link>
                        </p>
                        <button
                            type="button"
                            onClick={() =>
                                goToCardWithToast(
                                    state.supercard,
                                    `Just a peek — log in or register to add "${state.supercard.title}" to your collection.`,
                                )
                            }
                        >
                            Just looking
                        </button>
                    </div>
                )}

                {state.status === 'choose-action' && (
                    <div className="qr-modal__message">
                        <div className="qr-modal__art">
                            <CardArt supercard={state.supercard} />
                        </div>
                        <p>You scanned &ldquo;{state.supercard.title}&rdquo;.</p>
                        <button type="button" onClick={() => collect(state.supercard)}>
                            Register to my account
                        </button>
                        <button type="button" onClick={() => markSeen(state.supercard)}>
                            Just looking
                        </button>
                    </div>
                )}

                {state.status === 'duplicate-confirm' && (
                    <div className="qr-modal__message">
                        <p>
                            You already have &ldquo;{state.supercard.title}&rdquo; &mdash; add another copy?
                        </p>
                        <button type="button" onClick={() => collect(state.supercard)}>
                            Add another copy
                        </button>
                        <button type="button" onClick={scanAgain}>
                            Cancel
                        </button>
                    </div>
                )}

                {state.status === 'registering' && (
                    <p className="qr-modal__message">Adding to your collection&hellip;</p>
                )}

                {state.status === 'collect-error' && (
                    <div className="qr-modal__message">
                        <p>{state.message}</p>
                        <button type="button" onClick={() => collect(state.supercard)}>
                            Try again
                        </button>
                    </div>
                )}

                {state.status === 'success' && (
                    <div className="qr-modal__message">
                        <div className="qr-modal__art">
                            <CardArt supercard={state.supercard} />
                        </div>
                        <p>Added &ldquo;{state.supercard.title}&rdquo; to your collection.</p>
                        <p>
                            <Link to={`/cards/${state.supercard.highlightId}`} onClick={onClose}>
                                View card
                            </Link>
                        </p>
                        <button type="button" onClick={scanAgain}>
                            Scan another
                        </button>
                    </div>
                )}

                {state.status === 'marking-seen' && (
                    <p className="qr-modal__message">Marking as seen&hellip;</p>
                )}

                {state.status === 'seen-error' && (
                    <div className="qr-modal__message">
                        <p>{state.message}</p>
                        <button type="button" onClick={() => markSeen(state.supercard)}>
                            Try again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
