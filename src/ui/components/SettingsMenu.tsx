import { createSignal } from 'solid-js';

// Shared signal so the button in SpeedControls can open the modal in GameUI
const [settingsOpen, setSettingsOpen] = createSignal(false);

export { settingsOpen };

export function toggleSettings() {
  setSettingsOpen(prev => !prev);
}

export function closeSettings() {
  setSettingsOpen(false);
}

export function SettingsButton() {
  return (
    <button
      id="settings-btn"
      title="Settings"
      aria-label="Open settings menu"
      onClick={toggleSettings}
      innerHTML="&#9881;"
    />
  );
}
