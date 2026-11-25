import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account, Transaction, BudgetCategory } from '../account.js';
import { RecurringItem } from '../calendar.js';
import { Storage } from '../storage.js';
import { DAOManager } from '../daos.js';
import { ServiceHub } from '../service-hub.js';

function withFile(run) {
  const folder = mkdtempSync(join(tmpdir(), 'budgetbuddy-dao-'));
  try { run(join(folder, 'budget.json')); }
  finally { rmSync(folder, { recursive: true }); }
}

function openDAOs(file, date = '2026-11-24') {
  const storage = new Storage(file);
  storage.open(date);
  return new DAOManager(storage);
}

const lunch = id => new Transaction({ id, type: 'income', name: 'Lunch refund', amount: 500, date: '2026-11-24' });

test('each DAO finds, inserts, updates and deletes its own kind of record', () => withFile(file => {
  const daos = openDAOs(file);
  const category = new BudgetCategory('Wants', 50000, true, '2026-11-24');
  const rule = new RecurringItem({ type: 'income', name: 'Job', amount: 1000, frequency: 'days',
    days: [1, 15], startDate: '2026-11-24' });
  for (const [dao, object, type] of [[daos.transactions, lunch('t1'), Transaction],
    [daos.budgets, category, BudgetCategory], [daos.recurring, rule, RecurringItem]]) {
    assert.deepEqual(dao.findAll(), []);
    assert.equal(dao.findById(object.id), null);
    assert.throws(() => dao.update(object), /not found/);
    assert.throws(() => dao.delete(object.id), /not found/);
    dao.insert(object);
    assert.throws(() => dao.insert(object), /already saved/);
    dao.insertMissing([object]);
    assert.deepEqual(dao.findAll(), [object]);
    assert.ok(dao.findById(object.id) instanceof type);
    object.amount = 777;
    dao.update(object);
    assert.equal(dao.findById(object.id).amount, 777);
    dao.delete(object.id);
    assert.deepEqual(dao.findAll(), []);
  }
  const account = daos.accounts.find();
  assert.ok(account instanceof Account);
  account.setupStage = 'expenses';
  account.deletedOccurrences.push('x');
  assert.equal(daos.accounts.find().setupStage, 'income');
  daos.accounts.update(account);
  assert.equal(daos.accounts.find().setupStage, 'expenses');
  assert.deepEqual(daos.accounts.find().deletedOccurrences, ['x']);
}));

test('DAOs hand out copies, so saved data only changes through the DAO', () => withFile(file => {
  const daos = openDAOs(file);
  const rule = new RecurringItem({ type: 'income', name: 'Job', amount: 1000, frequency: 'days',
    days: [1, 15], startDate: '2026-11-24' });
  daos.recurring.insert(rule);
  rule.days.push(20);
  daos.recurring.findAll()[0].days.push(21);
  daos.recurring.findById(rule.id).amount = 5;
  daos.accounts.find().challengeResponses.push('x');
  assert.deepEqual(daos.recurring.findAll()[0].days, [1, 15]);
  assert.equal(daos.recurring.findAll()[0].amount, 1000);
  assert.deepEqual(daos.accounts.find().challengeResponses, []);
}));

test('nothing reaches the file until commit', () => withFile(file => {
  const daos = openDAOs(file);
  daos.transactions.insert(lunch('t1'));
  assert.equal(existsSync(file), false);
  daos.commit();
  assert.equal(openDAOs(file).transactions.findAll().length, 1);
}));

