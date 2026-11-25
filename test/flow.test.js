import test from 'node:test';
import assert from 'node:assert/strict';
import { Account } from '../account.js';
import { FinancialCalendar } from '../calendar.js';
import { ServiceHub } from '../service-hub.js';
import { AffordabilityController } from '../controllers.js';
import { AffordabilityView } from '../views.js';

test('purchase travels through controller, hub and services before view receives result', () => {
  const account = new Account('2026-11-24');
  const calendar = new FinancialCalendar();
  account.addCategory('Wants', 50000, true, '2026-11-24');
  account.addTransaction({ type: 'income', name: 'Income', amount: 100000,
    date: '2026-11-01' }, '2026-11-24');
  const hub = new ServiceHub(account, calendar);
  const calls = [];
  let returned;
  // Instrument real services so this test detects bypassing the required layers.
  for (const [object, method, label] of [
    [hub, 'canAfford', 'hub'],
    [hub.affordabilityService, 'evaluatePurchase', 'affordability'],
    [hub.spendingService, 'summary', 'spending'],
    [hub.recurringService, 'unpaidTotal', 'recurring']
  ]) {
    const original = object[method].bind(object);
    object[method] = (...args) => {
      calls.push(label);
      const value = original(...args);
      if (label === 'hub') returned = value;
      return value;
    };
  }
  let displayed;
  const view = {
    readInput(form) {
      assert.deepEqual(form, { price: '100' });
      calls.push('read input');
      return { price: 10000, categoryId: '' };
    },
    showResult(result, input, categories) {
      assert.equal(categories[0].name, 'Wants');
      calls.push('show result');
      displayed = result;
      return '<p>page</p>';
    }
  };
  const controller = new AffordabilityController(view, hub);
  const page = controller.handleCheckClicked({ price: '100' }, '2026-11-24');
  assert.deepEqual(page, { body: '<p>page</p>' });
  assert.equal(displayed, returned);
  assert.equal(displayed.answer, 'yes');
  assert.deepEqual(calls, ['read input', 'hub', 'affordability', 'spending', 'recurring', 'show result']);
  assert.equal(account.transactions.length, 1); // A check must not save a purchase.
});

test('real AffordabilityView reads form fields and returns HTML without model access', () => {
  const view = new AffordabilityView();
  const input = view.readInput({ price: '100.00', categoryId: '' });
  assert.deepEqual(input, { price: 10000, categoryId: '' });
  assert.throws(() => view.readInput({ price: 'free' }), /Enter dollars and cents/);
  const html = view.showResult({ answer: 'no', reason: '', price: 10000,
    shortfall: 6000, weeklySaving4: 1500, weeklySaving8: 750,
    numbers: { left: 5000, bills: 0, buffer: 1000, safe: 4000 } }, input, []);
  assert.ok(html.includes('$60.00 short'));
  assert.equal('account' in view, false);
  assert.equal('calendar' in view, false);
});

test('dashboard keeps the warning when category budgets exceed estimated income', () => {
  const account = new Account('2026-11-24');
  account.addCategory('Wants', 50000, true, '2026-11-24');
  const hub = new ServiceHub(account, new FinancialCalendar());
  assert.equal(hub.getDashboard('2026-11-24').overAllocated, true);
});
