import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RecurringItem } from '../calendar.js';
import { Storage } from '../storage.js';
import { DAOManager } from '../daos.js';
import { ServiceHub } from '../service-hub.js';
import { addDays, today } from '../helpers.js';

// Starts the real program on a free port with its own temporary data file.
async function start(file) {
  const program = fileURLToPath(new URL('../main.js', import.meta.url));
  const child = spawn(process.execPath, [program], {
    env: { ...process.env, BUDGETBUDDY_DATA: file, BUDGETBUDDY_PORT: '0' }
  });
  const exited = new Promise(resolve => child.on('exit', resolve));
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const read = chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', () => reject(new Error('Server did not start: ' + output)));
  });
  return {
    url,
    exited,
    get: async path => (await fetch(url + path)).text(),
    post: async (path, form = {}) => (await fetch(url + path, { method: 'POST', body: new URLSearchParams(form) })).text(),
    stop: () => { child.kill(); return exited; }
  };
}

async function withFolder(run) {
  const folder = mkdtempSync(join(tmpdir(), 'budgetbuddy-web-'));
  try { await run(join(folder, 'budget.json')); }
  finally { rmSync(folder, { recursive: true }); }
}

function openDAOs(file, date = today()) {
  const storage = new Storage(file);
  storage.open(date);
  return new DAOManager(storage);
}

// What is in the file right now.
const load = file => openDAOs(file).loadModels();

// A finished account with $1,000 income and one $500 Wants budget.
function savedAccount(file, historyStart = today()) {
  const daos = openDAOs(file, historyStart);
  const { account, calendar } = daos.loadModels();
  const hub = new ServiceHub(account, calendar, daos);
  hub.finishSetup();
  hub.saveBudget({ name: 'Wants', amount: 50000, flexible: true }, historyStart);
  hub.saveTransaction({ type: 'income', name: 'Income', amount: 100000, date: today(), repeating: false }, today());
  return { hub, category: account.categories[0] };
}

test('web setup survives a restart without duplicates, then opens the main pages', () => withFolder(async file => {
  let app = await start(file);
  try {
    assert.match(await app.get('/'), /Step 1 of 2/); // Every page goes to setup first.
    assert.match(await app.post('/setup/finish'), /Finish the income step first/);
    const added = await app.post('/setup/add', { type: 'income', name: 'Job', amount: '2000', date: today(), frequency: 'monthly' });
    assert.match(added, /Recurring rule added\. Due transactions recorded: 1/);
    await app.stop();

    app = await start(file);
    assert.match(await app.get('/'), /Job: \$2,000\.00/);
    const expenses = await app.post('/setup/finish-income');
    assert.match(expenses, /Step 2 of 2/);
    assert.match(expenses, /Needs<\/td><td>\$1,000\.00/);
    assert.match(await app.post('/setup/add', { type: 'expense', name: 'Rent', amount: '500', date: today(),
      frequency: 'monthly' }), /An expense needs a category/);
    assert.match(await app.post('/setup/finish'), /Setup saved/);
    assert.match(await app.get('/setup'), /<h2>Overview<\/h2>/); // Setup is closed.
    const data = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(data.rules.length, 1);
    assert.equal(data.account.transactions.length, 1);
    assert.equal(data.account.categories.length, 3);
    assert.equal(data.account.setupComplete, true);
  } finally { await app.stop(); }
}));

