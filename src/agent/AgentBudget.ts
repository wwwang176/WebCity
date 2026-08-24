import { TAX_RATE_MAX, TAX_RATE_MIN, type TaxRates } from '../core/economy/Tax';

/**
 * Tax rates and loans.
 *
 * ## Why there are only two tax dials
 *
 * `TaxRates` has five fields but the panel has two sliders: income tax (`residential`) and
 * business tax (`business` plus three older per-zone fields). The older fields are still used
 * in the calculation, so **business tax must move all four together**: setting only `business`
 * leaves commercial zones paying the old rate with nothing visible in the panel.
 *
 * Exposing the fields individually would let a program reach states the panel cannot represent
 * (commercial 5%, industrial 12%), at which point the sliders would be lying. So this exposes
 * the panel's shape.
 *
 * ## Loans have no ceiling
 *
 * Borrowing is **reversible** — it can be repaid — unlike demolishing a building. Inventing a
 * maximum would take knowledge of this economy model, and a guessed number is worse than none.
 * What is rejected is the type: anything that is not a positive integer.
 */

export interface BudgetHost {
  taxRates(): Readonly<TaxRates>;
  setIncomeTax(rate: number): void;
  setBusinessTax(rate: number): void;
  funds(): number;
  loans(): number;
  takeLoan(amount: number): void;
  repayLoan(amount: number): void;
}

export interface TaxInfo {
  incomeTax: number;
  businessTax: number;
  min: number;
  max: number;
}

export interface TaxResult {
  ok: boolean;
  incomeTax: number;
  businessTax: number;
  reason?: string;
}

export interface DebtInfo {
  funds: number;
  loans: number;
}

export interface DebtResult extends DebtInfo {
  ok: boolean;
  reason?: string;
}

/** Rates the slider can represent: integers from `TAX_RATE_MIN` to `TAX_RATE_MAX`. */
function badRate(rate: number): string | null {
  if (!Number.isInteger(rate)) return `tax rate must be a whole percent: ${rate}`;
  if (rate < TAX_RATE_MIN || rate > TAX_RATE_MAX) {
    return `tax rate must be between ${TAX_RATE_MIN} and ${TAX_RATE_MAX}: ${rate}`;
  }
  return null;
}

function badAmount(amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) {
    return `amount must be a positive whole number of dollars: ${amount}`;
  }
  return null;
}

export class AgentBudget {
  constructor(private readonly host: BudgetHost) {}

  /** Where the two dials currently sit, and the range they accept. */
  taxes(): TaxInfo {
    const r = this.host.taxRates();
    return {
      incomeTax: r.residential,
      businessTax: r.business,
      min: TAX_RATE_MIN,
      max: TAX_RATE_MAX,
    };
  }

  /** Income tax, on residential zones. */
  setIncomeTax(rate: number): TaxResult {
    const bad = badRate(rate);
    if (bad) return { ok: false, ...this.rates(), reason: bad };
    this.host.setIncomeTax(rate);
    return { ok: true, ...this.rates() };
  }

  /** Business tax. Moves all four fields together, since the older per-zone ones are still
   *  used in the calculation. */
  setBusinessTax(rate: number): TaxResult {
    const bad = badRate(rate);
    if (bad) return { ok: false, ...this.rates(), reason: bad };
    this.host.setBusinessTax(rate);
    return { ok: true, ...this.rates() };
  }

  /** Cash on hand and debt outstanding. */
  debt(): DebtInfo {
    return { funds: Math.floor(this.host.funds()), loans: Math.round(this.host.loans()) };
  }

  takeLoan(amount: number): DebtResult {
    const bad = badAmount(amount);
    if (bad) return { ok: false, ...this.debt(), reason: bad };
    this.host.takeLoan(amount);
    return { ok: true, ...this.debt() };
  }

  /**
   * Repays part of the debt.
   *
   * The game's `repayLoan` **silently** clamps the amount to what is owed and what is on hand,
   * so repaying with no debt does nothing and says nothing. That kind of `ok: true` is harder
   * to diagnose than an error, so the conditions are checked first.
   */
  repayLoan(amount: number): DebtResult {
    const bad = badAmount(amount);
    if (bad) return { ok: false, ...this.debt(), reason: bad };

    const before = this.debt();
    if (before.loans <= 0) {
      return { ok: false, ...before, reason: 'there is no debt to repay' };
    }
    if (amount > before.loans) {
      return { ok: false, ...before, reason: `owed $${before.loans}, cannot repay $${amount}` };
    }
    if (amount > before.funds) {
      return { ok: false, ...before, reason: `only $${before.funds} on hand, cannot repay $${amount}` };
    }

    this.host.repayLoan(amount);
    return { ok: true, ...this.debt() };
  }

  private rates(): { incomeTax: number; businessTax: number } {
    const r = this.host.taxRates();
    return { incomeTax: r.residential, businessTax: r.business };
  }
}
