import { createSignal, createEffect, createMemo, For, Show, type Accessor } from 'solid-js';
import { listPolicyExpenses } from '../../../core/economy/ExpenseCalculator';
import { POLICY_CONFIG } from '../../../core/district/PolicyManager';
import { gameSignals, getGame } from '../../store/gameStore';
import { PopChart } from '../../charts/PopChart';
import { EconChart } from '../../charts/EconChart';

interface EconomyPageProps {
  open: boolean;
}

export function EconomyPage(props: EconomyPageProps) {
  const [incomeTax, setIncomeTax] = createSignal(9);
  const [businessTax, setBusinessTax] = createSignal(9);
  const [version, setVersion] = createSignal(0);
  const [policyOpen, setPolicyOpen] = createSignal(false);

  createEffect(() => {
    if (props.open) {
      const state = getGame().getState();
      setIncomeTax(state.taxRates.residential);
      setBusinessTax(state.taxRates.business);
      setVersion(v => v + 1);
    }
  });

  const breakdown = createMemo(() => {
    version();
    gameSignals.tick();
    return getGame().getEconomyBreakdown();
  }, undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  // NOT a memo with a JSON equality check. getState() returns the *same* mutated
  // object every call, so `equals` compared that object with itself and was
  // always true — Treasury and Outstanding loans froze at whatever they were
  // when the page opened, and adjusting tax or borrowing never updated them.
  // It also stringified the whole GameState — four Uint8Array(40000) in Grid
  // plus three Float64Array(40000) in PollutionManager, none with a toJSON —
  // twice per throttled tick, roughly 0.4 s/s of main-thread work and 33 MB/s of
  // garbage while the page was open (BUG-079). A plain accessor tracking the
  // same two signals is correct and free.
  const state = () => {
    version();
    gameSignals.tick();
    return getGame().getState();
  };

  const totalIncome = () => {
    const b = breakdown();
    return b.residential + b.commercial + b.industrial + b.office;
  };
  const totalExpenses = () => {
    const b = breakdown();
    return b.roadMaintenance + b.loanInterest + b.powerCost + b.waterCost + b.transportCost
      + b.serviceCost + b.policyCost + b.elevatedMaintenance;
  };
  const balance = () => totalIncome() - totalExpenses();

  // 逐條政策支出。人口與這一列的總額用同一個來源，兩者才加得起來。
  const policyLines = () => {
    const st = state();
    return listPolicyExpenses(
      st.districts.getAllDistricts(), st.ordinances, st.citizens.getPopulation());
  };

  const onIncomeTaxChange = (e: Event) => {
    const rate = parseInt((e.target as HTMLInputElement).value, 10);
    setIncomeTax(rate);
    getGame().getState().taxRates.residential = rate;
    setVersion(v => v + 1);
  };

  const onBusinessTaxChange = (e: Event) => {
    const rate = parseInt((e.target as HTMLInputElement).value, 10);
    setBusinessTax(rate);
    const taxes = getGame().getState().taxRates;
    taxes.business = rate;
    taxes.commercial = rate;
    taxes.industrial = rate;
    taxes.office = rate;
    setVersion(v => v + 1);
  };

  const takeLoan = (amount: number) => {
    getGame().takeLoan(amount);
    setVersion(v => v + 1);
  };

  const repayLoan = (amount: number) => {
    getGame().repayLoan(amount);
    setVersion(v => v + 1);
  };

  return (
    <>
      <div class="summary-grid">
        <div class="summary-card">
          <div class="sc-value">${Math.floor(state().budget.funds).toLocaleString()}</div>
          <div class="sc-label">Treasury</div>
        </div>
        <div class="summary-card">
          <div class="sc-value stat-positive">+${totalIncome().toFixed(1)}</div>
          <div class="sc-label">Income/tick</div>
        </div>
        <div class="summary-card">
          <div class="sc-value stat-negative">-${totalExpenses().toFixed(1)}</div>
          <div class="sc-label">Expenses/tick</div>
        </div>
        <div class="summary-card">
          <div class={`sc-value ${balance() >= 0 ? 'stat-positive' : 'stat-negative'}`}>${balance().toFixed(1)}</div>
          <div class="sc-label">Net Balance</div>
        </div>
      </div>

      <div class="section-title">Income Breakdown</div>
      <table class="data-table">
        <thead><tr><th>Source</th><th>Rate</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td class="td-label">Residential Tax</td><td class="td-value">{incomeTax()}%</td><td class="td-income" style="text-align:right">+${breakdown().residential.toFixed(1)}</td></tr>
          <tr><td class="td-label">Business Tax (Commercial)</td><td class="td-value">{businessTax()}%</td><td class="td-income" style="text-align:right">+${breakdown().commercial.toFixed(1)}</td></tr>
          <tr><td class="td-label">Business Tax (Industrial)</td><td class="td-value">{businessTax()}%</td><td class="td-income" style="text-align:right">+${breakdown().industrial.toFixed(1)}</td></tr>
          <tr><td class="td-label">Business Tax (Office)</td><td class="td-value">{businessTax()}%</td><td class="td-income" style="text-align:right">+${breakdown().office.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <div class="section-title">Expenses Breakdown</div>
      <table class="data-table">
        <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td class="td-label">Road Maintenance</td><td class="td-expense" style="text-align:right">-${breakdown().roadMaintenance.toFixed(1)}</td></tr>
          <tr><td class="td-label">Power Plants</td><td class="td-expense" style="text-align:right">-${breakdown().powerCost}</td></tr>
          <tr><td class="td-label">Water Plants</td><td class="td-expense" style="text-align:right">-${breakdown().waterCost}</td></tr>
          <tr><td class="td-label">Transport Operations</td><td class="td-expense" style="text-align:right">-${breakdown().transportCost}</td></tr>
          <tr><td class="td-label">Civic Services</td><td class="td-expense" style="text-align:right">-${breakdown().serviceCost.toFixed(1)}</td></tr>
          <tr
            onClick={() => setPolicyOpen(v => !v)}
            style={{ cursor: policyLines().length > 0 ? 'pointer' : 'default' }}
            title={policyLines().length > 0 ? '展開逐條政策支出' : undefined}
          >
            <td class="td-label">
              {policyLines().length > 0 ? (policyOpen() ? '\u25BE ' : '\u25B8 ') : ''}Policies
            </td>
            <td class="td-expense" style="text-align:right">-${breakdown().policyCost.toFixed(1)}</td>
          </tr>
          {/* 只給一個總額的話，「政策從 $800 漲到 $4,200」會是一個玩家事後才
              發現的坑。看得見才做得了決定 —— 這也是這套設計不設預算上限的
              前提:上限會替玩家自動砍掉政策，而且砍得無聲無息。 */}
          <Show when={policyOpen()}>
            <For each={policyLines()}>
              {(line) => (
                <tr>
                  <td class="td-label" style="padding-left:18px;color:#888;font-size:11px">
                    {line.districtName ?? 'City'} · {POLICY_CONFIG[line.type]?.name ?? line.type}
                    {' '}{'\u25CF'.repeat(line.level)}
                  </td>
                  <td class="td-expense" style="text-align:right;color:#888;font-size:11px">
                    -${line.cost.toFixed(1)}
                  </td>
                </tr>
              )}
            </For>
          </Show>
          <tr><td class="td-label">Elevated Maintenance</td><td class="td-expense" style="text-align:right">-${breakdown().elevatedMaintenance.toFixed(1)}</td></tr>
          <tr><td class="td-label">Loan Interest ({(state().budget.loanInterestRate * 100).toFixed(0)}%)</td><td class="td-expense" style="text-align:right">-${breakdown().loanInterest.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <div class="section-title">Tax Rate</div>
      <div class="tax-row">
        <label>Residential Tax</label>
        <input type="range" min="1" max="20" step="1" value={incomeTax()} onInput={onIncomeTaxChange} />
        <span class="tax-val">{incomeTax()}%</span>
      </div>
      <div class="tax-row">
        <label>Business Tax</label>
        <input type="range" min="1" max="20" step="1" value={businessTax()} onInput={onBusinessTaxChange} />
        <span class="tax-val">{businessTax()}%</span>
      </div>

      <div class="section-title">Loans</div>
      <div style="font-size:12px;color:#8899b0;margin-bottom:8px">
        Outstanding: <span style="color:#e4eaf4;font-weight:600">${state().budget.loans.toLocaleString()}</span>
      </div>
      <div class="loan-row">
        <button class="loan-btn" onClick={() => takeLoan(5000)}>Borrow $5,000</button>
        <button class="loan-btn" onClick={() => takeLoan(10000)}>Borrow $10,000</button>
        <button class="loan-btn" onClick={() => repayLoan(5000)}>Repay $5,000</button>
      </div>

      <div class="section-title">Population History</div>
      <PopChart history={gameSignals.chartHistory()} />

      <div class="section-title">Economic History</div>
      <EconChart history={gameSignals.econHistory()} />
    </>
  );
}
