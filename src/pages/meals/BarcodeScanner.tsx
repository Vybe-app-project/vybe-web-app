import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  CAMERA_BLOCKED,
  CAMERA_UNAVAILABLE,
  CREATE_FOOD,
  GTIN_INVALID_HINT,
  LOOKING_UP,
  LOOKUP_LABEL,
  NOT_FOUND_TITLE,
  SCANNING,
  SCAN_HINT,
  SCAN_TITLE,
  TYPE_CODE_HINT,
  TYPE_CODE_LABEL,
  attributionLine,
  barcodeMacros,
  lookupErrorCopy,
  missCopy,
  normalizeGtin,
  parseBarcodeAnswer,
  servingTextOf,
  type BarcodeAnswer,
  type BarcodeFood,
} from '../../lib/foodBarcode';
import { Button, Callout, Input, Modal, Spinner, formatStat } from '../ui';
import { Search } from '../icons';

/**
 * The barcode scanner behind the scan button in the food search header.
 *
 * `BarcodeDetector` is the whole camera path: Chrome and Android have it,
 * iOS Safari 17 still does not, and there is no polyfill worth shipping in
 * a bundle this size. Where it is missing — or where the camera is refused
 * — the sheet is the typed-code field and says so in one line, which is the
 * same lookup by another door.
 *
 * The camera is asked for when this sheet opens and not a moment earlier:
 * the permission prompt belongs to the tap that wanted it.
 *
 * Scanning is continuous. The loop keeps running after a hit so a wrong
 * packet can simply be swapped for the right one; only a *new* code is
 * looked up, or one barcode in frame would spend the per-account budget
 * (6 lookups a minute) in two seconds.
 */

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** The 1-D symbologies a food packet actually uses, plus the 2-D ones some carry. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'];

const detectorCtor = (): BarcodeDetectorCtor | null => {
  const ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
};

export const barcodeDetectorSupported = () => detectorCtor() !== null;

const SCAN_INTERVAL_MS = 400;