test('transactions, recurring items and budgets can be added and changed on the web pages', () => withFolder(async file => {
  const { category } = savedAccount(file);
  const app = await start(file);
  try {
    await app.post('/transactions/add', { type: 'expense', name: 'Lunch', amount: '20', date: today(), categoryId: category.id });
    const lunch = load(file).account.transactions.find(t => t.name === 'Lunch');
    assert.equal(lunch.amount, 2000);
    assert.match(await app.get('/transactions'), /Lunch<\/td><td>\$20\.00<\/td><td>Wants/);
    assert.match(await app.post('/transactions/delete', { id: lunch.id }), /Deleted this entry/);
    assert.equal(load(file).account.transactions.length, 1);

    await app.post('/transactions/add', { type: 'income', name: 'Side job', amount: '50', date: today(),
      repeating: 'yes', frequency: 'days', days: '1, 15' });
    const rule = load(file).calendar.rules[0];
    assert.deepEqual(rule.days, [1, 15]);
    await app.post('/recurring/amount', { id: rule.id, amount: '75.50' });
    assert.equal(load(file).calendar.rules[0].amount, 7550);
    await app.post('/recurring/stop', { id: rule.id });
    assert.equal(load(file).calendar.rules[0].active, false);
    assert.match(await app.get('/recurring'), /stopped/);
    await app.post('/recurring/add', { type: 'expense', name: 'Gym', amount: '30', date: today(),
      categoryId: category.id, frequency: 'biweekly' });
    assert.equal(load(file).calendar.rules[1].frequency, 'biweekly');
    assert.ok(load(file).account.transactions.some(t => t.name === 'Gym'));

    await app.post('/budgets/add', { name: 'Pets', amount: '0' });
    await app.post('/budgets/edit', { id: category.id, amount: '450.25' }); // An unchecked box is not sent.
    assert.equal(load(file).account.categories[1].name, 'Pets');
    assert.equal(load(file).account.getCategory(category.id).amount, 45025);
    assert.equal(load(file).account.getCategory(category.id).flexible, false);
  } finally { await app.stop(); }
}));

test('bad input shows an error, keeps what was typed and saves nothing', () => withFolder(async file => {
  const { category } = savedAccount(file);
  const app = await start(file);
  try {
    const form = { type: 'expense', name: 'Lunch', amount: '20', date: today(), categoryId: category.id };
    for (const [change, message] of [
      [{ amount: 'abc' }, /Enter dollars and cents/],
      [{ amount: '-5' }, /Enter dollars and cents/],
      [{ amount: '0' }, /valid positive amount/],
      [{ categoryId: '' }, /An expense needs a category/],
      [{ categoryId: 'missing' }, /Category not found/],
      [{ name: '  ' }, /needs a name/],
      [{ date: addDays(today(), 1) }, /cannot be in the future/],
      [{ repeating: 'yes', frequency: 'days', days: '40' }, /days from 1 to 31/],
      [{ repeating: 'yes', frequency: 'days', days: '30,31' }, /overlap in February/]
    ]) assert.match(await app.post('/transactions/add', { ...form, ...change }), message);
    assert.match(await app.post('/transactions/add', { ...form, amount: 'abc' }), /name="name" value="Lunch"/);
    assert.match(await app.post('/budgets/add', { name: 'wants', amount: '5' }), /already exists/);
    assert.equal(load(file).account.transactions.length, 1);
    assert.equal(load(file).account.categories.length, 1);
    assert.equal(load(file).calendar.rules.length, 0);
  } finally { await app.stop(); }
}));

test('affordability check is read-only until the purchase is recorded', () => withFolder(async file => {
  const { category } = savedAccount(file);
  const app = await start(file);
  const expenses = () => load(file).account.transactions.filter(t => t.type === 'expense');
  try {
    const yes = await app.post('/affordability/check', { price: '200', categoryId: category.id });
    assert.match(yes, /Yes, you can afford it\. Safe money after purchase: \$700\.00/);
    assert.match(yes, /name="price" value="200\.00"/);
    assert.match(await app.post('/affordability/check', { price: '720' }), /it is tight/);
    assert.match(await app.post('/affordability/check', { price: '1000' }), /Not yet\. You are \$100\.00 short/);
    assert.equal(expenses().length, 0);

    assert.match(await app.post('/affordability/record', { price: '200.00', name: 'Shoes' }), /needs a category/);
    assert.equal(expenses().length, 0);
    const saved = await app.post('/affordability/record', { price: '200.00', name: 'Shoes', categoryId: category.id });
    assert.match(saved, /Expense recorded: Shoes \| \$200\.00/);
    assert.equal(expenses().length, 1);
    assert.equal(expenses()[0].amount, 20000);
    assert.equal(expenses()[0].categoryId, category.id);
    assert.equal(expenses()[0].date, today());
    assert.equal(expenses()[0].recurringId, '');
    const loaded = load(file);
    assert.equal(new ServiceHub(loaded.account, loaded.calendar).getDashboard(today()).safe, 70000);
    assert.match(await app.get('/'), /Safe to spend<\/b><\/td><td><b>\$700\.00/);
  } finally { await app.stop(); }
}));

