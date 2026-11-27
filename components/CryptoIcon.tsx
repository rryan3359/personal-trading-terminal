'use client';

import { useEffect, useRef, useState } from 'react';
import { cryptoIconUrl } from '@/lib/crypto-icons';

/**
 * CryptoIcon — a coin logo in the existing letter-circle slot.
 *
 * Loads the real icon from the public cryptocurrency-icons CDN. The
 * hash-colour circle stays behind the image as backing, so while the
 * icon loads (or if it 404s — e.g. HYPE, which the library does not
 * have) the row falls back to the letter on the same coloured circle
 * and never looks worse than before. Same size as the circle it
 * replaces; plain <img> (no next/image remotePatterns config).
 */
export default function CryptoIcon({
  baseAsset,
  letter,
  sizeClass,
  textClass,
  bgColor,
}: {
  /** Base asset, e.g. "BTC" (not the full pair). */
  baseAsset: string;
  /** Fallback letter, shown when the icon cannot load. */
  letter: string;
  /** Circle size, e.g. "h-9 w-9". */
  sizeClass: string;
  /** Letter size, e.g. "text-sm" (matches the circle it replaces). */
  textClass: string;
  /** Backing circle colour (hash colour / #2a2e39). */
  bgColor: string;
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // An <img> that errors before hydration (slow CDN, offline first
  // paint) never fires onError — React attaches the handler after the
  // error already happened. Catch that case on mount: a completed
  // image with zero width has failed, so show the letter instead.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${sizeClass} ${textClass}`}
      style={{ backgroundColor: bgColor }}
    >
      {failed ? (
        letter
      ) : (
        // Plain <img> on purpose: next/image would need a
        // remotePatterns entry for the icon CDN; these are tiny
        // decorative SVGs, not LCP content.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={cryptoIconUrl(baseAsset)}
          alt=""
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full object-cover"
        />
      )}
    </span>
  );
}
