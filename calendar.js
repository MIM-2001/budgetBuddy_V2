import { randomUUID } from 'node:crypto';
import { addDays, makeDate, monthEnd, parseDate, validAmount } from './helpers.js';

// This is the imported calendar module. No calendar grid or external package.
export class RecurringItem {
  constructor(details) {
    if (!['income', 'expense'].includes(details.type)) throw new Error('Choose income or expense.');
    if (!details.name?.trim()) throw new Error('A recurring item needs a name.');
    if (!['monthly', 'biweekly', 'days'].includes(details.frequency)) throw new Error('Unknown frequency.');
    validAmount(details.amount);
    parseDate(details.startDate);
    this.id = details.id || randomUUID();
    this.type = details.type;
    this.name = details.name.trim();
    this.amount = details.amount;
    this.categoryId = details.categoryId || '';
    this.frequency = details.frequency;
    this.startDate = details.startDate;
    this.active = details.active !== false;
    this.days = details.days || [];
    if (this.frequency === 'days') {
      if (!this.days.length || this.days.some(d => !Number.isInteger(d) || d < 1 || d > 31)) {
        throw new Error('Choose days from 1 to 31.');
      }
      this.days = [...new Set(this.days)].sort((a, b) => a - b);
      // Two end-of-month dates must not turn into the same February payment.
      if (new Set(this.days.map(day => Math.min(day, 28))).size !== this.days.length) {
        throw new Error('Selected days overlap in February. Use at most one day from 28 through 31.');
      }
    }
    this.nextDate = details.nextDate || this.firstDate();
    parseDate(this.nextDate);
  }

  firstDate() {
    if (this.frequency !== 'days') return this.startDate;
    return this.nextAfter(addDays(this.startDate, -1));
  }

  nextAfter(text) {
    if (this.frequency === 'biweekly') return addDays(text, 14);
    const date = parseDate(text);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (this.frequency === 'monthly') {
      const originalDay = parseDate(this.startDate).getUTCDate();
      return makeDate(year, month + 1, originalDay);
    }
    for (const day of this.days) {
      const candidate = makeDate(year, month, day);
      if (candidate > text) return candidate;
    }
    return makeDate(year, month + 1, this.days[0]);
  }

  monthlyValue() {
    if (this.frequency === 'biweekly') return Math.round(this.amount * 26 / 12);
    if (this.frequency === 'days') return this.amount * this.days.length;
    return this.amount;
  }
}

export class FinancialCalendar {
  constructor() {
    this.rules = [];
  }

  addRule(details) {
    const rule = new RecurringItem(details);
    this.rules.push(rule);
    return rule;
  }

  getRule(id) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) throw new Error('Recurring item not found.');
    return rule;
  }

  stopRule(id) {
    this.getRule(id).active = false;
  }

  changeAmount(id, amount) {
    validAmount(amount);
    this.getRule(id).amount = amount;
  }

  processDue(account, today) {
    parseDate(today);
    let count = 0;
    for (const rule of this.rules) {
      if (!rule.active) continue;
      while (rule.nextDate <= today) {
        const transaction = account.addTransaction({
          id: rule.id + ':' + rule.nextDate,
          type: rule.type, name: rule.name, amount: rule.amount,
          date: rule.nextDate, categoryId: rule.categoryId, recurringId: rule.id
        }, today);
        if (transaction) count++;
        rule.nextDate = rule.nextAfter(rule.nextDate);
      }
    }
    return count;
  }

  upcomingBills(today) {
    const bills = [];
    for (const rule of this.rules) {
      if (!rule.active || rule.type !== 'expense') continue;
      let date = rule.nextDate;
      while (date <= monthEnd(today)) {
        if (date > today) bills.push({ name: rule.name, date, amount: rule.amount });
        date = rule.nextAfter(date);
      }
    }
    return bills;
  }
}
