/**
 * lib/drawing-history.ts — DrawingHistoryManager (MASTER TASK Phase 3 Step 2).
 *
 * Owns the drawing undo/redo stacks that used to live inline in
 * components/Chart.tsx (undoStackRef / redoStackRef /
 * moveStartSnapshotRef / pendingArmPushRef / emitHistoryChange /
 * pushHistory / cancelPendingArmPush / the undo/redo stack ops).
 * Pure TypeScript, no React: Chart holds a single instance in a ref
 * and calls it through thin wrappers (pushHistory /
 * cancelPendingArmPush / undo / redo); applySnapshot stays in Chart
 * (it needs overlayCreate + the store + mode + the object list) and
 * is applied to whatever snapshot undo/redo returns.
 *
 * Behaviour is unchanged from the inline version:
 * - Snapshots are whole SavedOverlay[] lists (the merged live +
 *   stored list from readMergedList, or the pre-move snapshot).
 * - `push` appends to the undo stack, drops the oldest entry past
 *   MAX_HISTORY (50), clears the redo stack, and notifies.
 * - `undo` / `redo` clear the pending-arm flag WITHOUT popping
 *   (that push stays a normal history entry), then move one entry
 *   between the stacks and return it; an empty source stack returns
 *   null with no notification and no push to the other stack.
 * - `cancelPendingArmPush` pops one entry, but only while the
 *   pending-arm flag is set (G-11: discarding an unfinished draw
 *   removes the pre-draw push its arm made); otherwise a no-op.
 * - `confirmArmPush` clears the pending-arm flag without popping
 *   (G-11: the draw succeeded, so the arm's pre-draw push stays).
 * - `clear` empties both stacks, clears the pending-arm flag, and
 *   notifies (symbol/interval switch: history is per view).
 * - The pre-move snapshot is taken at press start and consumed at
 *   move end; the move-end caller pushes it only if the overlay
 *   actually moved (a plain click pushes nothing).
 */
import type { SavedOverlay } from '@/lib/store';

/** Maximum undo steps (was a Chart.tsx module constant). */
export const MAX_HISTORY = 50;

/** History-change notification: (canUndo, canRedo). */
export type HistoryChangeCallback = (
  canUndo: boolean,
  canRedo: boolean,
) => void;

export class DrawingHistoryManager {
  private undoStack: SavedOverlay[][] = [];
  private redoStack: SavedOverlay[][] = [];
  /**
   * G-11: true while an interactive arm's pre-draw history push is
   * still pending. Set when armOverlay pushes, cleared on draw end;
   * discarding the unfinished draw pops that push back.
   */
  private pendingArmPush = false;
  /** Pre-move snapshot, taken at press start and pushed at move end
   *  only if the overlay actually moved. */
  private moveStartSnapshot: SavedOverlay[] | null = null;
  private readonly onChange: HistoryChangeCallback | null;

  constructor(onChange?: HistoryChangeCallback) {
    this.onChange = onChange ?? null;
  }

  private emitChange(): void {
    this.onChange?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  /**
   * Record a snapshot as a new undo step: append to the undo stack,
   * drop the oldest entry past MAX_HISTORY, clear the redo stack,
   * and notify. The caller supplies the snapshot (usually
   * readMergedList for the current view, or the pre-move snapshot).
   */
  push(snapshot: SavedOverlay[]): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.emitChange();
  }

  /**
   * Undo one step: clear the pending-arm flag (the arm's push stays
   * a normal history entry — it is NOT popped), push the current
   * list onto the redo stack, pop the undo stack and return it.
   * Returns null when there is nothing to undo (no notification,
   * nothing pushed to the redo stack).
   */
  undo(current: SavedOverlay[]): SavedOverlay[] | null {
    this.pendingArmPush = false;
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    this.emitChange();
    return prev;
  }

  /**
   * Redo one step: the mirror of undo (clear the pending-arm flag,
   * push the current list onto the undo stack, pop the redo stack).
   * Returns null when there is nothing to redo.
   */
  redo(current: SavedOverlay[]): SavedOverlay[] | null {
    this.pendingArmPush = false;
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    this.emitChange();
    return next;
  }

  /**
   * G-11: pop back the pre-draw history push for the arm in
   * progress. Called wherever an unfinished draw is discarded (Esc,
   * disarm, tool switch, clear-all); a no-op once the draw has
   * ended (flag already cleared).
   */
  cancelPendingArmPush(): void {
    if (!this.pendingArmPush) return;
    this.pendingArmPush = false;
    this.undoStack.pop();
    this.emitChange();
  }

  /**
   * G-11: mark the arm's pre-draw push as pending — a later cancel
   * of the unfinished draw pops it back. The preset (programmatic
   * create) path never marks: its push is never pending.
   */
  markArmPushPending(): void {
    this.pendingArmPush = true;
  }

  /**
   * G-11: the draw succeeded, so the arm's pre-draw history push
   * stays — clear the pending flag without popping.
   */
  confirmArmPush(): void {
    this.pendingArmPush = false;
  }

  /**
   * Drop all history (symbol/interval switch: history is per view).
   * Clears both stacks and the pending-arm flag, then notifies.
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingArmPush = false;
    this.emitChange();
  }

  /** Record the pre-move snapshot at press start. */
  setMoveStartSnapshot(snapshot: SavedOverlay[]): void {
    this.moveStartSnapshot = snapshot;
  }

  /**
   * Consume the pre-move snapshot at move end (clears the slot);
   * returns null when no press started one.
   */
  takeMoveStartSnapshot(): SavedOverlay[] | null {
    const snapshot = this.moveStartSnapshot;
    this.moveStartSnapshot = null;
    return snapshot;
  }
}
