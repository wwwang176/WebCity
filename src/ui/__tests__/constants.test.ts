import { describe, it, expect } from 'vitest';
import { CHART_HISTORY_LENGTH } from '../constants';

describe('UI constants', () => {
  it('CHART_HISTORY_LENGTH should be 60', () => {
    expect(CHART_HISTORY_LENGTH).toBe(60);
  });
});