export default function BarcodeScanner({
  open,
  onClose,
  onFound,
  onCreateFood,
}: {
  open: boolean;
  onClose: () => void;
  /** The food the code resolved to, USDA-shaped: the caller drops it into the log flow. */
  onFound: (food: BarcodeFood) => void;
  /** An unknown code: the caller prefills "create this food" with the digits. */
  onCreateFood?: (gtin: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCode = useRef<string | null>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'live' | 'unsupported' | 'blocked'>('off');
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | undefined>();
  const [answer, setAnswer] = useState<BarcodeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = useMutation({
    mutationFn: async (gtin: string) => {
      const { data } = await api.get(`/food/barcode/${encodeURIComponent(gtin)}`);
      return parseBarcodeAnswer(data, gtin);
    },
    onSuccess: (result) => {
      setError(result ? null : 'That answer could not be read. Try the code again.');
      setAnswer(result);
    },
    onError: (e) => {
      setAnswer(null);
      setError(lookupErrorCopy(e));
    },
  });

  // One code per lookup: the detector fires several times a second on the
  // same packet, and the API's budget is six a minute.
  const look = (gtin: string) => {
    if (lastCode.current === gtin || lookup.isPending) return;
    lastCode.current = gtin;
    setError(null);
    lookup.mutate(gtin);
  };

  /* --------------------------------------------------------- the camera */
  useEffect(() => {
    if (!open) return;
    const Ctor = detectorCtor();
    if (!Ctor) {
      setCamera('unsupported');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    setCamera('starting');
    const detector = new Ctor({ formats: FORMATS });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setCamera('live');
        timer = setInterval(() => {
          const el = videoRef.current;
          if (!el || el.readyState < 2) return;
          detector
            .detect(el)
            .then((hits) => {
              for (const hit of hits) {
                const gtin = normalizeGtin(hit?.rawValue);
                if (gtin) {
                  look(gtin);
                  return;
                }
              }
            })
            .catch(() => undefined);
        }, SCAN_INTERVAL_MS);
      })
      .catch(() => {
        if (!cancelled) setCamera('blocked');
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A fresh sheet starts from nothing; the code just scanned must not be
  // sitting there the next time it opens.
  useEffect(() => {
    if (open) return;
    lastCode.current = null;
    setAnswer(null);
    setError(null);
    setTyped('');
    setTypedError(undefined);
    setCamera('off');
  }, [open]);

  const submitTyped = () => {
    const gtin = normalizeGtin(typed);
    if (!gtin) {
      setTypedError(GTIN_INVALID_HINT);
      return;
    }
    setTypedError(undefined);
    // Typing the same code again is a deliberate retry, so let it through.
    lastCode.current = null;
    look(gtin);
  };

  const cameraLine =
    camera === 'unsupported' ? CAMERA_UNAVAILABLE : camera === 'blocked' ? CAMERA_BLOCKED : null;

  return (
    <Modal open={open} onClose={onClose} title={SCAN_TITLE} description={cameraLine ?? SCAN_HINT} size="sm">
      <div className="space-y-4">
        {camera === 'starting' || camera === 'live' ? (
          <div className="relative overflow-hidden rounded-md bg-surface-3" style={{ aspectRatio: '4 / 3' }}>
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" aria-label="Camera viewfinder" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-brand/80" />
            <p className="absolute inset-x-0 bottom-0 bg-bg/70 px-3 py-1.5 text-center text-xs text-text-2" aria-live="polite">
              {lookup.isPending ? LOOKING_UP : SCANNING}
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <Input
            id="barcode-typed"
            label={TYPE_CODE_LABEL}
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            maxLength={18}
            placeholder="0123456789012"
            className="tabular"
            hint={typedError ? undefined : TYPE_CODE_HINT}
            error={typedError}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value.replace(/[^\d\s-]/g, ''));
              setTypedError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submitTyped();
            }}
          />
          <Button variant="secondary" size="sm" icon={<Search size={16} />} onClick={submitTyped} loading={lookup.isPending} disabled={!typed.trim()}>
            {LOOKUP_LABEL}
          </Button>
        </div>

        {error ? <Callout tone="warning">{error}</Callout> : null}

        {lookup.isPending ? (
          <p className="inline-flex items-center gap-2 text-sm text-text-2" aria-live="polite">
            <Spinner size={16} /> {LOOKING_UP}
          </p>
        ) : null}

        <BarcodeResult answer={answer} onAdd={() => answer?.found && onFound(answer.food)} onCreateFood={onCreateFood} />
      </div>
    </Modal>
  );
}

/**
 * The answer, either way, with the attribution under it. Split out of the
 * sheet so it can be rendered on its own (the Modal draws nothing without a
 * document) and so the found and not-found states stay side by side.
 */
export function BarcodeResult({
  answer,
  onAdd,
  onCreateFood,
}: {
  answer: BarcodeAnswer | null;
  onAdd: () => void;
  onCreateFood?: (gtin: string) => void;
}) {
  const attribution = attributionLine(answer);
  return (
    <>
      {answer?.found ? <FoundFood answer={answer} onAdd={onAdd} /> : null}

      {answer && !answer.found ? (
        <div className="space-y-2 rounded-md border border-line bg-surface-1 p-3" data-testid="barcode-not-found">
          <p className="text-sm font-semibold text-text-1">{NOT_FOUND_TITLE}</p>
          <p className="tabular text-xs text-text-2">{answer.code}</p>
          <p className="text-sm text-text-2">{missCopy(answer)}</p>
          {onCreateFood ? (
            <Button variant="primary" size="sm" onClick={() => onCreateFood(answer.code)}>
              {CREATE_FOOD}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Open Food Facts data is ODbL: the sentence and its link are the
          server's, printed as sent, on a hit and on a miss alike. */}
      {attribution ? (
        <p className="text-2xs text-text-3">
          {attribution.href ? (
            <a href={attribution.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {attribution.text}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            attribution.text
          )}
        </p>
      ) : null}
    </>
  );
}

/** A hit: the name, one serving's macros, and the button that puts it in the log. */
function FoundFood({ answer, onAdd }: { answer: Extract<BarcodeAnswer, { found: true }>; onAdd: () => void }) {
  const macros = barcodeMacros(answer.food);
  const brand = answer.food.brandName || answer.food.brandOwner;
  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-1 p-3" data-testid="barcode-found">
      <p className="text-sm font-semibold text-text-1">{answer.food.description}</p>
      <p className="text-xs text-text-2">{[brand, servingTextOf(answer.food)].filter(Boolean).join(' · ')}</p>
      <p className="tabular text-xs text-text-2">
        <span className="type-stat text-md text-text-1">{formatStat(Math.round(macros.calories))}</span> kcal · P{' '}
        {Math.round(macros.protein)} g · C {Math.round(macros.carbs)} g · F {Math.round(macros.fat)} g
      </p>
      <Button variant="primary" size="sm" onClick={onAdd}>
        Add to meal
      </Button>
    </div>
  );
}
