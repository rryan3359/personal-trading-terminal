/**
 * lib/chart-interaction-mode.ts — InteractionModeController (MASTER TASK Phase 3 Step 6).
 *
 * Owns the chart interaction state machine that used to live inline
 * in components/Chart.tsx (origin: Phase 1 step 3, Phase 0 §7.1):
 * the InteractionMode type, the mode / previousMode / measureJustDrawn
 * boxes, recordModeTransition / transitionMode / enterOverlayMode /
 * exitOverlayMode, and the dev-only window.__pttMode / __pttModeLog
 * mirror (capped at 200 entries). Pure TypeScript, no React: Chart
 * holds a single instance in a ref; the mode box and the measure flag
 * are exposed as live `{ current }` boxes so Chart's existing mode
 * reads keep working verbatim, and the three transition functions are
 * plain closures (no `this`), so Chart aliases them to their old
 * names. Step 7 / Step 8 may narrow this surface to getMode().
 *
 * Behaviour is unchanged from the inline version; the transition
 * guards are identical to Phase 1 state-step3 §2:
 * - Moving / Resizing only from Selected — or from Idle via the
 *   implicit select at press-start — and only back to Selected.
 * - Drawing <-> Selected never interconvert directly: the only
 *   bridge is a draw end (Drawing -> Selected, via onDrawEnd ->
 *   refreshSelected, fromDrawEnd) and an explicit tool arm
 *   (Selected -> Drawing, via armOverlay, viaArm).
 * - Overlay states (ContextMenu / Editing) are entered / exited only
 *   through enterOverlayMode / exitOverlayMode, which record and
 *   restore previousMode instead of assuming Idle. No nesting.
 * - A transition into Selected cancels a pending touch-fallback
 *   timer; leaving Selected clears the floating-bar compat-click
 *   suppression. Both side effects are injected through callbacks:
 *   the timer ref and the bar-guard ref stay in Chart, and the
 *   controller never touches them directly (the toolbar only reads
 *   the guard through barIgnoreClicksUntilRef — see Step 5 — and
 *   that wiring is untouched by this move).
 * - recordModeTransition logs rejected transitions too (ok: false),
 *   so a test run can assert the machine never refused a transition
 *   on the happy path.
 * - The mode is refs only: a mode change must never re-render Chart
 *   (step 2 moved high-frequency updates out of React state).
 */

/**
 * Phase 1 step 3 — explicit interaction mode (Phase 0 §7.1). Only the
 * seven states that actually exist are listed. Crosshair is NOT a mode:
 * it is always-on display behaviour (legend follows the crosshair) and
 * never enters the state machine. Selecting (marquee / multi-select)
 * is not listed either: selection is a single `selected`, with no
 * marquee or Shift-add (Phase 0 §3.4).
 */
export type InteractionMode =
  | 'Idle'
  | 'Drawing'
  | 'Selected'
  | 'Moving'
  | 'Resizing'
  | 'ContextMenu'
  | 'Editing';

/** Overlay states (entered / exited only through enter / exitOverlayMode). */
export type OverlayModeState = 'ContextMenu' | 'Editing';

/** Options for transitionMode (see the guard comment on the function). */
export interface TransitionOptions {
  /** Draw end (completion or cancellation) bridging Drawing -> Selected. */
  fromDrawEnd?: boolean;
  /** Explicit tool arm bridging Selected -> Drawing. */
  viaArm?: boolean;
}

export interface InteractionModeControllerCallbacks {
  /**
   * Entering Selected: cancel a pending touch-fallback timer — the
   * chart's own synthesis selected something, so the fallback is
   * moot. Chart checks its timer ref; a no-op when none is pending.
   */
  onEnterSelected: () => void;
  /**
   * Leaving Selected: clear the floating-bar compat-click
   * suppression, so a stale window can never swallow a later
   * selection's first bar click. Chart clears its guard ref.
   */
  onLeaveSelected: () => void;
}

export interface InteractionModeController {
  /**
   * Live mode box. Single source of truth for the chart interaction
   * mode; read as modeRef.current by Chart (and by the context-menu
   * controller's isDragging / isOpen guards).
   */
  modeRef: { current: InteractionMode };
  /**
   * True only between a measure draw ending and the click event that
   * follows it (set in onDrawEnd, consumed by handleContainerClick,
   * cleared by the next pointerdown on the container). The flag must
   * survive across tasks until that click, so it lives here — not in
   * React state — and is shared with Chart as a plain box.
   */
  measureJustDrawnRef: { current: boolean };
  /** Current mode (same value as modeRef.current). */
  getMode: () => InteractionMode;
  /**
   * The single way the interaction mode changes (except overlay-state
   * enter / exit). Returns false when the transition is rejected
   * (caller keeps the old mode and must not proceed as if it had
   * changed).
   */
  transitionMode: (
    next: InteractionMode,
    reason: string,
    opts?: TransitionOptions,
  ) => boolean;
  /**
   * Enter an overlay state (ContextMenu / Editing). Records the mode
   * we came from; exitOverlayMode restores it. No nesting: entering
   * an overlay state while already in one is rejected.
   */
  enterOverlayMode: (next: OverlayModeState, reason: string) => boolean;
  /**
   * Exit an overlay state, restoring the mode from before it opened.
   * The caller reconciles afterwards if the selection that mode
   * assumed is gone (see closeDialog in Chart).
   */
  exitOverlayMode: (reason: string) => boolean;
}

/** Dev-only mode-log cap (window.__pttModeLog). */
const MAX_MODE_LOG_ENTRIES = 200;

