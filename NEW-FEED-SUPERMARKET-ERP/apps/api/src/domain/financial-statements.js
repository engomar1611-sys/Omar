const amount = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const normalBalance = (row) => {
  const debit = amount(row.total_debit);
  const credit = amount(row.total_credit);
  return ["asset", "expense"].includes(row.account_type) ? debit - credit : credit - debit;
};

export function buildTrialBalance(rows) {
  const accounts = rows.map((row) => {
    const net = round(amount(row.total_debit) - amount(row.total_credit));
    return {
      account_id: row.account_id,
      code: row.code,
      name_ar: row.name_ar,
      account_type: row.account_type,
      total_debit: round(amount(row.total_debit)),
      total_credit: round(amount(row.total_credit)),
      debit_balance: round(Math.max(net, 0)),
      credit_balance: round(Math.max(-net, 0))
    };
  }).filter((row) => row.total_debit !== 0 || row.total_credit !== 0);
  const totals = accounts.reduce((sum, row) => ({
    debit_movement: round(sum.debit_movement + row.total_debit),
    credit_movement: round(sum.credit_movement + row.total_credit),
    debit_balance: round(sum.debit_balance + row.debit_balance),
    credit_balance: round(sum.credit_balance + row.credit_balance)
  }), {debit_movement: 0, credit_movement: 0, debit_balance: 0, credit_balance: 0});
  return {
    items: accounts,
    totals,
    difference: round(totals.debit_balance - totals.credit_balance),
    balanced: Math.abs(totals.debit_balance - totals.credit_balance) <= 0.01
  };
}

export function buildIncomeStatement(rows) {
  const revenue = [];
  const expenses = [];
  for (const row of rows) {
    const balance = round(normalBalance(row));
    if (row.account_type === "revenue" && balance !== 0) revenue.push({...row, amount: balance});
    if (row.account_type === "expense" && balance !== 0) expenses.push({...row, amount: balance});
  }
  const totalRevenue = round(revenue.reduce((sum, row) => sum + row.amount, 0));
  const totalExpenses = round(expenses.reduce((sum, row) => sum + row.amount, 0));
  return {
    revenue,
    expenses,
    totals: {
      revenue: totalRevenue,
      expenses: totalExpenses,
      net_profit: round(totalRevenue - totalExpenses)
    }
  };
}

export function buildBalanceSheet(rows) {
  const assets = [];
  const liabilities = [];
  const equity = [];
  let revenue = 0;
  let expenses = 0;
  for (const row of rows) {
    const balance = round(normalBalance(row));
    if (row.account_type === "asset" && balance !== 0) assets.push({...row, amount: balance});
    if (row.account_type === "liability" && balance !== 0) liabilities.push({...row, amount: balance});
    if (row.account_type === "equity" && balance !== 0) equity.push({...row, amount: balance});
    if (row.account_type === "revenue") revenue += balance;
    if (row.account_type === "expense") expenses += balance;
  }
  const totalAssets = round(assets.reduce((sum, row) => sum + row.amount, 0));
  const totalLiabilities = round(liabilities.reduce((sum, row) => sum + row.amount, 0));
  const totalEquity = round(equity.reduce((sum, row) => sum + row.amount, 0));
  const accumulatedEarnings = round(revenue - expenses);
  const equityIncludingEarnings = round(totalEquity + accumulatedEarnings);
  const difference = round(totalAssets - totalLiabilities - equityIncludingEarnings);
  return {
    assets,
    liabilities,
    equity,
    accumulated_earnings: accumulatedEarnings,
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      equity: totalEquity,
      accumulated_earnings: accumulatedEarnings,
      equity_including_earnings: equityIncludingEarnings,
      liabilities_and_equity: round(totalLiabilities + equityIncludingEarnings)
    },
    difference,
    balanced: Math.abs(difference) <= 0.01
  };
}
