import { Account, Transaction, BudgetCategory } from './account.js';
import { FinancialCalendar, RecurringItem } from './calendar.js';

// DAO = Data Access Object. Each DAO finds, inserts, updates and deletes one kind of
// saved record, and turns records into model objects. DAOs contain no budgeting rules.
// They hand out copies, so saved data only changes through insert, update or delete.

// The operations shared by every DAO whose records are a list with ids.
// A subclass says where its records are (rows) and how to build its object (toObject).
class RecordDAO {
  constructor(storage) {
    this.storage = storage;
  }

  findAll() {
    return this.rows().map(row => this.toObject(structuredClone(row)));
  }

  findById(id) {
    const row = this.rows().find(item => item.id === id);
    return row ? this.toObject(structuredClone(row)) : null;
  }

  insert(object) {
    if (this.findById(object.id)) throw new Error('That record is already saved.');
    this.rows().push(structuredClone(object));
  }

  // Inserts only the objects that are not saved yet.
  insertMissing(objects) {
    const saved = new Set(this.rows().map(row => row.id));
    for (const object of objects) if (!saved.has(object.id)) this.insert(object);
  }

  update(object) {
    this.rows()[this.indexOf(object.id)] = structuredClone(object);
  }

  delete(id) {
    this.rows().splice(this.indexOf(id), 1);
  }

  indexOf(id) {
    const index = this.rows().findIndex(row => row.id === id);
    if (index === -1) throw new Error('Saved record not found.');
    return index;
  }
}

export class TransactionDAO extends RecordDAO {
  rows() { return this.storage.data.account.transactions; }
  toObject(row) { return new Transaction(row); }
}

export class BudgetDAO extends RecordDAO {
  rows() { return this.storage.data.account.categories; }
  toObject(row) { return new BudgetCategory(row.name, row.amount, row.flexible, row.createdAt, row.id); }
}

export class RecurringDAO extends RecordDAO {
  rows() { return this.storage.data.rules; }
  toObject(row) { return new RecurringItem(row); }
}

// There is one account, so it has find and update instead of a list.
// Its transactions and categories belong to TransactionDAO and BudgetDAO.
export class AccountDAO {
  constructor(storage) {
    this.storage = storage;
  }

  find() {
    const row = structuredClone(this.storage.data.account);
    const account = new Account(row.historyStart);
    account.setupComplete = row.setupComplete;
    account.setupStage = row.setupStage || (row.setupComplete ? 'complete' : 'income');
    account.deletedOccurrences = row.deletedOccurrences;
    account.challengeResponses = row.challengeResponses;
    return account;
  }

  update(account) {
    const { setupComplete, setupStage, deletedOccurrences, challengeResponses } = account;
    Object.assign(this.storage.data.account,
      structuredClone({ setupComplete, setupStage, deletedOccurrences, challengeResponses }));
  }
}

// Groups the four DAOs so one action can use several of them and save just once.
export class DAOManager {
  constructor(storage) {
    this.storage = storage;
    this.accounts = new AccountDAO(storage);
    this.transactions = new TransactionDAO(storage);
    this.budgets = new BudgetDAO(storage);
    this.recurring = new RecurringDAO(storage);
  }

  // Builds the models from saved records when the program starts.
  loadModels() {
    const account = this.accounts.find();
    account.categories = this.budgets.findAll();
    account.transactions = this.transactions.findAll();
    const calendar = new FinancialCalendar();
    calendar.rules = this.recurring.findAll();
    // Every saved expense must point to a saved category.
    for (const item of [...account.transactions, ...calendar.rules]) {
      if (item.type === 'expense') account.getCategory(item.categoryId);
    }
    return { account, calendar };
  }

  commit() {
    this.storage.commit();
  }
}
