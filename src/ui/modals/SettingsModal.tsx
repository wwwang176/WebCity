import { createEffect, createSignal } from 'solid-js';
import { getGame } from '../store/gameStore';
import { settingsOpen, closeSettings } from '../components/SettingsMenu';
import { listSaves } from '../../core/save/SaveManager';
import { classifySaveError } from '../../core/save/SaveFailure';
import { Modal } from './Modal';
import { importSaveFromFile } from '../../core/save/ImportExport';

export function SettingsModal(props: { onOpenDebug?: () => void }) {
  const [saving, setSaving] = createSignal(false);
  const [showConfirm, setShowConfirm] = createSignal(false);
  const [showSaveDialog, setShowSaveDialog] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');
  const [sfxOff, setSfxOff] = createSignal(false);
  const [musicOff, setMusicOff] = createSignal(false);

  // These labels used to be seeded with a hardcoded false and only ever updated by their own
  // click handler, so they described the toggles the player had pressed rather than the state
  // of the mixer. Music now starts muted, which made "Music: ON" a plain lie on first open.
  // Re-read the AudioManager every time the panel opens instead.
  createEffect(() => {
    if (!settingsOpen()) return;
    const audio = getGame().getAudioManager();
    setSfxOff(audio.isSfxMuted());
    setMusicOff(audio.isMusicMuted());
  });

  const close = () => {
    closeSettings();
    setShowConfirm(false);
    setShowSaveDialog(false);
  };

  const isNamedSlot = () => {
    const game = getGame();
    return game.loadedSlotId !== null && game.loadedSlotId > 0;
  };

  const handleSaveClick = async () => {
    if (saving()) return;
    if (isNamedSlot()) {
      // Loaded from a named save — overwrite directly
      await doSave(getGame().loadedSlotId!, getGame().loadedSaveName!);
    } else {
      // New game or AutoSave — prompt for name
      setSaveName('');
      setShowSaveDialog(true);
    }
  };

  const handleSaveAsClick = () => {
    if (saving()) return;
    setSaveName('');
    setShowSaveDialog(true);
  };

  const handleSaveConfirm = async () => {
    const name = saveName().trim();
    if (!name || saving()) return;
    // Find next available slot id (skip 0 = AutoSave). This `await` used to sit
    // outside any try: a rejection from listSaves became an unhandled promise
    // rejection, the dialog stayed open, and the player got no indication that
    // pressing Save had done nothing.
    let saves;
    try {
      saves = await listSaves();
    } catch (err) {
      getGame().showNotification(classifySaveError(err).message, 10);
      return;
    }
    const usedIds = saves.map(s => s.id);
    let slotId = 1;
    while (usedIds.includes(slotId)) slotId++;
    await doSave(slotId, name);
  };

  const doSave = async (slotId: number, name: string) => {
    setSaving(true);
    try {
      await getGame().saveCurrentGame(slotId, name);
      // Update tracked slot so subsequent saves overwrite the same slot
      getGame().loadedSlotId = slotId;
      getGame().loadedSaveName = name;
      getGame().showNotification('Game saved!');
    } catch (err) {
      // "Save failed" told the player nothing they could act on. Out of disk
      // and locked-by-another-tab need completely different responses.
      getGame().showNotification(classifySaveError(err).message, 10);
    }
    setSaving(false);
    close();
  };

  const cancelSaveDialog = () => setShowSaveDialog(false);
  const openConfirm = () => setShowConfirm(true);
  const cancelConfirm = () => setShowConfirm(false);
  const confirmReturn = () => window.location.reload();

  const handleExport = () => {
    getGame().exportCurrentGame();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.webcity.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      const result = await importSaveFromFile(content);
      if (result.success) {
        getGame().showNotification(`Save imported as "${result.saveName}". Load from main menu.`);
      } else {
        getGame().showNotification(`Import failed: ${(result.errors || []).join(', ')}`);
      }
      close();
    };
    input.click();
  };

  return (
    <>
      {/* Main settings modal */}
      <Modal
        id="settings-modal"
        title={'\u2699\uFE0F Settings'}
        open={settingsOpen() && !showConfirm() && !showSaveDialog()}
        onClose={close}
      >
        <div class="settings-modal-list">
          <button
            class="settings-modal-item"
            onClick={handleSaveClick}
            disabled={saving()}
          >
            <span class="settings-modal-icon">{'\uD83D\uDCBE'}</span>
            <span>{saving() ? 'Saving...' : 'Save Game'}</span>
          </button>

          <button
            class="settings-modal-item"
            onClick={handleSaveAsClick}
            disabled={saving()}
          >
            <span class="settings-modal-icon">{'\uD83D\uDCCB'}</span>
            <span>Save As...</span>
          </button>

          <button
            class="settings-modal-item"
            onClick={handleExport}
          >
            <span class="settings-modal-icon">{'\uD83D\uDCE4'}</span>
            <span>Export Save</span>
          </button>

          <button
            class="settings-modal-item"
            onClick={handleImport}
          >
            <span class="settings-modal-icon">{'\uD83D\uDCE5'}</span>
            <span>Import Save</span>
          </button>

          <div class="settings-modal-divider" />

          <button
            class="settings-modal-item"
            onClick={() => { setSfxOff(getGame().getAudioManager().toggleSfxMute()); }}
          >
            <span class="settings-modal-icon">{sfxOff() ? '\uD83D\uDD07' : '\uD83D\uDD0A'}</span>
            <span>Sound Effects: {sfxOff() ? 'OFF' : 'ON'}</span>
          </button>

          <button
            class="settings-modal-item"
            onClick={() => { setMusicOff(getGame().getAudioManager().toggleMusicMute()); }}
          >
            <span class="settings-modal-icon">{musicOff() ? '\uD83D\uDD07' : '\uD83C\uDFB5'}</span>
            <span>Music: {musicOff() ? 'OFF' : 'ON'}</span>
          </button>

          <div class="settings-modal-divider" />

          <button
            class="settings-modal-item"
            onClick={() => { close(); props.onOpenDebug?.(); }}
          >
            <span class="settings-modal-icon">{'\uD83D\uDD27'}</span>
            <span>Debug Tools</span>
          </button>

          <div class="settings-modal-divider" />

          <button
            class="settings-modal-item settings-modal-item--danger"
            onClick={openConfirm}
          >
            <span class="settings-modal-icon">{'\uD83C\uDFE0'}</span>
            <span>Return to Main Menu</span>
          </button>
        </div>
      </Modal>

      {/* Save name input modal */}
      <Modal
        id="save-dialog-modal"
        title={'\uD83D\uDCBE Save Game'}
        open={showSaveDialog()}
        onClose={cancelSaveDialog}
      >
        <div class="save-dialog-body">
          <label class="save-dialog-label" for="save-name-input">Save Name</label>
          <input
            id="save-name-input"
            class="save-dialog-input"
            type="text"
            placeholder="My City"
            maxLength={40}
            value={saveName()}
            onInput={(e) => setSaveName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveConfirm(); }}
          />
          <div class="settings-confirm-actions" style="margin-top:12px">
            <button
              class="settings-confirm-btn settings-confirm-btn--save"
              onClick={handleSaveConfirm}
              disabled={!saveName().trim() || saving()}
            >
              {saving() ? 'Saving...' : 'Save'}
            </button>
            <button class="settings-confirm-btn settings-confirm-btn--no" onClick={cancelSaveDialog}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm return to menu modal */}
      <Modal
        id="confirm-modal"
        title={'\u26A0\uFE0F Unsaved progress will be lost!'}
        open={showConfirm()}
        onClose={cancelConfirm}
      >
        <p class="confirm-modal-text">
          Are you sure you want to return to the main menu? Any unsaved progress will be lost.
        </p>
        <div class="settings-confirm-actions">
          <button class="settings-confirm-btn settings-confirm-btn--yes" onClick={confirmReturn}>
            Confirm
          </button>
          <button class="settings-confirm-btn settings-confirm-btn--no" onClick={cancelConfirm}>
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
