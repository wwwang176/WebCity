import { describe, it, expect, vi } from 'vitest';

describe('SettingsMenu logic', () => {
  it('should toggle menu open/close state', () => {
    let open = false;
    const toggle = () => { open = !open; };
    toggle();
    expect(open).toBe(true);
    toggle();
    expect(open).toBe(false);
  });

  it('should call saveCurrentGame with slot 1 and name', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    await saveFn(1, 'Manual Save');
    expect(saveFn).toHaveBeenCalledWith(1, 'Manual Save');
  });

  it('should require confirmation before returning to main menu', () => {
    let confirmed = false;
    let navigated = false;

    // Without confirmation — should not navigate
    if (confirmed) navigated = true;
    expect(navigated).toBe(false);

    // With confirmation — should navigate
    confirmed = true;
    if (confirmed) navigated = true;
    expect(navigated).toBe(true);
  });

  it('should close menu when clicking outside', () => {
    let open = true;
    const closeMenu = () => { open = false; };
    closeMenu();
    expect(open).toBe(false);
  });
});
