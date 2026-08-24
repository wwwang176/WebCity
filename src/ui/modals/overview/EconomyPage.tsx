import { createSignal, createEffect, createMemo, For, Index, Show } from 'solid-js';
import { listPolicyExpenses } from '../../../core/economy/ExpenseCalculator';
import { panelIncomeTotal } from '../../../core/economy/EconomyBreakdown';
import { billableDistricts } from '../../../core/district/DistrictManager';
import { POLICY_CONFIG } from '../../../core/district/PolicyManager';
import { computeCityScales } from '../../../core/district/PolicyBilling';
import { policyLevelLabel } from '../../../core/district/PolicyPresentation';
import { CHART_RANGES, type ChartRange } from '../../../core/economy/ChartSeries';
import { TAX_RATE_MAX, TAX_RATE_MIN } from '../../../core/economy/Tax';
import { gameSignals, getGame } from '../../store/gameStore';
import { PopChart } from '../../charts/PopChart';
import { EconChart } from '../../charts/EconChart';

/** Ordered by span. An object's keys carry no meaningful order; the buttons' order does. */
const CHART_RANGE_ORDER: readonly ChartRange[] = ['week', 'month', 'year'];

interface EconomyPageProps {
  open: boolean;
}

export function EconomyPage(props: EconomyPageProps) {
  const [incomeTax, setIncomeTax] = createSignal(9);
  const [businessTax, setBusinessTax] = createSignal(9);
  const [version, setVersion] = createSignal(0);
  const [policyOpen, setPolicyOpen] = createSignal(false);
  const [chargeOpen, setChargeOpen] = createSignal(false);
  const [range, setRange] = createSignal<ChartRange>('month');

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

  const totalIncome = () => panelIncomeTotal(breakdown());
  const totalExpenses = () => {
    const b = breakdown();
    return b.roadMaintenance + b.loanInterest + b.powerCost + b.waterCost + b.transportCost
      + b.serviceCost + b.policyCost + b.elevatedMaintenance;
  };
  const balance = () => totalIncome() - totalExpenses();

  // Policy expenses line by line. The scale and this row's total come from one source so that the
  // two add up: a subsidy is charged per actual beneficiary, so the scale is not simply the
  // population.
  //
  // A memo, because the JSX reads one result three times — two lengths and the list — while
  // `listPolicyExpenses` rescans every policy of every district on each call.
  const policyLines = createMemo(() => {
    const st = state();
    // The districts' billing data is the same source settlement uses: computed separately, the tolls
    // in this breakdown do not match what the treasury actually receives.
    return listPolicyExpenses(
      getGame().getBillableDistricts(), st.ordinances,
      computeCityScales(st.citizens.getCitizens(),
        (x: number, y: number) => st.health.getCoverage(x, y)));
  });

  /** The policies with an operating cost, for the expense table. */
  const spendingLines = () => policyLines().filter(l => l.cost > 0);
  /** The policies with fee revenue, for the income table. */
  const earningLines = () => policyLines().filter(l => l.revenue > 0);

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
          {/* Policy fees. Only the congestion charge today: the more people still driving in the charged
              zone, the more it takes, so this row **falls** as the policy works.
              The two tables are each self-consistent: fees appear only in the income table, operating
              costs only in the expense table. Printed in both, the visible rows no longer add up to the
              total. */}
          <Show when={breakdown().policyRevenue > 0}>
            <tr
              onClick={() => setChargeOpen(v => !v)}
              style="cursor:pointer"
              title="展開逐條政策規費"
            >
              <td class="td-label">
                {chargeOpen() ? '\u25BE ' : '\u25B8 '}Policy Charges
              </td>
              <td class="td-value"></td>
              <td class="td-income" style="text-align:right">+${breakdown().policyRevenue.toFixed(1)}</td>
            </tr>
            <Show when={chargeOpen()}>
              <Index each={earningLines()}>
                {(line) => (
                  <tr>
                    <td class="td-label" style="padding-left:18px;color:#888;font-size:11px">
                      {line().districtName ?? 'City'} · {POLICY_CONFIG[line().type]?.name ?? line().type}
                      {' · '}{policyLevelLabel(line().type, line().level)}
                    </td>
                    <td class="td-value"></td>
                    <td class="td-income" style="text-align:right;font-size:11px">
                      +${line().revenue.toFixed(1)}
                    </td>
                  </tr>
                )}
              </Index>
            </Show>
          </Show>
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
            style={{ cursor: spendingLines().length > 0 ? 'pointer' : 'default' }}
            title={spendingLines().length > 0 ? '展開逐條政策支出' : undefined}
          >
            <td class="td-label">
              {spendingLines().length > 0 ? (policyOpen() ? '\u25BE ' : '\u25B8 ') : ''}Policies
            </td>
            <td class="td-expense" style="text-align:right">-${breakdown().policyCost.toFixed(1)}</td>
          </tr>
          {/* Given only a total, policies rising from $800 to $4,200 is something the player finds out
              afterwards. A decision needs the breakdown visible, which is also why this design sets no
              budget ceiling: a ceiling cuts policies for the player, and cuts them silently. */}
          <Show when={policyOpen()}>
            {/* `Index` rather than `For`. `listPolicyExpenses` returns fresh objects every tick and `For`
                compares by reference, so all the rows are torn down and rebuilt six times a second and
                the view flickers. `Index` keys by position, keeping the rows and replacing only the
                text. */}
            <Index each={spendingLines()}>
              {(line) => (
                <tr>
                  <td class="td-label" style="padding-left:18px;color:#888;font-size:11px">
                    {line().districtName ?? 'City'} · {POLICY_CONFIG[line().type]?.name ?? line().type}
                    {/* The same language as the intensity buttons. Drawn as dots, the player has to guess
                        which cell of the panel those two dots correspond to. */}
                    {' · '}{policyLevelLabel(line().type, line().level)}
                  </td>
                  {/* This is the expense table, so only the expense half is printed. The same policy's fees
                      are in the income table above; printed in both, the visible rows no longer add up to
                      the total and the collapsed row, expenses only, reads as a lie. */}
                  <td class="td-expense" style="text-align:right;color:#888;font-size:11px">
                    -${line().cost.toFixed(1)}
                  </td>
                </tr>
              )}
            </Index>
          </Show>
          <tr><td class="td-label">Elevated Maintenance</td><td class="td-expense" style="text-align:right">-${breakdown().elevatedMaintenance.toFixed(1)}</td></tr>
          <tr><td class="td-label">Loan Interest ({(state().budget.loanInterestRate * 100).toFixed(0)}%)</td><td class="td-expense" style="text-align:right">-${breakdown().loanInterest.toFixed(1)}</td></tr>
        </tbody>
      </table>

      <div class="section-title">Tax Rate</div>
      <div class="tax-row">
        <label>Residential Tax</label>
        <input type="range" min={TAX_RATE_MIN} max={TAX_RATE_MAX} step="1" value={incomeTax()} onInput={onIncomeTaxChange} />
        <span class="tax-val">{incomeTax()}%</span>
      </div>
      <div class="tax-row">
        <label>Business Tax</label>
        <input type="range" min={TAX_RATE_MIN} max={TAX_RATE_MAX} step="1" value={businessTax()} onInput={onBusinessTaxChange} />
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

      {/* One range governs both charts. They read the same span, and a separate choice each only
          produces mismatched views such as population by year against finances by week. */}
      <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span>History</span>
        <div style="display:flex;gap:4px">
          <For each={CHART_RANGE_ORDER}>
            {(r) => (
              <button
                onClick={() => setRange(r)}
                aria-pressed={range() === r}
                style={{
                  'font-size': '10px', padding: '2px 9px', 'border-radius': '4px',
                  cursor: 'pointer', 'text-transform': 'none', 'letter-spacing': '0',
                  border: `1px solid ${range() === r ? '#42a5f5' : '#334'}`,
                  background: range() === r ? 'rgba(66,165,245,0.18)' : 'transparent',
                  color: range() === r ? '#90caf9' : '#667a90',
                }}
              >
                {CHART_RANGES[r].label}
              </button>
            )}
          </For>
        </div>
      </div>

      <div style="font-size:10px;color:#667a90;margin:-4px 0 2px">Population</div>
      <PopChart history={gameSignals.chartHistory()} range={range()} />

      <div style="font-size:10px;color:#667a90;margin:-4px 0 2px">Funds, income and expenses</div>
      <EconChart history={gameSignals.chartHistory()} range={range()} />
    </>
  );
}