// The main guard: if ServiceHub forgets a DAO call, the file and memory disagree.
test('after every ServiceHub action the file matches memory and was written once', () => withFile(file => {
  const daos = openDAOs(file, '2026-10-01');
  const { account, calendar } = daos.loadModels();
  const hub = new ServiceHub(account, calendar, daos);
  let commits = 0;
  const commit = daos.commit.bind(daos);
  daos.commit = () => { commits++; commit(); };
  const run = (name, action) => {
    commits = 0;
    const result = action();
    assert.equal(commits, 1, name + ' should write once');
    assert.deepEqual(openDAOs(file).loadModels(), { account, calendar }, name + ' should save everything');
    return result;
  };

  const job = { type: 'income', name: 'Job', amount: 200000, startDate: '2026-10-01', date: '2026-10-01',
    frequency: 'monthly', days: [], categoryId: '', repeating: true };
  assert.equal(run('add income rule', () => hub.saveTransaction(job, '2026-10-01')).recorded, 1);
  run('finish income setup', () => hub.finishIncomeSetup('2026-10-01'));
  run('finish income setup again', () => hub.finishIncomeSetup('2026-10-01'));
  const wants = account.categories[1];
  const gym = { ...job, type: 'expense', name: 'Gym', amount: 3000, frequency: 'days', days: [1, 15], categoryId: wants.id };
  run('add expense rule', () => hub.saveTransaction(gym, '2026-10-01'));
  run('finish setup', () => hub.finishSetup());
  assert.equal(run('refresh records due payments', () => hub.refresh('2026-11-24')), 4);
  assert.equal(run('refresh again records nothing', () => hub.refresh('2026-11-24')), 0);
  run('add one-time expense', () => hub.saveTransaction({ type: 'expense', name: 'Fun', amount: 14000,
    date: '2026-11-10', categoryId: wants.id, repeating: false }, '2026-11-24'));
  run('add budget', () => hub.saveBudget({ id: '', name: 'Pets', amount: 100000, flexible: true }, '2026-10-01'));
  const pets = account.categories.find(c => c.name === 'Pets');
  run('edit budget', () => hub.saveBudget({ id: pets.id, amount: 90000, flexible: true }, '2026-11-24'));
  run('add pet expense', () => hub.saveTransaction({ type: 'expense', name: 'Vet', amount: 2800,
    date: '2026-11-20', categoryId: pets.id, repeating: false }, '2026-11-24'));
  const [first, second] = hub.getChallenges('2026-11-24').ideas;
  run('accept challenge', () => hub.respondToChallenge(first, true, '2026-11-24'));
  run('deny challenge', () => hub.respondToChallenge(second, false, '2026-11-24'));
  run('delete one-time', () => hub.deleteTransaction(account.transactions.find(t => t.name === 'Fun').id));
  run('delete recurring payment', () => hub.deleteTransaction(account.transactions.find(t => t.name === 'Gym').id));
  assert.equal(account.deletedOccurrences.length, 1);
  assert.equal(run('deleted payment stays deleted', () => hub.refresh('2026-11-24')), 0);
  run('change recurring amount', () => hub.changeRecurringAmount(calendar.rules[0].id, 250000));
  run('stop recurring', () => hub.stopRecurring(calendar.rules[1].id));

  // After a restart the schedule continues where it stopped.
  const again = openDAOs(file);
  const loaded = again.loadModels();
  assert.equal(new ServiceHub(loaded.account, loaded.calendar, again).refresh('2026-11-24'), 0);
}));

test('rejected input changes neither memory nor the file', () => withFile(file => {
  const daos = openDAOs(file);
  const { account, calendar } = daos.loadModels();
  const hub = new ServiceHub(account, calendar, daos);
  hub.saveBudget({ id: '', name: 'Wants', amount: 50000, flexible: true }, '2026-11-24');
  const before = readFileSync(file, 'utf8');
  const item = { type: 'expense', name: 'X', amount: 100, date: '2026-11-24', startDate: '2026-11-24',
    categoryId: 'missing', frequency: 'monthly', days: [], repeating: false };
  assert.throws(() => hub.saveTransaction(item, '2026-11-24'));
  assert.throws(() => hub.saveTransaction({ ...item, repeating: true }, '2026-11-24'));
  assert.throws(() => hub.saveBudget({ id: '', name: 'wants', amount: 1, flexible: true }, '2026-11-24'));
  assert.throws(() => hub.saveBudget({ id: account.categories[0].id, amount: -1, flexible: true }, '2026-11-24'));
  assert.throws(() => hub.deleteTransaction('missing'));
  assert.throws(() => hub.stopRecurring('missing'));
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(openDAOs(file).loadModels(), { account, calendar });
}));

// The layout written by the version without DAOs.
function oldFile() {
  return { version: 1, account: { historyStart: '2026-11-24', setupComplete: true, setupStage: 'complete',
    transactions: [{ id: 'r1:2026-11-24', type: 'expense', name: 'car', amount: 30000, date: '2026-11-24',
      categoryId: 'c1', recurringId: 'r1' }],
    categories: [{ id: 'c1', name: 'Needs', amount: 125000, flexible: false, createdAt: '2026-11-24' }],
    deletedOccurrences: [], challengeResponses: [] },
  rules: [{ id: 'r1', type: 'expense', name: 'car', amount: 30000, categoryId: 'c1', frequency: 'monthly',
    startDate: '2026-11-24', active: true, days: [], nextDate: '2026-12-24' }] };
}

test('a file saved before the DAOs loads and is written back identically', () => withFile(file => {
  const text = JSON.stringify(oldFile(), null, 2) + '\n';
  writeFileSync(file, text);
  const daos = openDAOs(file);
  const { account, calendar } = daos.loadModels();
  assert.equal(new ServiceHub(account, calendar, daos).refresh('2026-11-24'), 0);
  assert.equal(readFileSync(file, 'utf8'), text);
}));

test('invalid saved data stops loading and is not overwritten', () => withFile(file => {
  for (const damage of [
    data => { data.version = 2; },
    data => { delete data.rules; },
    data => { delete data.account; },
    data => { delete data.account.categories; },
    data => { data.account.challengeResponses = 'x'; },
    data => { delete data.account.transactions[0].id; },
    data => { data.account.transactions[0] = null; },
    data => { data.account.transactions[0].amount = 'lots'; },
    data => { data.account.transactions[0].categoryId = 'missing'; },
    data => { data.rules[0].categoryId = 'missing'; },
    data => { data.rules[0].nextDate = 'soon'; }
  ]) {
    const data = oldFile();
    damage(data);
    const text = JSON.stringify(data);
    writeFileSync(file, text);
    assert.throws(() => openDAOs(file).loadModels(), damage.toString());
    assert.equal(readFileSync(file, 'utf8'), text);
  }
}));
