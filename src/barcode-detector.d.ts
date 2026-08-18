// Minimal ambient declaration for the native BarcodeDetector API -- not yet included in
// TypeScript's bundled DOM lib. Covers only what src/components/QrScannerModal.tsx uses;
// see https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector for the full API.
// Not supported in Safari/iOS, which is why QrScannerModal falls back to jsQR when this
// global is undefined.

interface BarcodeDetectorOptions {
    formats?: string[];
}

interface DetectedBarcode {
    rawValue: string;
}

declare class BarcodeDetector {
    constructor(options?: BarcodeDetectorOptions);
    detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface Window {
    BarcodeDetector?: typeof BarcodeDetector;
}
