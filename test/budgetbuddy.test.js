import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account, Transaction, BudgetCategory } from '../account.js';
import { FinancialCalendar, RecurringItem } from '../calendar.js';
import { ServiceHub } from '../service-hub.js';
function createChecker(account, calendar) { return new ServiceHub(account, calendar).affordabilityService; }
import { ChallengesService as ChallengeManager } from '../challenges.js';
import { Storage } from '../storage.js';
import { DAOManager } from '../daos.js';

function fixture(date = '2026-11-24') {
  const account = new Account(date);
  const calendar = new FinancialCalendar();
  const category = account.addCategory('Wants', 50000, true, date);
  return { account, calendar, category };
}

test('monthly bills keep the 31st after February and never record twice', () => {
  const { account, calendar, category } = fixture('2028-01-01');
  calendar.addRule({ type: 'expense', name: 'Bill', amount: 10000,
    categoryId: category.id, frequency: 'monthly', startDate: '2028-01-31' });
  assert.equal(calendar.processDue(account, '2028-03-31'), 3);
  assert.deepEqual(account.transactions.map(t => t.date),
    ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.equal(calendar.processDue(account, '2028-03-31'), 0);
});

test('selected monthly dates and every two weeks produce different schedules', () => {
  const { account, calendar } = fixture('2026-01-01');
  calendar.addRule({ type: 'income', name: 'Job', amount: 10000,
    frequency: 'biweekly', startDate: '2026-01-01' });
  calendar.addRule({ type: 'income', name: 'Side job', amount: 5000,
    frequency: 'days', days: [1, 15], startDate: '2026-01-01' });
  calendar.processDue(account, '2026-01-31');
  assert.equal(account.transactions.filter(t => t.name === 'Job').length, 3);
  assert.equal(account.transactions.filter(t => t.name === 'Side job').length, 2);
  assert.equal(account.monthlyIncome(calendar, '2026-01-31'), 31667);
});

test('deleting one occurrence does not recreate it; stopping preserves history', () => {
  const { account, calendar } = fixture();
  const rule = calendar.addRule({ type: 'income', name: 'Job', amount: 10000,
    frequency: 'monthly', startDate: '2026-10-01' });
  calendar.processDue(account, '2026-11-24');
  const transaction = account.transactions.find(t => t.date === '2026-10-01');
  account.deleteTransaction(transaction.id);
  calendar.processDue(account, '2026-11-24');
  assert.equal(account.transactions.length, 1);
  calendar.stopRule(rule.id);
  calendar.processDue(account, '2026-12-24');
  assert.equal(account.transactions.length, 1);
  assert.equal(account.monthlyIncome(calendar, '2026-11-24'), 10000);
});

test('a due bill moves from upcoming to spent without changing safe to spend', () => {
  const { account, calendar, category } = fixture();
  calendar.addRule({ type: 'income', name: 'Job', amount: 200000,
    frequency: 'monthly', startDate: '2026-11-01' });
  calendar.addRule({ type: 'expense', name: 'Rent', amount: 40000,
    categoryId: category.id, frequency: 'monthly', startDate: '2026-11-25' });
  calendar.processDue(account, '2026-11-24');
  const checker = createChecker(account, calendar);
  const before = checker.getSafeToSpend('2026-11-24');
  assert.equal(before.bills, 40000);
  assert.equal(before.safe, 140000);
  calendar.processDue(account, '2026-11-25');
  const after = checker.getSafeToSpend('2026-11-25');
  assert.equal(after.bills, 0);
  assert.equal(after.safe, before.safe);
});

test('affordability preserves overall, 80 percent and category decisions', () => {
  const { account, calendar, category } = fixture();
  account.addTransaction({ type: 'income', name: 'Income', amount: 200000,
    date: '2026-11-01' }, '2026-11-24');
  account.addTransaction({ type: 'expense', name: 'Spending', amount: 80000,
    date: '2026-11-02', categoryId: category.id }, '2026-11-24');
  calendar.addRule({ type: 'expense', name: 'Bill', amount: 40000,
    frequency: 'monthly', startDate: '2026-11-28', categoryId: category.id });
  const checker = createChecker(account, calendar);
  assert.equal(checker.getSafeToSpend('2026-11-24').safe, 60000);
  assert.equal(checker.evaluatePurchase(65000, '', '2026-11-24').answer, 'no');
  assert.equal(checker.evaluatePurchase(48000, '', '2026-11-24').answer, 'tight');
  assert.equal(checker.evaluatePurchase(60000, '', '2026-11-24').answer, 'tight');
  assert.equal(checker.evaluatePurchase(20000, '', '2026-11-24').answer, 'yes');
  assert.equal(checker.evaluatePurchase(20000, category.id, '2026-11-24').answer, 'tight');
  assert.throws(() => checker.evaluatePurchase(0, '', '2026-11-24'));
});

test('challenges wait 28 days, compare monthly amounts, and accept or dismiss', () => {
  const { account, category } = fixture('2026-10-27');
  account.addTransaction({ type: 'expense', name: 'Food out', amount: 14000,
    date: '2026-11-10', categoryId: category.id }, '2026-11-24');
  const manager = new ChallengeManager(account);
  assert.deepEqual(manager.suggest('2026-11-23'), []);
  const [idea] = manager.suggest('2026-11-24');
  assert.equal(idea.recommended, 15000); // $140 / 28 * 30 days
  manager.deny(idea, '2026-11-24');
  assert.deepEqual(manager.suggest('2026-11-24'), []);
  assert.equal(category.amount, 50000);
  assert.equal(manager.suggest('2026-12-01').length, 1);
  manager.accept(manager.suggest('2026-12-01')[0], '2026-12-01');
  assert.equal(category.amount, 15500); // December has 31 days
});

test('no recommendations from empty history, protected categories or a new category', () => {
  const { account, category } = fixture('2026-10-01');
  const manager = new ChallengeManager(account);
  assert.deepEqual(manager.suggest('2026-11-24'), []);
  category.flexible = false;
  account.addTransaction({ type: 'expense', name: 'Rent', amount: 10000,
    date: '2026-11-10', categoryId: category.id }, '2026-11-24');
  const fresh = account.addCategory('New', 50000, true, '2026-11-24');
  account.addTransaction({ type: 'expense', name: 'New spending', amount: 1000,
    date: '2026-11-24', categoryId: fresh.id }, '2026-11-24');
  assert.deepEqual(manager.suggest('2026-11-24'), []);
});

test('reject invalid dates, money, schedules, future actuals and missing categories', () => {
  const { account, calendar } = fixture();
  const entry = { type: 'income', name: 'Job', amount: 10000, date: '2026-11-24' };
  assert.throws(() => account.addTransaction({ ...entry, date: '2026-02-30' }, '2026-11-24'));
  assert.throws(() => account.addTransaction({ ...entry, amount: NaN }, '2026-11-24'));
  assert.throws(() => account.addTransaction({ ...entry, date: '2026-12-01' }, '2026-11-24'));
  assert.throws(() => account.addTransaction({ ...entry, type: 'expense' }, '2026-11-24'));
  assert.throws(() => calendar.addRule({ ...entry, startDate: entry.date, frequency: 'days', days: [0] }));
  assert.throws(() => calendar.addRule({ ...entry, startDate: entry.date,
    frequency: 'days', days: [30, 31] }), /overlap/);
});

test('starter budgets split monthly income 50/30/20 without overwriting custom ones', () => {
  const account = new Account('2026-11-24');
  const calendar = new FinancialCalendar();
  calendar.addRule({ type: 'income', name: 'Job', amount: 300000,
    frequency: 'monthly', startDate: '2026-11-01' });
  account.createStarterBudgets(calendar, '2026-11-24');
  assert.deepEqual(account.categories.map(c => c.amount), [150000, 90000, 60000]);
  assert.throws(() => account.createStarterBudgets(calendar, '2026-11-24'));
});

test('JSON reload restores class objects, denied suggestions and recurrence cursors', () => {
  const folder = mkdtempSync(join(tmpdir(), 'budgetbuddy-test-'));
  try {
    const storage = new Storage(join(folder, 'budget.json'));
    storage.open('2026-10-01');
    const daos = new DAOManager(storage);
    const { account, calendar, category } = fixture('2026-10-01');
    account.addTransaction({ type: 'expense', name: 'Fun', amount: 10000,
      date: '2026-11-10', categoryId: category.id }, '2026-11-24');
    calendar.addRule({ type: 'income', name: 'Job', amount: 50000,
      startDate: '2026-11-01', frequency: 'monthly' });
    calendar.processDue(account, '2026-11-24');
    const manager = new ChallengeManager(account);
    manager.deny(manager.suggest('2026-11-24')[0], '2026-11-24');
    daos.budgets.insert(category);
    daos.transactions.insertMissing(account.transactions);
    daos.recurring.insertMissing(calendar.rules);
    daos.accounts.update(account);
    daos.commit();
    const reopened = new Storage(storage.file);
    reopened.open('2026-11-24');
    const loaded = new DAOManager(reopened).loadModels();
    assert.ok(loaded.account instanceof Account);
    assert.ok(loaded.account.transactions[0] instanceof Transaction);
    assert.ok(loaded.account.categories[0] instanceof BudgetCategory);
    assert.ok(loaded.calendar.rules[0] instanceof RecurringItem);
    assert.equal(loaded.calendar.processDue(loaded.account, '2026-11-24'), 0);
    assert.deepEqual(new ChallengeManager(loaded.account).suggest('2026-11-24'), []);
    assert.equal(JSON.parse(readFileSync(storage.file, 'utf8')).version, 1);
  } finally { rmSync(folder, { recursive: true }); }
});

test('future amount changes leave earlier recorded transactions unchanged', () => {
  const { account, calendar } = fixture();
  const rule = calendar.addRule({ name: 'Job', type: 'income', amount: 10000,
    frequency: 'monthly', startDate: '2026-11-01' });
  calendar.processDue(account, '2026-11-24');
  calendar.changeAmount(rule.id, 20000);
  calendar.processDue(account, '2026-12-01');
  assert.deepEqual(account.transactions.map(t => t.amount), [10000, 20000]);
});
