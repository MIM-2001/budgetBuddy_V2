import { randomUUID } from 'node:crypto';
import { parseDate, monthEnd, validAmount } from './helpers.js';

export class Transaction {
  constructor(details) {
    if (!['income', 'expense'].includes(details.type)) throw new Error('Choose income or expense.');
    if (!details.name?.trim()) throw new Error('A transaction needs a name.');
    validAmount(details.amount);
    parseDate(details.date);
    this.id = details.id || randomUUID();
    this.type = details.type;
    this.name = details.name.trim();
    this.amount = details.amount;
    this.date = details.date;
    this.categoryId = details.categoryId || '';
    this.recurringId = details.recurringId || '';
  }
}

export class BudgetCategory {
  constructor(name, amount, flexible, createdAt, id = randomUUID()) {
    if (!name?.trim()) throw new Error('A category needs a name.');
    validAmount(amount, true);
    parseDate(createdAt);
    this.id = id;
    this.name = name.trim();
    this.amount = amount;
    this.flexible = Boolean(flexible);
    this.createdAt = createdAt;
  }

  setBudget(amount) {
    validAmount(amount, true);
    this.amount = amount;
  }
}

export class Account {
  constructor(historyStart) {
    parseDate(historyStart);
    this.historyStart = historyStart;
    this.setupComplete = false;
    this.setupStage = 'income';
    this.transactions = [];
    this.categories = [];
    this.deletedOccurrences = [];
    this.challengeResponses = [];
  }

  addCategory(name, amount, flexible, date) {
    if (this.categories.some(c => c.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new Error('That category name already exists.');
    }
    const category = new BudgetCategory(name, amount, flexible, date);
    this.categories.push(category);
    return category;
  }

  getCategory(id) {
    const category = this.categories.find(c => c.id === id);
    if (!category) throw new Error('Category not found.');
    return category;
  }

  addTransaction(details, date) {
    const transaction = new Transaction(details);
    parseDate(date);
    if (transaction.date > date) throw new Error('Actual transactions cannot be in the future. Use a recurring rule.');
    if (transaction.type === 'expense') this.getCategory(transaction.categoryId);
    if (this.transactions.some(t => t.id === transaction.id)) return false;
    if (this.deletedOccurrences.includes(transaction.id)) return false;
    this.transactions.push(transaction);
    return transaction;
  }

  deleteTransaction(id) {
    const transaction = this.transactions.find(t => t.id === id);
    if (!transaction) throw new Error('Transaction not found.');
    if (transaction.recurringId) this.deletedOccurrences.push(transaction.id);
    this.transactions = this.transactions.filter(t => t.id !== id);
  }

  spentBetween(categoryId, from, through) {
    let total = 0;
    for (const transaction of this.transactions) {
      if (transaction.type === 'expense' && transaction.date >= from && transaction.date <= through) {
        if (!categoryId || transaction.categoryId === categoryId) total += transaction.amount;
      }
    }
    return total;
  }

  monthlySpent(date, categoryId = '') {
    return this.spentBetween(categoryId, date.slice(0, 7) + '-01', date);
  }

  monthlyIncome(calendar, date) {
    let total = 0;
    // Preserve the website's normalized income estimate, not bank cash.
    for (const rule of calendar.rules) {
      if (rule.active && rule.type === 'income' && rule.startDate <= monthEnd(date)) {
        total += rule.monthlyValue();
      }
    }
    for (const transaction of this.transactions) {
      if (transaction.type !== 'income' || transaction.date.slice(0, 7) !== date.slice(0, 7)) continue;
      const rule = calendar.rules.find(r => r.id === transaction.recurringId);
      // Active recurring deposits are already covered by the estimate above.
      if (!rule || !rule.active) total += transaction.amount;
    }
    return total;
  }

  createStarterBudgets(calendar, date) {
    if (this.categories.length > 0) throw new Error('Starter budgets are only created for an empty budget list.');
    const income = this.monthlyIncome(calendar, date);
    const needs = Math.round(income * 0.50);
    const wants = Math.round(income * 0.30);
    this.addCategory('Needs', needs, false, date);
    this.addCategory('Wants', wants, true, date);
    this.addCategory('Savings', income - needs - wants, false, date);
  }
}
