import { saveGame } from './SaveManager';
import { classifySaveError, type SaveFailureKind } from './SaveFailure';

/** Main → Worker. */
export interface SaveRequest {
  type: 'SAVE';
  snapshot: unknown;
  slotId: number;
  name: string;
  population?: number;
}

/** Worker → Main. */
export interface SaveCompleteMessage {
  type: 'SAVE_COMPLETE';
  ok: boolean;
  slotId: number;
  /** Present only on failure. */
  kind?: SaveFailureKind;
  /** Present only on failure: the line to show the player. */
  error?: string;
  /** Present only on failure: the underlying error text, for the console. */
  detail?: string;
}

/**
 * The save worker's whole behaviour, as a plain function.
 *
 * The worker used to carry its own copy of `openDB` and its own transaction
 * wiring, and the copy had drifted: its `tx.onerror` rejected with
 * `tx.error ?? new Error('Save request failed')`, but at the moment a request
 * error fires the transaction has not aborted yet and `tx.error` is still null.
 * The real QuotaExceededError was thrown away and replaced by a placeholder on
 * the one path — autosave — where the player most needs to be told the truth.
 *
 * Deleting the copy and calling SaveManager.saveGame removes the drift by
 * construction, and makes the worker testable off the worker thread.
 */
export async function handleSaveRequest(
  msg: unknown,
  post: (m: SaveCompleteMessage) => void,
  write: typeof saveGame = saveGame,
): Promise<void> {
  if (!msg || typeof msg !== 'object') return;
  const req = msg as Partial<SaveRequest>;
  if (req.type !== 'SAVE') return;

  const slotId = req.slotId ?? 0;
  try {
    // Stringify inside the try: a snapshot carrying a cycle or a BigInt throws
    // here, and that failure has to reach the player too rather than becoming
    // an unhandled rejection in a worker nobody is listening to.
    const json = JSON.stringify(req.snapshot);
    await write(slotId, req.name ?? 'AutoSave', json, req.population);
    post({ type: 'SAVE_COMPLETE', ok: true, slotId });
  } catch (err) {
    const failure = classifySaveError(err);
    post({
      type: 'SAVE_COMPLETE', ok: false, slotId,
      kind: failure.kind, error: failure.message, detail: failure.detail,
    });
  }
}
