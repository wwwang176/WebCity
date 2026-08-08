/**
 * Save Worker — performs JSON.stringify + IndexedDB write off the main thread.
 *
 * Main → Worker:
 *   { type: 'SAVE', snapshot: object, slotId: number, name: string, population?: number }
 *
 * Worker → Main:
 *   { type: 'SAVE_COMPLETE', ok: boolean, slotId, kind?, error?, detail? }
 *
 * All of the behaviour lives in core/save/SaveWorkerHandler so it can be tested
 * off the worker thread; this file is only the message plumbing.
 */
import { handleSaveRequest, type SaveCompleteMessage } from '../core/save/SaveWorkerHandler';

self.onmessage = (e: MessageEvent) => {
  void handleSaveRequest(e.data, (m: SaveCompleteMessage) => {
    (self as unknown as Worker).postMessage(m);
  });
};
