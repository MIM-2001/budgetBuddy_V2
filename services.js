import { validAmount } from './helpers.js';

export class MonthlyIncomeCalculator {
  constructor(account, calendar) {
    this.account = account;
    this.calendar = calendar;
  }

  calculate(date) {
    return this.account.monthlyIncome(this.calendar, date);
  }
}

export class MonthlyExpenseCalculator {
  constructor(account) {
    this.account = account;
  }

  calculate(date) {
    return this.account.monthlySpent(date);
  }

  forBudget(categoryId, date) {
    return this.account.monthlySpent(date, categoryId);
  }
}

export class SpendingService {
  constructor(account, incomeCalculator, expenseCalculator) {
    this.account = account;
    this.incomeCalculator = incomeCalculator;
    this.expenseCalculator = expenseCalculator;
  }

  summary(date) {
    const income = this.incomeCalculator.calculate(date);
    const spent = this.expenseCalculator.calculate(date);
    return { income, spent, left: income - spent };
  }

  budgetRemaining(categoryId, date) {
    const category = this.account.getCategory(categoryId);
    return category.amount - this.expenseCalculator.forBudget(categoryId, date);
  }
}

export class RecurringService {
  constructor(account, calendar) {
    this.account = account;
    this.calendar = calendar;
  }

  recordDue(date) {
    return this.calendar.processDue(this.account, date);
  }

  unpaidBills(date) {
    return this.calendar.upcomingBills(date);
  }

  unpaidTotal(date) {
    let total = 0;
    for (const bill of this.unpaidBills(date)) total += bill.amount;
    return total;
  }

  add(item, date) {
    if (item.type === 'expense') this.account.getCategory(item.categoryId);
    this.calendar.addRule(item);
    return this.recordDue(date);
  }

  stop(id) {
    this.calendar.stopRule(id);
  }

  changeAmount(id, amount) {
    this.calendar.changeAmount(id, amount);
  }
}

const BUFFER_PERCENT = 0.10;
const TIGHT_PERCENT = 0.80;

export class AffordabilityService {
  constructor(spendingService, recurringService) {
    this.spendingService = spendingService;
    this.recurringService = recurringService;
  }

  getSafeToSpend(date) {
    const summary = this.spendingService.summary(date);
    const bills = this.recurringService.unpaidTotal(date);
    const buffer = Math.round(summary.income * BUFFER_PERCENT);
    const safe = Math.max(0, summary.left - bills - buffer);
    return { income: summary.income, left: summary.left, bills, buffer, safe };
  }

  evaluatePurchase(price, categoryId, date) {
    validAmount(price);
    const numbers = this.getSafeToSpend(date);
    // Return data; only the view formats messages or prints to the terminal.
    const shortfall = Math.max(0, price - numbers.safe);
    const result = { price, numbers, remaining: numbers.safe - price, shortfall,
      weeklySaving4: Math.ceil(shortfall / 4), weeklySaving8: Math.ceil(shortfall / 8),
      answer: 'yes', reason: 'Fits within the checked allowances.' };
    if (price > numbers.safe) {
      result.answer = 'no';
      result.reason = 'Above the overall allowance.';
      return result;
    }
    if (price >= numbers.safe * TIGHT_PERCENT) {
      result.answer = 'tight';
      result.reason = 'Uses at least 80% of the allowance.';
      if (categoryId) result.categoryRemaining = this.spendingService.budgetRemaining(categoryId, date);
      return result;
    }
    if (categoryId) {
      result.categoryRemaining = this.spendingService.budgetRemaining(categoryId, date);
      if (price > result.categoryRemaining) {
        result.answer = 'tight';
        result.reason = 'Above the remaining category budget.';
      }
    }
    return result;
  }
}
