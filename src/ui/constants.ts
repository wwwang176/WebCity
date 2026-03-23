/** Maximum number of data points kept for chart history (population, economy) */
export const CHART_HISTORY_LENGTH = 60;

/** Shared UI color palette — status and accent colors used across 16+ UI files */
export const UI_COLORS = {
  /** Green — positive/good status */
  STATUS_GOOD: '#66bb6a',
  /** Orange — warning/medium status */
  STATUS_WARN: '#ffa726',
  /** Red — bad/critical status */
  STATUS_BAD: '#ef5350',
  /** Blue — primary accent */
  ACCENT: '#42a5f5',
  /** Neutral text */
  NEUTRAL: '#d0d8e8',
} as const;
