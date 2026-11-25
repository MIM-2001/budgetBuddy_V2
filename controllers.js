import { today } from './helpers.js';

// Controllers coordinate views and the facade; they do not calculate budgets.
// show() returns a page's HTML. handle...() runs a submitted form and returns
// { message } to go back to the page, or { body } to show HTML right away.

export class OverviewController {
  constructor(view, serviceHub) {
    this.view = view;
    this.serviceHub = serviceHub;
  }

  show(date) {
    return this.view.render(this.serviceHub.getDashboard(date), date);
  }
}

export class AffordabilityController {
  constructor(view, serviceHub) {
    this.view = view;
    this.serviceHub = serviceHub;
  }

  show(date, values) {
    return this.view.form(this.serviceHub.getBudgets(date), values);
  }

  handleCheckClicked(form, date) {
    const input = this.view.readInput(form);
    const result = this.serviceHub.canAfford(input.price, input.categoryId, date);
    return { body: this.view.showResult(result, input, this.serviceHub.getBudgets(date)) };
  }

  handleRecordClicked(form, date) {
    const purchase = this.view.readExpenseInput(form);
    const expense = { type: 'expense', name: purchase.name, amount: purchase.price,
      date, categoryId: purchase.categoryId, repeating: false };
    this.serviceHub.saveTransaction(expense, date);
    return { message: this.view.savedMessage(expense) };
  }
}

export class TransactionController {
  constructor(view, serviceHub) {
    this.view = view;
    this.serviceHub = serviceHub;
  }

  // Also used by CalendarController and SetupController, which share this form.
  form(action, date, settings) {
    return this.view.form(action, this.serviceHub.getBudgets(date), date, settings);
  }

  show(date, values) {
    return this.view.render(this.serviceHub.getTransactions(), this.form('/transactions/add', date, { values }));
  }

  handleSave(form, date, alwaysRecurring = false) {
    const input = this.view.readInput(form, alwaysRecurring);
    return { message: this.view.savedMessage(this.serviceHub.saveTransaction(input, date)) };
  }

  handleDelete(form) {
    this.serviceHub.deleteTransaction(form.id);
    return { message: this.view.deletedMessage() };
  }
}

export class BudgetController {
  constructor(view, serviceHub) {
    this.view = view;
    this.serviceHub = serviceHub;
  }

  show(date, values) {
    return this.view.render(this.serviceHub.getBudgets(date), values);
  }

  handleSave(form, date) {
    this.serviceHub.saveBudget(this.view.readInput(form), date);
    return { message: this.view.savedMessage() };
  }
}

export class CalendarController {
  constructor(view, serviceHub, transactionController) {
    this.view = view;
    this.serviceHub = serviceHub;
    this.transactionController = transactionController;
  }

  show(date, values) {
    const form = this.transactionController.form('/recurring/add', date, { alwaysRecurring: true, values });
    return this.view.render(this.serviceHub.getRecurringItems(), form);
  }

  handleAdd(form, date) {
    return this.transactionController.handleSave(form, date, true);
  }

  handleStop(form) {
    this.serviceHub.stopRecurring(form.id);
    return { message: this.view.updatedMessage() };
  }

  handleChangeAmount(form) {
    const input = this.view.readAmountInput(form);
    this.serviceHub.changeRecurringAmount(input.id, input.amount);
    return { message: this.view.updatedMessage() };
  }
}

export class ChallengesController {
  constructor(view, serviceHub) {
    this.view = view;
    this.serviceHub = serviceHub;
  }

  show(date) {
    return this.view.render(this.serviceHub.getChallenges(date));
  }

  handleRespond(form, date) {
    const input = this.view.readInput(form, this.serviceHub.getChallenges(date).ideas);
    this.serviceHub.respondToChallenge(input.idea, input.accept, date);
    return { message: this.view.resultMessage(input.accept) };
  }
}

export class SetupController {
  constructor(view, serviceHub, transactionController) {
    this.view = view;
    this.serviceHub = serviceHub;
    this.transactionController = transactionController;
  }

