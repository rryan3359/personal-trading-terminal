'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cryptoIconCandidates } from '@/lib/crypto-icons';

/**
 * CryptoIcon — a coin logo in the existing letter-circle slot.
 *
 * Tries the icon candidates in order (cryptocurrency-icons CDN first,
 * CoinGecko override second for coins the first library lacks) and
 * only falls back to the letter when every candidate fails. The
 * hash-colour circle stays behind the image as backing, so while the
 * icon loads (or if all sources fail) the row shows the letter on
 * the same coloured circle and never looks worse than before. Same
 * size as the circle it replaces; plain <img> (no next/image
 * remotePatterns config).
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
  const candidates = useMemo(
    () => cryptoIconCandidates(baseAsset),
    [baseAsset],
  );
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Advance to the next candidate, or give up to the letter when
  // none are left.
  const advance = () => {
    if (idx + 1 < candidates.length) setIdx(idx + 1);
    else setFailed(true);
  };
  // An <img> that errors before hydration (slow CDN, offline first
  // paint) never fires onError — React attaches the handler after the
  // error already happened. Catch that case on mount (and after each
  // candidate swap): a completed image with zero width has failed, so
  // try the next candidate instead of jumping straight to the letter.
  useEffect(() => {
    const img = imgRef.current;
    if (!failed && img && img.complete && img.naturalWidth === 0) advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
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
        // remotePatterns entry for the icon CDNs; these are tiny
        // decorative images, not LCP content.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={candidates[idx]}
          alt=""
          draggable={false}
          onError={() => advance()}
          className="h-full w-full rounded-full object-cover"
        />
      )}
    </span>
  );
}
