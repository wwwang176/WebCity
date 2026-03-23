import { describe, it, expect } from 'vitest';
import { CHART_HISTORY_LENGTH } from '../constants';
import { PALETTE, toCSS } from '../../ColorPalette';

describe('UI constants', () => {
  it('CHART_HISTORY_LENGTH should be 60', () => {
    expect(CHART_HISTORY_LENGTH).toBe(60);
  });
});

describe('ColorPalette', () => {
  it('toCSS should convert numeric hex to CSS string', () => {
    expect(toCSS(0x4caf50)).toBe('#4caf50');
    expect(toCSS(0xff9800)).toBe('#ff9800');
    expect(toCSS(0x000000)).toBe('#000000');
    expect(toCSS(0xffffff)).toBe('#ffffff');
  });

  it('PALETTE zone colors should be defined', () => {
    expect(PALETTE.ZONE.RES_LOW).toBe(0x4caf50);
    expect(PALETTE.ZONE.COM_LOW).toBe(0x2196f3);
    expect(PALETTE.ZONE.IND).toBe(0xffa726);
    expect(PALETTE.ZONE.OFFICE).toBe(0xab47bc);
  });

  it('PALETTE transport colors should be defined', () => {
    expect(PALETTE.TRANSPORT.BUS).toBe(0xff9800);
    expect(PALETTE.TRANSPORT.METRO).toBe(0x00bcd4);
    expect(PALETTE.TRANSPORT.RAIL).toBe(0xff5722);
    expect(PALETTE.TRANSPORT.FERRY).toBe(0x0097a7);
  });
});
