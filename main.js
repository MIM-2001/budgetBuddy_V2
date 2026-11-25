import { fileURLToPath } from 'node:url';
import { Storage } from './storage.js';
import { DAOManager } from './daos.js';
import { ServiceHub } from './service-hub.js';
import { createWebServer } from './server.js';
import { today } from './helpers.js';
import { PageView, OverviewView, SetupView, TransactionView, BudgetView, CalendarView,
  AffordabilityView, ChallengesView } from './views.js';
import { AppController, OverviewController, SetupController, TransactionController, BudgetController,
  CalendarController, AffordabilityController, ChallengesController } from './controllers.js';

// Create and connect the objects here. There is no budgeting logic in main.js.
function stop(error) {
  console.error('BudgetBuddy stopped: ' + error.message);
  process.exit(1);
}

try {
  const path = process.env.BUDGETBUDDY_DATA || fileURLToPath(new URL('./data/budget.json', import.meta.url));
  const port = Number(process.env.BUDGETBUDDY_PORT || 4000);
  const storage = new Storage(path);
  storage.open(today());
  const daos = new DAOManager(storage);
  const { account, calendar } = daos.loadModels();
  const serviceHub = new ServiceHub(account, calendar, daos);

  const transactions = new TransactionController(new TransactionView(), serviceHub);
  const app = new AppController(new PageView(), serviceHub, {
    transactions,
    overview: new OverviewController(new OverviewView(), serviceHub),
    recurring: new CalendarController(new CalendarView(), serviceHub, transactions),
    budgets: new BudgetController(new BudgetView(), serviceHub),
    affordability: new AffordabilityController(new AffordabilityView(), serviceHub),
    challenges: new ChallengesController(new ChallengesView(), serviceHub),
    setup: new SetupController(new SetupView(), serviceHub, transactions)
  });

  const server = createWebServer(app, stop);
  server.on('error', error => stop(error.code === 'EADDRINUSE' ?
    new Error('port ' + port + ' is already in use. BudgetBuddy may already be running, or try another port: ' +
      'BUDGETBUDDY_PORT=4001 bash run.command') : error));
  // 127.0.0.1 means only this computer can connect.
  server.listen(port, '127.0.0.1', () => {
    console.log('Data file: ' + path);
    console.log('BudgetBuddy is running. Open http://127.0.0.1:' + server.address().port + ' in your browser.');
    console.log('Press Ctrl+C to stop.');
  });
} catch (error) { stop(error); }