  show(date, values) {
    const type = this.serviceHub.setupState().stage === 'income' ? 'income' : 'expense';
    const form = this.transactionController.form('/setup/add', date, { type, alwaysRecurring: true, values });
    const items = this.serviceHub.getRecurringItems().filter(item => item.type === type);
    if (type === 'income') return this.view.showIncome(items, form);
    return this.view.showExpenses(items, this.serviceHub.getBudgets(date), form);
  }

  handleAdd(form, date) {
    return this.transactionController.handleSave(form, date, true);
  }

  handleFinishIncome(date) {
    this.serviceHub.finishIncomeSetup(date);
    return { message: this.view.incomeSavedMessage() };
  }

  handleFinish() {
    if (this.serviceHub.setupState().stage === 'income') throw new Error('Finish the income step first.');
    this.serviceHub.finishSetup();
    return { message: this.view.setupSavedMessage() };
  }
}

// Decides which controller handles each web address.
export class AppController {
  constructor(view, serviceHub, controllers) {
    const { overview, transactions, recurring, budgets, affordability, challenges, setup } = controllers;
    this.view = view;
    this.serviceHub = serviceHub;
    this.messages = []; // Shown once, on the next page.

    // GET: show a page.
    this.pages = {
      '/': { title: 'Overview', controller: overview },
      '/transactions': { title: 'Transactions', controller: transactions },
      '/recurring': { title: 'Recurring Items', controller: recurring },
      '/budgets': { title: 'Monthly Budgets', controller: budgets },
      '/affordability': { title: 'Can I Afford This?', controller: affordability },
      '/challenges': { title: 'Challenges: Budget Recommendations', controller: challenges },
      '/setup': { title: 'First-Time Setup', controller: setup }
    };

    // POST: a form was submitted.
    this.actions = {
      '/transactions/add': (form, date) => transactions.handleSave(form, date),
      '/transactions/delete': form => transactions.handleDelete(form),
      '/recurring/add': (form, date) => recurring.handleAdd(form, date),
      '/recurring/stop': form => recurring.handleStop(form),
      '/recurring/amount': form => recurring.handleChangeAmount(form),
      '/budgets/add': (form, date) => budgets.handleSave(form, date),
      '/budgets/edit': (form, date) => budgets.handleSave(form, date),
      '/affordability/check': (form, date) => affordability.handleCheckClicked(form, date),
      '/affordability/record': (form, date) => affordability.handleRecordClicked(form, date),
      '/challenges/respond': (form, date) => challenges.handleRespond(form, date),
      '/setup/add': (form, date) => setup.handleAdd(form, date),
      '/setup/finish-income': (form, date) => setup.handleFinishIncome(date),
      '/setup/finish': () => setup.handleFinish()
    };
  }

  // Returns { redirect } or { status, html }. The web server sends it.
  handle(method, path, form = {}, date = today()) {
    const pagePath = '/' + path.split('/')[1]; // "/budgets/add" belongs to "/budgets"
    const action = this.actions[path];
    const complete = this.serviceHub.setupState().complete;
    const known = method === 'POST' ? action : method === 'GET' && (this.pages[path] || action);
    if (!known) return { status: 404, html: this.view.render('Page not found', '', [], '', complete) };

    if (!complete && pagePath !== '/setup') return { redirect: '/setup' };
    if (complete && pagePath === '/setup') return { redirect: '/' };
    if (complete) {
      const recorded = this.serviceHub.refresh(date);
      if (recorded) this.messages.push('Automatically recorded ' + recorded + ' due transaction(s).');
    }

    const page = this.pages[pagePath];
    if (method === 'GET') {
      if (action) return { redirect: pagePath }; // A form address typed into the browser.
      return this.render(page.title, page.controller.show(date));
    }
    try {
      const result = action(form, date);
      if (result.body) return this.render(page.title, result.body);
      this.messages.push(result.message);
      return { redirect: pagePath };
    } catch (error) {
      // Disk errors are fatal rather than pretending to save.
      if (error.code) throw error;
      const keepTyped = path.endsWith('/add') || pagePath === '/affordability';
      return this.render(page.title, page.controller.show(date, keepTyped ? form : {}), error.message, 400);
    }
  }

  render(title, body, error = '', status = 200) {
    const messages = this.messages;
    this.messages = [];
    const showMenu = this.serviceHub.setupState().complete;
    return { status, html: this.view.render(title, body, messages, error, showMenu) };
  }
}
