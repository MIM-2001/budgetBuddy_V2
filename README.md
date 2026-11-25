# BudgetBuddy JavaScript — Version 2: explicit flow

BudgetBuddy with a very basic HTML web page (plain HTML: no CSS, frameworks or npm
packages). Version 1 (BudgetBuddy-JS) is a separate project and was not edited. This
folder uses its own data/budget.json.

The original terminal version of this folder is kept in docs/terminal-version.zip.
The web version replaced only the outer layers (main.js, views.js, controllers.js, new
server.js). DAOs were then added behind ServiceHub (daos.js). The services, models and
saved file format did not change, so existing saved data still loads.

## Run

Open this folder in VS Code and run:

```bash
bash run.command
```

Then open http://127.0.0.1:4000 in a browser. Press Ctrl+C in the terminal to stop.
Every change is saved immediately, so there is no Save and Exit button.

With Node.js 20+ on your PATH, `node main.js` also works. To use another port:

```bash
BUDGETBUDDY_PORT=4001 bash run.command
```

Run all checks:

```bash
bash run.command --test
```

## The purchase flow, step by step

1. User opens **Affordability**, fills in the form and clicks **Can I afford this?**
   The browser sends the form to /affordability/check.
2. server.js passes the form to AppController, which calls
   AffordabilityController.handleCheckClicked().
3. The controller asks AffordabilityView.readInput() to turn the form fields into a
   price (in cents) and an optional category.
4. The controller calls ServiceHub.canAfford(price, categoryId, date).
5. ServiceHub calls AffordabilityService.evaluatePurchase().
6. AffordabilityService calls SpendingService.summary() and RecurringService.unpaidTotal().
7. SpendingService uses MonthlyIncomeCalculator and MonthlyExpenseCalculator to
   read the account's monthly records/estimates. The calculators reuse model query
   methods from Version 1, so this refactor does not change the financial math.
8. RecurringService asks the imported FinancialCalendar for upcoming bills.
9. AffordabilityService applies the existing conditions. When relevant, it calls
   SpendingService.budgetRemaining() for the optional category check.
10. The result returns through ServiceHub to the controller.
11. The controller calls AffordabilityView.showResult(result, ...), which returns HTML.
    server.js sends that HTML to the browser.
12. The result page has an optional form to record the actual purchase. It asks for
    a description and a required category (the checked category is preselected).
    Submitting it calls handleRecordClicked(), which calls ServiceHub.saveTransaction()
    with the checked price, today's date, and type expense. The hub adds a one-time
    transaction to Account, stores it with TransactionDAO.insert(), and commits the
    file once. Then the page confirms it.

```text
Browser form -> server.js -> AppController
          |
AffordabilityController.handleCheckClicked()  <-- AffordabilityView.readInput()
          |
ServiceHub.canAfford()
          |
AffordabilityService.evaluatePurchase()
          |                         |
SpendingService                 RecurringService
    |                               |
Monthly calculators             FinancialCalendar
    |                               |
    +------- domain objects --------+
          |
result -> ServiceHub -> Controller -> AffordabilityView.showResult() -> HTML -> Browser
```

The controller reads input through the view; the view does not directly call the
services. The service returns data and never prints. Only the view produces HTML.
The tests exercise this actual route, including returning the same result object to
the view. A check remains read-only unless the user chooses to record the purchase.

## How data is saved (DAOs)

```text
Controller -> ServiceHub -> services and models   (apply the rules)
                  |
              DAOManager                          (one commit per action)
                  |
  AccountDAO  TransactionDAO  BudgetDAO  RecurringDAO
                  |
              Storage -> data/budget.json
```

| DAO | Saved records | Main operations |
| --- | --- | --- |
| TransactionDAO | Transactions | findAll, findById, insert, insertMissing, update, delete |
| BudgetDAO | Budget categories | same operations |
| RecurringDAO | Recurring rules | same operations |
| AccountDAO | Setup progress, deleted payments, challenge answers | find, update |

TransactionDAO, BudgetDAO and RecurringDAO inherit their operations from RecordDAO.
When the program starts, DAOManager.loadModels() uses the DAOs to build Account and
FinancialCalendar. Calculations use those objects in memory. After a change, ServiceHub
stores exactly what changed through the DAOs, then commits once, so an action that
touches several DAOs is saved completely or not at all. The DAOs share one JSON file,
so a commit rewrites that file. DAOs contain no budgeting rules.

## What each file does

