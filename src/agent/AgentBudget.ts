import { TAX_RATE_MAX, TAX_RATE_MIN, type TaxRates } from '../core/economy/Tax';

/**
 * 稅率與貸款。
 *
 * ## 為什麼稅率只有兩根旋鈕
 *
 * `TaxRates` 有五個欄位，但面板只有兩根滑桿:所得稅（`residential`）跟營業稅
 * （`business` 加上三個逐區的舊欄位）。舊欄位還在被計算，所以**營業稅一定要四個
 * 一起動** —— 只設 `business` 的話，商業區還是照著舊的稅率繳，而面板上看不出來。
 *
 * 逐欄位開放會讓程式做得出面板做不到的狀態（商業 5% 工業 12%），那時候滑桿顯示的
 * 就是謊話。所以這裡照著面板的形狀開。
 *
 * ## 借還款不設上限
 *
 * 借款是**可逆的**（還得掉），跟拆房子不一樣。憑空定一個「最多借多少」需要的是
 * 這個經濟模型的知識，猜一個數字比不設更糟。擋的是型別:非正整數。
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

/** 滑桿放得下的稅率:`TAX_RATE_MIN` ~ `TAX_RATE_MAX` 的整數。 */
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

  /** 兩根旋鈕現在的位置，以及收得下的範圍。 */
  taxes(): TaxInfo {
    const r = this.host.taxRates();
    return {
      incomeTax: r.residential,
      businessTax: r.business,
      min: TAX_RATE_MIN,
      max: TAX_RATE_MAX,
    };
  }

  /** 所得稅（住宅）。 */
  setIncomeTax(rate: number): TaxResult {
    const bad = badRate(rate);
    if (bad) return { ok: false, ...this.rates(), reason: bad };
    this.host.setIncomeTax(rate);
    return { ok: true, ...this.rates() };
  }

  /** 營業稅。商業、工業、辦公室四個欄位一起動 —— 舊欄位還在被計算。 */
  setBusinessTax(rate: number): TaxResult {
    const bad = badRate(rate);
    if (bad) return { ok: false, ...this.rates(), reason: bad };
    this.host.setBusinessTax(rate);
    return { ok: true, ...this.rates() };
  }

  /** 手上的錢與欠的錢。 */
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
   * 還款。
   *
   * 遊戲的 `repayLoan` 會**靜靜地**把金額夾到「欠的」跟「有的」之間 —— 沒欠錢時還款
   * 什麼都不會發生，也不會有任何訊息。那種 `ok: true` 比錯誤更難查，所以先問清楚。
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