export function createInteractionModeController(
  callbacks: InteractionModeControllerCallbacks,
): InteractionModeController {
  const modeRef: { current: InteractionMode } = { current: 'Idle' };
  /** Mode before entering an overlay state (ContextMenu / Editing);
   *  the overlay state restores it on close instead of assuming Idle. */
  const previousModeRef: { current: InteractionMode } = { current: 'Idle' };
  const measureJustDrawnRef: { current: boolean } = { current: false };

  /**
   * Dev-only mode mirror for CDP verification (window.__pttMode /
   * window.__pttModeLog, same pattern as __pttChartRenders in step 2).
   * Production builds skip the window writes; the mode ref itself is
   * real logic and always runs. Rejected transitions are logged too
   * (ok: false) so a test run can assert the machine never refused a
   * transition on the happy path.
   */
  const recordModeTransition = (
    prev: InteractionMode,
    next: InteractionMode,
    reason: string,
    ok: boolean,
  ) => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as {
      __pttMode?: InteractionMode;
      __pttModeLog?: Array<{
        from: InteractionMode;
        to: InteractionMode;
        reason: string;
        t: number;
        ok: boolean;
      }>;
    };
    if (ok) w.__pttMode = next;
    const log = w.__pttModeLog ?? [];
    w.__pttModeLog = log;
    log.push({ from: prev, to: next, reason, t: performance.now(), ok });
    if (log.length > MAX_MODE_LOG_ENTRIES) {
      log.splice(0, log.length - MAX_MODE_LOG_ENTRIES);
    }
  };

  /**
   * The single way the interaction mode changes (except overlay-state
   * enter/exit, which have their own helpers for previousMode
   * bookkeeping). Guards (Phase 0 §7.1):
   * - Moving/Resizing only from Selected — or from Idle via the
   *   implicit select at press-start: the library fires onSelected on
   *   the click AFTER a drag, so a press that starts a drag is the
   *   mode-level select — and only back to Selected.
   * - Drawing <-> Selected never interconvert directly: the only
   *   bridge is a draw end (Drawing -> Selected, via onDrawEnd ->
   *   refreshSelected, fromDrawEnd) and an explicit tool arm
   *   (Selected -> Drawing, via armOverlay, viaArm). fromDrawEnd
   *   covers both draw completion and draw cancellation (Esc / disarm
   *   returning to a selection that predates the draw).
   * - Overlay states (ContextMenu/Editing) are entered/exited only
   *   through enterOverlayMode/exitOverlayMode.
   * A transition into Selected cancels a pending touch fallback timer:
   * the chart's own synthesis selected something, so the fallback is
   * moot. Leaving Selected clears the bar compat-click suppression.
   * Returns false when the transition is rejected (caller keeps the
   * old mode and must not proceed as if it had changed).
   */
  const transitionMode = (
    next: InteractionMode,
    reason: string,
    opts?: TransitionOptions,
  ): boolean => {
    const prev = modeRef.current;
    if (prev === next) return true;
    let ok = true;
    if (next === 'ContextMenu' || next === 'Editing') ok = false;
    else if (prev === 'ContextMenu' || prev === 'Editing') ok = false;
    else if (
      (next === 'Moving' || next === 'Resizing') &&
      prev !== 'Selected' &&
      prev !== 'Idle'
    ) {
      ok = false;
    } else if (
      (prev === 'Moving' || prev === 'Resizing') &&
      next !== 'Selected'
    ) {
      ok = false;
    } else if (
      prev === 'Drawing' &&
      next === 'Selected' &&
      !opts?.fromDrawEnd
    ) {
      ok = false;
    } else if (
      prev === 'Selected' &&
      next === 'Drawing' &&
      !opts?.viaArm
    ) {
      ok = false;
    }
    recordModeTransition(prev, next, reason, ok);
    if (!ok) return false;
    if (next === 'Selected') callbacks.onEnterSelected();
    if (prev === 'Selected' && next !== 'Selected') {
      callbacks.onLeaveSelected();
    }
    modeRef.current = next;
    return true;
  };

  /**
   * Enter an overlay state (ContextMenu in step 4, Editing for the
   * settings dialog). Records the mode we came from; exitOverlayMode
   * restores it instead of assuming Idle. No nesting: entering an
   * overlay state while already in one is rejected.
   */
  const enterOverlayMode = (
    next: OverlayModeState,
    reason: string,
  ): boolean => {
    const prev = modeRef.current;
    if (prev === 'ContextMenu' || prev === 'Editing') {
      recordModeTransition(prev, next, reason, false);
      return false;
    }
    previousModeRef.current = prev;
    modeRef.current = next;
    recordModeTransition(prev, next, reason, true);
    return true;
  };

  /**
   * Exit an overlay state, restoring the mode from before it opened.
   * The caller reconciles afterwards if the selection that mode
   * assumed is gone (see closeDialog: a dialog can delete or hide
   * its own selection).
   */
  const exitOverlayMode = (reason: string): boolean => {
    const prev = modeRef.current;
    if (prev !== 'ContextMenu' && prev !== 'Editing') {
      recordModeTransition(prev, prev, reason, false);
      return false;
    }
    const next = previousModeRef.current;
    previousModeRef.current = 'Idle';
    modeRef.current = next;
    recordModeTransition(prev, next, reason, true);
    return true;
  };

  return {
    modeRef,
    measureJustDrawnRef,
    getMode: () => modeRef.current,
    transitionMode,
    enterOverlayMode,
    exitOverlayMode,
  };
}
