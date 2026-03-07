export interface BudgetState {
  funds: number;
  income: number;
  expenses: number;
  loans: number;
  loanInterestRate: number;
}

export function calculateBalance(budget: BudgetState): number {
  return budget.income - budget.expenses - (budget.loans * budget.loanInterestRate);
}

export function takeLoan(budget: BudgetState, amount: number): BudgetState {
  return {
    ...budget,
    funds: budget.funds + amount,
    loans: budget.loans + amount,
  };
}

export function tickBudget(budget: BudgetState): BudgetState {
  const balance = calculateBalance(budget);
  return {
    ...budget,
    funds: budget.funds + balance,
  };
}