| File | Main classes and responsibility |
| --- | --- |
| main.js | Creates and connects the objects, loads data, and starts the web server |
| server.js | The only HTTP code: reads a browser request, passes it to AppController, sends the result |
| views.js | PageView (shared layout), OverviewView, SetupView, TransactionView, BudgetView, CalendarView, AffordabilityView, ChallengesView; produce HTML and read form fields only |
| controllers.js | AppController (matches web addresses to controllers) and each page's controller; coordinate views and ServiceHub |
| service-hub.js | ServiceHub facade; the shared entry point for controller requests |
| services.js | MonthlyIncomeCalculator, MonthlyExpenseCalculator, SpendingService, RecurringService, AffordabilityService |
| challenges.js | ChallengesService; spending-based budget recommendations and accept/deny logic |
| account.js | Account, Transaction, BudgetCategory; own financial records and model query methods |
| calendar.js | FinancialCalendar and RecurringItem; schedule rules and due occurrences |
| daos.js | AccountDAO, TransactionDAO, BudgetDAO, RecurringDAO, their shared RecordDAO, and DAOManager; find and change saved records and rebuild class instances |
| storage.js | Storage; opens and writes the JSON file |
| helpers.js | Shared date operations, amount validation, and display formatting |
| run.command | Runs the program or tests with available Node.js |
| test/ | Regression checks for financial behavior, the DAOs, the web pages, and layered flow |
| docs/plan.md | Scope and progress of the original terminal refactor |
| docs/terminal-version.zip | Complete copy of the terminal version, without data |
| docs/version1-checksums.json | SHA256 baseline used to verify Version 1 was preserved |

The controllers for other pages also call ServiceHub instead of directly reaching
into Account, FinancialCalendar, the DAOs, or individual feature services. Views
receive simple display data and contain no Account/calendar references.

This matches the requested View/Controller/facade/service route, with DAOs for saved
data. The larger old diagram's Google Drive, profile/sign-in, and visual calendar are
not implemented in this starter. Data is kept in one local JSON file, not a database;
it is not claimed to implement every diagram box.

## Features retained

- Setup collects recurring income, creates editable 50/30/20 starter budgets,
  and collects recurring expenses. Amounts are per payment; dates are YYYY-MM-DD.
- Transactions offers add/list/delete and asks whether each addition repeats.
- Recurring Items offers add, stop, and future amount changes. Stopping preserves
  history. To change frequency/dates, stop the rule and add its replacement from
  the next unpaid date, avoiding duplicate historical payments.
- Monthly, every-14-day, and selected-monthly-day schedules record automatically
  whenever a page opens and catch up after the program was closed.
- Completed setup entries survive interruptions. Occurrences use stable IDs;
  deleting one does not recreate it or stop the whole schedule.
- Affordability and Challenges remain separate pages. After any
  affordability result, including Tight or Not yet, the user can optionally
  record a purchase that actually happened. This records history; it does not
  override the original affordability decision. Future checks use the new expense.

## Financial rules retained

All money is integer cents internally. Budgets use calendar months.

```text
safe = max(0, estimated monthly income - recorded monthly spending
           - upcoming monthly expenses - 10% income buffer)
```

Price above safe returns No; at least 80% of safe returns Tight; above a selected
category's remaining budget returns Tight; otherwise Yes. Checking does not record
a purchase unless the user chooses the separate recording option afterward.
It remains a monthly estimate, not a current bank balance.

Active recurring income is normalized: monthly amount, biweekly amount x 26 / 12,
or amount x selected days per month. Those deposits are not added again as income.
One-time current-month income is added. For stopped income rules, actual deposits
this month count instead. Upcoming bills stop being reserved once recorded as
expenses, preventing double subtraction.

Starter percentages are editable targets. The Savings category does not change
the original affordability formula: it reserves a 10% buffer, not the full 20%
savings allocation. Automatic records assume scheduled payments happened; no bank
verification or financial transfer occurs.

Challenges require 28 elapsed days for the account and category. Recommendations
use last-28-day spending / 28 x days in this month, compared to the monthly budget.
Only flexible categories with positive spending qualify. Wants is flexible by
default; Needs and Savings are protected. Accept updates the budget; deny saves
the response for the same category/month/current-budget/recommended-amount.
There are no seven-day competitions, levels, countdowns, wins, or losses.

Monthly dates preserve their anchor through short months (January 31 -> February
28/29 -> March 31). Selected-day rules allow at most one day from 28–31 so two
payments cannot silently collapse onto the same February date. Dates use
1900–2100. Future one-time actual transactions are not supported; future recurring
rules are. Run one process per data file. Invalid saved data stops loading rather
than overwriting the file.

The page is only reachable from this computer (127.0.0.1). Requests that come from
other websites are refused, and text the user types is escaped before it is shown.

For an isolated demo:

```bash
BUDGETBUDDY_DATA=/tmp/budgetbuddy-v2-demo.json bash run.command
```
