import { describe, it, expect } from 'vitest';
import { AgentBudget, type BudgetHost } from '../AgentBudget';
import { TAX_RATE_MAX, TAX_RATE_MIN, type TaxRates } from '../../core/economy/Tax';

/**
 * 稅率與貸款。
 *
 * 這兩件事改下去**馬上**影響市庫，而且沒有 undo。所以這一層的重點全在把關:
 * 稅率只收滑桿放得下的整數，借還款只收正整數。
 */

function fakeHost(over: Partial<BudgetHost> = {}) {
  const rates: TaxRates = { residential: 9, commercial: 9, industrial: 9, office: 9, business: 9 };
  const state = { funds: 50_000, loans: 0 };
  const host: BudgetHost & { rates: TaxRates } = {
    rates,
    taxRates: () => rates,
    setIncomeTax(r: number) { rates.residential = r; },
    setBusinessTax(r: number) {
      rates.business = r; rates.commercial = r; rates.industrial = r; rates.office = r;
    },
    funds: () => state.funds,
    loans: () => state.loans,
    takeLoan(n: number) { state.funds += n; state.loans += n; },
    repayLoan(n: number) {
      const actual = Math.min(n, state.loans, state.funds);
      state.funds -= actual; state.loans -= actual;
    },
    ...over,
  };
  return { budget: new AgentBudget(host), rates, state };
}

describe('稅率', () => {
  it('should report both knobs and the range they accept', () => {
    const { budget } = fakeHost();
    expect(budget.taxes()).toMatchObject({
      incomeTax: 9, businessTax: 9, min: TAX_RATE_MIN, max: TAX_RATE_MAX,
    });
  });

  it('should set the income tax', () => {
    const { budget, rates } = fakeHost();
    expect(budget.setIncomeTax(15)).toMatchObject({ ok: true, incomeTax: 15 });
    expect(rates.residential).toBe(15);
  });

  it('should move every business rate together', () => {
    // 面板的「Business Tax」一根滑桿同時設四個欄位。只設 business 的話,
    // 舊的逐區稅率會留在原地,而它們還在被計算。
    const { budget, rates } = fakeHost();
    budget.setBusinessTax(4);

    expect(rates).toMatchObject({ business: 4, commercial: 4, industrial: 4, office: 4 });
    expect(rates.residential, '把所得稅也一起改了').toBe(9);
  });

  it('should refuse a rate the slider could not produce', () => {
    const { budget, rates } = fakeHost();

    for (const bad of [0, -3, TAX_RATE_MAX + 1, 7.5, NaN]) {
      expect(budget.setIncomeTax(bad).ok, `接受了 ${bad}`).toBe(false);
    }
    expect(rates.residential, '擋下來了卻還是寫進去').toBe(9);
  });

  it('should accept both ends of the range', () => {
    const { budget } = fakeHost();
    expect(budget.setIncomeTax(TAX_RATE_MIN).ok).toBe(true);
    expect(budget.setBusinessTax(TAX_RATE_MAX).ok).toBe(true);
  });
});

describe('貸款', () => {
  it('should report what is owed', () => {
    const { budget } = fakeHost();
    expect(budget.debt()).toMatchObject({ funds: 50_000, loans: 0 });
  });

  it('should borrow and report the new debt', () => {
    const { budget, state } = fakeHost();
    const r = budget.takeLoan(10_000);

    expect(r).toMatchObject({ ok: true, loans: 10_000, funds: 60_000 });
    expect(state.loans).toBe(10_000);
  });

  it('should repay and report what is left', () => {
    const { budget } = fakeHost();
    budget.takeLoan(10_000);

    expect(budget.repayLoan(4_000)).toMatchObject({ ok: true, loans: 6_000 });
  });

  it('should refuse an amount that is not a positive whole number of dollars', () => {
    const { budget, state } = fakeHost();

    for (const bad of [0, -100, 12.5, NaN, Infinity]) {
      expect(budget.takeLoan(bad).ok, `借了 ${bad}`).toBe(false);
      expect(budget.repayLoan(bad).ok, `還了 ${bad}`).toBe(false);
    }
    expect(state.loans).toBe(0);
    expect(state.funds).toBe(50_000);
  });

  it('should say so when there is nothing to repay', () => {
    // 遊戲的 repayLoan 會靜靜地夾成 0 —— 那會回一個什麼都沒發生的 ok:true。
    const { budget } = fakeHost();
    const r = budget.repayLoan(1_000);

    expect(r.ok).toBe(false);
    // 這一句要講「沒有債」，不是「欠 $0 還不了 $1000」—— 後者在讀的人眼裡像是
    // 金額算錯了。
    expect(r.reason, '沒說是根本沒有債').toContain('no debt');
  });

  it('should refuse to repay more than is owed even with money to spare', () => {
    // 錢很多、債很少。這一段只有「還得比欠的多」這一關擋得住。
    const { budget } = fakeHost();
    budget.takeLoan(10_000);

    const r = budget.repayLoan(50_000);
    expect(r.ok, '還了比欠的還多').toBe(false);
    expect(r.reason).toContain('10000');
    expect(budget.debt().loans, '多還的錢憑空消失了').toBe(10_000);
  });

  it('should refuse to repay more than is on hand', () => {
    // 債很多、錢很少。這一段只有「手上沒那麼多錢」這一關擋得住。
    const { budget } = fakeHost({ funds: () => 500, loans: () => 10_000 });
    const r = budget.repayLoan(4_000);

    expect(r.ok, '付了付不出來的錢').toBe(false);
    expect(r.reason).toContain('500');
  });
});
