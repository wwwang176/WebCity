import { createSignal, createEffect, createMemo, For, Index, Show } from 'solid-js';
import { listPolicyExpenses } from '../../../core/economy/ExpenseCalculator';
import { panelIncomeTotal } from '../../../core/economy/EconomyBreakdown';
import { billableDistricts } from '../../../core/district/DistrictManager';
import { POLICY_CONFIG } from '../../../core/district/PolicyManager';
import { computeCityScales } from '../../../core/district/PolicyBilling';
import { policyLevelLabel } from '../../../core/district/PolicyPresentation';
import { CHART_RANGES, type ChartRange } from '../../../core/economy/ChartSeries';
import { gameSignals, getGame } from '../../store/gameStore';
import { PopChart } from '../../charts/PopChart';
import { EconChart } from '../../charts/EconChart';

/** 按時間長短排。物件的鍵沒有語意上的順序，按鈕的順序有。 */
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

  // 逐條政策支出。規模與這一列的總額用同一個來源，兩者才加得起來 —— 補貼型條例
  // 按實際受益人頭收費，所以規模不只是人口總數。
  //
  // 用 memo:同一次算出來的結果 JSX 裡讀三次（兩次 length、一次列表），而
  // `listPolicyExpenses` 每次都重新掃過所有分區的所有政策。
  const policyLines = createMemo(() => {
    const st = state();
    // 分區的計費資料跟結帳那一份是同一個來源 —— 各算各的話，明細裡的過路費會跟
    // 市庫實際入帳的對不起來。
    return listPolicyExpenses(
      getGame().getBillableDistricts(), st.ordinances,
      computeCityScales(st.citizens.getCitizens(),
        (x: number, y: number) => st.health.getCoverage(x, y)));
  });

  /** 有維運費的條例 —— 支出表用。 */
  const spendingLines = () => policyLines().filter(l => l.cost > 0);
  /** 有規費收入的條例 —— 收入表用。 */
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
          {/* 條例的規費。目前只有壅塞費 —— 收費區裡還在開車的人越多收得越多，
              所以這一列會隨著政策見效而**下降**。
              兩張表各自自洽:規費只出現在收入表，維運費只出現在支出表。同一筆錢
              在兩邊各印一次的話，玩家把看得見的列加起來會對不上總額。 */}
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
          {/* 只給一個總額的話，「政策從 $800 漲到 $4,200」會是一個玩家事後才
              發現的坑。看得見才做得了決定 —— 這也是這套設計不設預算上限的
              前提:上限會替玩家自動砍掉政策，而且砍得無聲無息。 */}
          <Show when={policyOpen()}>
            {/* `Index` 而不是 `For`。`listPolicyExpenses` 每個 tick 都回傳一批
                新物件，而 `For` 是照參考比對的 —— 於是每秒六次把所有列整批拆掉
                重建，畫面上就是一直在閃。`Index` 認位置，列留著、只換裡面的字。 */}
            <Index each={spendingLines()}>
              {(line) => (
                <tr>
                  <td class="td-label" style="padding-left:18px;color:#888;font-size:11px">
                    {line().districtName ?? 'City'} · {POLICY_CONFIG[line().type]?.name ?? line().type}
                    {/* 跟強度按鈕講同一套話。原本畫的是圓點，玩家得自己猜那兩個
                        圓點對應到面板上的哪一格。 */}
                    {' · '}{policyLevelLabel(line().type, line().level)}
                  </td>
                  {/* 這是支出表，所以只印支出那一半。同一條條例的規費在上面的
                      收入表裡 —— 兩邊各印一次的話，玩家把看得見的列加起來會對不上
                      總額，而收合起來的那一列（只有支出）看起來就像在說謊。 */}
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

      {/* 一個範圍管兩張圖。兩張讀的是同一段時間，各自一個選擇只會做出
          「人口看年、收支看週」這種對不起來的畫面。 */}
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
