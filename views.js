import { today, parseDate, validAmount, money } from './helpers.js';

// Views turn data into plain HTML, and turn submitted form fields into input.
// They never touch Account, FinancialCalendar, the services or the ServiceHub.

// User text must be escaped so it is shown as text, never run as HTML.
export function escapeHtml(value) {
  const codes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, character => codes[character]);
}

function readAmount(text, allowZero = false) {
  if (!/^\d+(\.\d{1,2})?$/.test((text || '').trim())) {
    throw new Error('Enter dollars and cents, such as 1250 or 12.50.');
  }
  const cents = Math.round(Number(text) * 100);
  validAmount(cents, allowZero);
  return cents;
}

// Cents -> "12.50" for an input box (no dollar sign or commas).
function dollars(cents) {
  return (cents / 100).toFixed(2);
}

function options(list, selected) {
  return list.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>` +
    escapeHtml(label) + '</option>').join('');
}

function categoryOptions(categories, selected, emptyLabel) {
  return options([['', emptyLabel], ...categories.map(c => [c.id, c.name + ' | ' + money(c.amount)])], selected);
}

function table(headings, rows) {
  return '<table border="1" cellpadding="5">\n<tr>' + headings.map(text => `<th>${text}</th>`).join('') + '</tr>\n' +
    rows.map(cells => '<tr>' + cells.map(cell => `<td>${cell}</td>`).join('') + '</tr>\n').join('') + '</table>';
}

// The outer page that every screen shares: heading, menu and messages.
export class PageView {
  render(title, body, messages = [], error = '', showMenu = true) {
    const menu = `<p>
<a href="/">Overview</a> |
<a href="/transactions">Transactions</a> |
<a href="/recurring">Recurring Items</a> |
<a href="/budgets">Budgets</a> |
<a href="/affordability">Affordability</a> |
<a href="/challenges">Challenges</a>
</p>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - BudgetBuddy</title>
</head>
<body>
<h1>BudgetBuddy</h1>
${showMenu ? menu : ''}
<hr>
<h2>${escapeHtml(title)}</h2>
${messages.map(message => `<p><b>${escapeHtml(message)}</b></p>`).join('\n')}
${error ? `<p><b>Error: ${escapeHtml(error)}</b></p>` : ''}
${body}
</body>
</html>
`;
  }
}

export class OverviewView {
  render(data, date) {
    return `<p>Date: ${escapeHtml(date)}</p>
${table(['Item', 'Amount'], [
    ['Estimated monthly income', money(data.income)],
    ['Recorded spending this month', money(data.spent)],
    ['Upcoming expenses this month', money(data.bills)],
    ['10% income buffer', money(data.buffer)],
    ['<b>Safe to spend</b>', `<b>${money(data.safe)}</b>`]
  ])}
${data.overAllocated ? '<p><b>Your category budgets exceed estimated income. Review Budgets.</b></p>' : ''}
<p>This is a monthly estimate, not a bank balance.
Savings is a target; affordability reserves only its original 10% buffer.</p>
<h3>Budgets</h3>
${table(['Category', 'Budget', 'Spent'], data.budgets.map(item =>
    [escapeHtml(item.name), money(item.amount), money(item.spent)]))}`;
  }
}

export class SetupView {
  showIncome(items, form) {
    return `<p>Step 1 of 2. Add each regular income source, using take-home pay per payment.</p>
${this.list(items)}
${form}
<hr>
<form method="post" action="/setup/finish-income"><button>Done adding income</button></form>`;
  }

  showExpenses(items, budgets, form) {
    return `<p>Step 2 of 2. Starter monthly budgets are 50% Needs, 30% Wants, 20% Savings.
These are editable targets. Fun/entertainment belongs under Wants.</p>
${table(['Category', 'Budget'], budgets.map(item => [escapeHtml(item.name), money(item.amount)]))}
<h3>Add a regular expense</h3>
${this.list(items)}
${form}
<hr>
<form method="post" action="/setup/finish"><button>Finish setup</button></form>`;
  }

  incomeSavedMessage() {
    return 'Income saved. Starter budgets are ready.';
  }

  setupSavedMessage() {
    return 'Setup saved. You can add more income, expenses and categories from the menu.';
  }

  list(items) {
    if (!items.length) return '<p>None added yet.</p>';
    return '<ul>' + items.map(item => `<li>${escapeHtml(item.name)}: ${money(item.amount)}, ` +
      escapeHtml(item.frequency) + '</li>').join('') + '</ul>';
  }
}

export class TransactionView {
  // One form is shared by Transactions, Recurring Items and Setup.
  // values holds what the user typed, so an error does not clear the form.
  form(action, categories, date, { type = '', alwaysRecurring = false, values = {} } = {}) {
    const typeField = type ? `<input type="hidden" name="type" value="${type}">` :
      `<p><label>Type: <select name="type">${options([['income', 'Income'], ['expense', 'Expense']], values.type)}</select></label></p>`;
    const categoryField = type === 'income' ? '' :
      `<p><label>Category${type ? '' : ' (expenses only)'}: <select name="categoryId"${type ? ' required' : ''}>` +
      categoryOptions(categories, values.categoryId, 'Choose a category') + '</select></label></p>';
    const repeatField = alwaysRecurring ? '' : '<p><label><input type="checkbox" name="repeating" value="yes"' +
      (values.repeating ? ' checked' : '') + '> This repeats</label></p>';
    return `<form method="post" action="${action}">
${typeField}
<p><label>Name: <input name="name" value="${escapeHtml(values.name)}" required></label></p>
<p><label>Amount per payment: $<input type="number" name="amount" min="0.01" step="0.01" value="${escapeHtml(values.amount)}" required></label></p>
<p><label>${alwaysRecurring ? 'First scheduled date' : 'Date (or first scheduled date)'}: <input type="date" name="date" value="${escapeHtml(values.date || date)}" required></label></p>
${categoryField}
${repeatField}
<p><label>Frequency${alwaysRecurring ? '' : ' (only if it repeats)'}: <select name="frequency">${options([['monthly', 'Monthly'],
    ['biweekly', 'Every two weeks (14 days)'], ['days', 'Selected days each month']], values.frequency)}</select></label></p>
<p><label>Days of month (only for Selected days, example 1,15): <input name="days" value="${escapeHtml(values.days)}"></label></p>
<p><button>Add</button></p>
</form>`;
  }

  readInput(form, alwaysRecurring = false) {
    const type = form.type;
    const amount = readAmount(form.amount);
    const date = form.date || today();
    parseDate(date);
    const categoryId = type === 'expense' ? form.categoryId || '' : '';
    if (type === 'expense' && !categoryId) throw new Error('An expense needs a category.');
    const repeating = alwaysRecurring || form.repeating === 'yes';
    const frequency = repeating ? form.frequency : '';
    let days = [];
    if (frequency === 'days') {
      const text = (form.days || '').trim();
      if (!/^\d{1,2}(\s*,\s*\d{1,2})*$/.test(text)) throw new Error('Enter days from 1 to 31, such as 1,15.');
      days = text.split(',').map(Number);
    }
    return { type, name: form.name, amount, date, startDate: date, categoryId, repeating, frequency, days };
  }

  render(items, form) {
    const rows = items.map(item => [escapeHtml(item.date), escapeHtml(item.type), escapeHtml(item.name),
      money(item.amount), escapeHtml(item.categoryName), item.recurring ? 'Yes' : 'No',
      `<form method="post" action="/transactions/delete" onsubmit="return confirm('Delete this transaction?')">` +
      `<input type="hidden" name="id" value="${escapeHtml(item.id)}"><button>Delete</button></form>`]);
    return `${items.length ? table(['Date', 'Type', 'Name', 'Amount', 'Category', 'Recurring', ''], rows) :
      '<p>No transactions yet.</p>'}
<h3>Add a transaction</h3>
${form}`;
  }

  savedMessage(result) {
    return result.repeating ? 'Recurring rule added. Due transactions recorded: ' + result.recorded :
      'One-time transaction added.';
  }

  deletedMessage() {
    return 'Deleted this entry. Any recurring rule still continues; stop it under Recurring Items.';
  }
}

export class CalendarView {
  render(items, form) {
    const rows = items.map(item => {
      const id = `<input type="hidden" name="id" value="${escapeHtml(item.id)}">`;
      const actions = !item.active ? '' : `<form method="post" action="/recurring/amount">${id}` +
        `<label>New amount: $<input type="number" name="amount" min="0.01" step="0.01" required></label> <button>Change</button></form>` +
        `<form method="post" action="/recurring/stop" onsubmit="return confirm('Stop future repeats?')">${id}<button>Stop</button></form>`;
      return [escapeHtml(item.name), escapeHtml(item.type), money(item.amount),
        escapeHtml(item.frequency) + (item.frequency === 'days' ? ' ' + escapeHtml(item.days.join(',')) : ''),
        item.active ? 'next ' + escapeHtml(item.nextDate) : 'stopped', actions];
    });
    return `${items.length ? table(['Name', 'Type', 'Amount', 'Frequency', 'Status', 'Change future payments'], rows) :
      '<p>No recurring items yet.</p>'}
<h3>Add a recurring item</h3>
${form}`;
  }

  readAmountInput(form) {
    return { id: form.id, amount: readAmount(form.amount) };
  }

  updatedMessage() {
    return 'Recurring item updated. Earlier transactions were kept.';
  }
}

export class BudgetView {
  render(items, values = {}) {
    const rows = items.map(item => [escapeHtml(item.name), money(item.amount), money(item.spent),
      item.flexible ? 'eligible after 28 days' : 'protected',
      `<form method="post" action="/budgets/edit"><input type="hidden" name="id" value="${escapeHtml(item.id)}">` +
      `<label>$<input type="number" name="amount" min="0" step="0.01" value="${dollars(item.amount)}" required></label> ` +
      `<label><input type="checkbox" name="flexible" value="yes"${item.flexible ? ' checked' : ''}> Allow challenges</label> ` +
      '<button>Save</button></form>']);
    return `${table(['Category', 'Monthly budget', 'Spent', 'Challenges', 'Edit'], rows)}
<h3>Add a category</h3>
<form method="post" action="/budgets/add">
<p><label>Category name: <input name="name" value="${escapeHtml(values.name)}" required></label></p>
<p><label>Monthly budget: $<input type="number" name="amount" min="0" step="0.01" value="${escapeHtml(values.amount)}" required></label></p>
<p><label><input type="checkbox" name="flexible" value="yes"${values.flexible ? ' checked' : ''}> Allow budget-reduction recommendations for this category</label></p>
<p><button>Add</button></p>
</form>`;
  }

  readInput(form) {
    return { id: form.id || '', name: form.name || '', amount: readAmount(form.amount, true),
      flexible: form.flexible === 'yes' };
  }

  savedMessage() {
    return 'Budget saved.';
  }
}

export class AffordabilityView {
  form(categories, values = {}) {
    return `<form method="post" action="/affordability/check">
<p><label>Purchase price: $<input type="number" name="price" min="0.01" step="0.01" value="${escapeHtml(values.price)}" required></label></p>
<p><label>Category: <select name="categoryId">${categoryOptions(categories, values.categoryId, 'Any category')}</select></label></p>
<p><button>Can I afford this?</button></p>
</form>`;
  }

  readInput(form) {
    return { price: readAmount(form.price), categoryId: form.categoryId || '' };
  }

  showResult(result, input, categories) {
    const numbers = result.numbers;
    const lines = [];
    if (result.answer === 'yes') {
      lines.push('Yes, you can afford it. Safe money after purchase: ' + money(result.remaining));
    } else if (result.answer === 'tight') {
      lines.push('You can, but it is tight. ' + result.reason);
      if (result.categoryRemaining !== undefined) {
        lines.push('Category remaining before purchase: ' + money(result.categoryRemaining));
      }
    } else {
      lines.push('Not yet. You are ' + money(result.shortfall) + ' short.');
      lines.push('Save ' + money(result.weeklySaving4) + '/week for 4 weeks, or ' +
        money(result.weeklySaving8) + '/week for 8 weeks.');
      lines.push('Open the separate Challenges page to review any budget recommendations.');
    }
    lines.push(money(numbers.left) + ' left - ' + money(numbers.bills) + ' bills - ' +
      money(numbers.buffer) + ' buffer = ' + money(numbers.safe) + ' safe to spend.');
    const values = { price: dollars(input.price), categoryId: input.categoryId };
    return `${this.form(categories, values)}
<h3>Result for ${money(result.price)}</h3>
${lines.map((line, index) => `<p>${index === 0 ? '<b>' : ''}${escapeHtml(line)}${index === 0 ? '</b>' : ''}</p>`).join('\n')}
${this.expenseForm(categories, values)}`;
  }

  expenseForm(categories, values) {
    return `<h3>Record this purchase? (optional)</h3>
<p>The check alone does not record a purchase. Use this only if you actually bought it today.</p>
<form method="post" action="/affordability/record">
<input type="hidden" name="price" value="${escapeHtml(values.price)}">
<p><label>Purchase description: <input name="name" required></label></p>
<p><label>Category: <select name="categoryId" required>${categoryOptions(categories, values.categoryId, 'Choose a category')}</select></label></p>
<p><button>Record expense</button></p>
</form>`;
  }

  readExpenseInput(form) {
    if (!form.categoryId) throw new Error('A recorded expense needs a category.');
    return { name: form.name || '', price: readAmount(form.price), categoryId: form.categoryId };
  }

  savedMessage(expense) {
    return 'Expense recorded: ' + expense.name + ' | ' + money(expense.amount) + '. Totals updated.';
  }
}

export class ChallengesView {
  render(data) {
    if (data.daysRemaining > 0) {
      return `<p>Recommendations need 28 days of tracking. ${data.daysRemaining} days remaining.</p>`;
    }
    if (!data.ideas.length) return '<p>No recommendation available.</p>';
    const rows = data.ideas.map(idea => [escapeHtml(idea.categoryName), money(idea.current),
      money(idea.recommended) + '/month', money(idea.spent),
      `<form method="post" action="/challenges/respond"><input type="hidden" name="key" value="${escapeHtml(idea.key)}">` +
      '<button name="answer" value="accept">Accept</button> <button name="answer" value="deny">Deny</button></form>']);
    return `<p>Uses last 28 days / 28 x days in this month. Accept changes the budget only.</p>
${table(['Category', 'Current budget', 'Recommended', 'Spent in last 28 days', ''], rows)}`;
  }

  readInput(form, ideas) {
    const idea = ideas.find(item => item.key === form.key);
    if (!idea) throw new Error('That recommendation changed. Review the list again.');
    if (!['accept', 'deny'].includes(form.answer)) throw new Error('Choose accept or deny.');
    return { idea, accept: form.answer === 'accept' };
  }

  resultMessage(accepted) {
    return accepted ? 'Budget updated.' : 'Recommendation dismissed.';
  }
}
