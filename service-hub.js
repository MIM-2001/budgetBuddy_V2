import { MonthlyIncomeCalculator, MonthlyExpenseCalculator, SpendingService,
  RecurringService, AffordabilityService } from './services.js';
import { ChallengesService } from './challenges.js';
import { daysBetween } from './helpers.js';

// Facade: controllers use this one entry point instead of reaching into models,
// services or DAOs. Services apply the rules; DAOs store what changed.
export class ServiceHub {
  constructor(account, calendar, daos = null) {
    this.account = account;
    this.calendar = calendar;
    this.daos = daos;
    this.incomeCalculator = new MonthlyIncomeCalculator(account, calendar);
    this.expenseCalculator = new MonthlyExpenseCalculator(account);
    this.spendingService = new SpendingService(account, this.incomeCalculator, this.expenseCalculator);
    this.recurringService = new RecurringService(account, calendar);
    this.affordabilityService = new AffordabilityService(this.spendingService, this.recurringService);
    this.challengesService = new ChallengesService(account);
  }

  canAfford(price, categoryId, date) {
    return this.affordabilityService.evaluatePurchase(price, categoryId, date);
  }

  refresh(date) {
    const count = this.recurringService.recordDue(date);
    this.storeSchedule();
    return count;
  }

  // Makes one action's changes through the DAOs, then writes the file once.
  store(change) {
    if (!this.daos) return; // Tests can run the rules without saved data.
    change(this.daos);
    this.daos.commit();
  }

  // A schedule can add rules, record payments and move next dates.
  storeSchedule() {
    this.store(daos => {
      daos.recurring.insertMissing(this.calendar.rules);
      for (const rule of this.calendar.rules) daos.recurring.update(rule);
      daos.transactions.insertMissing(this.account.transactions);
    });
  }

  setupState() {
    return { complete: this.account.setupComplete, stage: this.account.setupStage };
  }

  finishIncomeSetup(date) {
    if (this.account.categories.length === 0) this.account.createStarterBudgets(this.calendar, date);
    this.account.setupStage = 'expenses';
    this.store(daos => {
      daos.budgets.insertMissing(this.account.categories);
      daos.accounts.update(this.account);
    });
  }

  finishSetup() {
    this.account.setupComplete = true;
    this.account.setupStage = 'complete';
    this.store(daos => daos.accounts.update(this.account));
  }

  getBudgets(date) {
    return this.account.categories.map(category => ({
      id: category.id, name: category.name, amount: category.amount, flexible: category.flexible,
      spent: this.expenseCalculator.forBudget(category.id, date)
    }));
  }

  saveBudget(item, date) {
    if (item.id) {
      const category = this.account.getCategory(item.id);
      category.setBudget(item.amount);
      category.flexible = item.flexible;
      this.store(daos => daos.budgets.update(category));
    } else {
      const category = this.account.addCategory(item.name, item.amount, item.flexible, date);
      this.store(daos => daos.budgets.insert(category));
    }
  }

  getTransactions() {
    return this.account.transactions.map(transaction => ({
      id: transaction.id, date: transaction.date, name: transaction.name,
      amount: transaction.amount, type: transaction.type, recurring: Boolean(transaction.recurringId),
      categoryName: transaction.categoryId ? this.account.getCategory(transaction.categoryId).name : ''
    })).reverse().sort((a, b) => b.date.localeCompare(a.date));
  }

  saveTransaction(item, date) {
    let recorded = 0;
    if (item.repeating) {
      recorded = this.recurringService.add(item, date);
      this.storeSchedule();
    } else {
      const transaction = this.account.addTransaction(item, date);
      if (transaction) this.store(daos => daos.transactions.insert(transaction)); // false = duplicate
    }
    return { repeating: item.repeating, recorded };
  }

  deleteTransaction(id) {
    this.account.deleteTransaction(id);
    this.store(daos => {
      daos.transactions.delete(id);
      daos.accounts.update(this.account); // Remembers deleted recurring payments.
    });
  }

  getRecurringItems() {
    return this.calendar.rules.map(rule => ({
      id: rule.id, name: rule.name, type: rule.type, amount: rule.amount,
      frequency: rule.frequency, days: rule.days.slice(), nextDate: rule.nextDate, active: rule.active
    }));
  }

  stopRecurring(id) {
    this.recurringService.stop(id);
    this.store(daos => daos.recurring.update(this.calendar.getRule(id)));
  }

  changeRecurringAmount(id, amount) {
    this.recurringService.changeAmount(id, amount);
    this.store(daos => daos.recurring.update(this.calendar.getRule(id)));
  }

  getDashboard(date) {
    const numbers = this.affordabilityService.getSafeToSpend(date);
    const budgets = this.getBudgets(date);
    const allocated = budgets.reduce((total, category) => total + category.amount, 0);
    return { ...numbers, spent: this.expenseCalculator.calculate(date), budgets,
      overAllocated: allocated > numbers.income };
  }

  getChallenges(date) {
    const daysRemaining = Math.max(0, 28 - daysBetween(this.account.historyStart, date));
    const ideas = this.challengesService.suggest(date).map(idea => ({ ...idea,
      categoryName: this.account.getCategory(idea.categoryId).name }));
    return { daysRemaining, ideas };
  }

  respondToChallenge(idea, accept, date) {
    if (accept) this.challengesService.accept(idea, date);
    else this.challengesService.deny(idea, date);
    this.store(daos => {
      if (accept) daos.budgets.update(this.account.getCategory(idea.categoryId));
      daos.accounts.update(this.account); // Remembers the answer.
    });
  }
}