test('challenges wait 28 days, then accept changes the budget', () => withFolder(async file => {
  savedAccount(file);
  let app = await start(file);
  try { assert.match(await app.get('/challenges'), /28 days remaining/); } finally { await app.stop(); }

  rmSync(file);
  const { hub, category } = savedAccount(file, addDays(today(), -40));
  hub.saveTransaction({ type: 'expense', name: 'Fun', amount: 1400, date: today(), categoryId: category.id }, today());
  app = await start(file);
  try {
    const key = (await app.get('/challenges')).match(/name="key" value="([^"]+)"/)[1];
    assert.match(await app.post('/challenges/respond', { key: 'old', answer: 'accept' }), /recommendation changed/);
    assert.match(await app.post('/challenges/respond', { key, answer: 'accept' }), /Budget updated/);
    const changed = load(file).account;
    assert.equal(changed.getCategory(category.id).amount, Number(key.split(':').pop()));
    assert.equal(changed.challengeResponses[0].answer, 'accepted');
  } finally { await app.stop(); }
}));

test('user text is escaped, unknown pages are 404, and other websites are refused', () => withFolder(async file => {
  savedAccount(file);
  const app = await start(file);
  try {
    await app.post('/transactions/add', { type: 'income', name: '<script>alert(1)</script>', amount: '5', date: today() });
    const page = await app.get('/transactions');
    assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!page.includes('<script>'));

    assert.equal((await fetch(app.url + '/nothing')).status, 404);
    assert.match(await app.get('/budgets/add'), /<h2>Monthly Budgets<\/h2>/); // GET on a form address goes to its page.

    // fetch() controls these headers itself, so send them with the plain http module.
    const status = headers => new Promise((resolve, reject) => {
      const call = request(app.url + '/budgets/add', { method: 'POST', headers }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      call.on('error', reject);
      call.end('name=Hacked&amount=1');
    });
    const host = app.url.replace('http://', '');
    assert.equal(await status({ Host: 'evil.example' }), 403);
    assert.equal(await status({ Host: host, Origin: 'http://evil.example' }), 403);
    assert.equal(load(file).account.categories.length, 1);
    assert.equal(await status({ Host: host, Origin: app.url }), 303);
  } finally { await app.stop(); }
}));

test('due recurring items are recorded when a page opens', () => withFolder(async file => {
  savedAccount(file);
  const daos = openDAOs(file);
  daos.recurring.insert(new RecurringItem({ type: 'income', name: 'Job', amount: 1000, frequency: 'monthly', startDate: today() }));
  daos.commit();
  const app = await start(file);
  try {
    assert.match(await app.get('/'), /Automatically recorded 1 due transaction/);
    assert.doesNotMatch(await app.get('/'), /Automatically recorded/);
    assert.equal(load(file).account.transactions.length, 2);
  } finally { await app.stop(); }
}));

test('a disk error stops the program instead of pretending to save', () => withFolder(async file => {
  savedAccount(file);
  const app = await start(file);
  try {
    rmSync(file);
    mkdirSync(join(file, 'blocked'), { recursive: true }); // A folder now sits where the file should go.
    const response = await fetch(app.url + '/');
    assert.equal(response.status, 500);
    assert.match(await response.text(), /BudgetBuddy error/);
    assert.equal(await app.exited, 1);
  } finally { await app.stop(); }
}));
