# Version 2: explicit application flow

User requested a separate implementation; BudgetBuddy-JS must remain unchanged.
Preserve terminal features and domain behavior while separating view/controller/
facade/services. No external packages or Google/cloud integration.

Required purchase flow: AffordabilityView.readInput ->
AffordabilityController.handleCheckClicked -> ServiceHub.canAfford ->
AffordabilityService.evaluatePurchase -> SpendingService and RecurringService ->
returned result -> controller -> AffordabilityView.showResult.

Other menus use controllers and the same ServiceHub, not direct model access from
views. Reuse Account/Transaction/BudgetCategory and the imported FinancialCalendar
and RecurringItem as domain objects. Explicit monthly income/expense calculators
feed SpendingService; RecurringService wraps scheduling and upcoming bills.
Storage still writes one local JSON file, version2 has its own default data path.
Do not add unused DAO/cloud layers simply to reproduce boxes from the old diagram.

- [x] Preserve behavior tests, add failing service/controller flow tests.
- [x] Implement services and ServiceHub with unchanged math.
- [x] Split presentation and controller responsibilities; wire in main.js.
- [x] Run all tests and a terminal smoke test, review and document class flow.
- [x] Verify original files against SHA256 baseline and open version2 in VS Code.

Existing diagram's old timed challenge operations are superseded by the agreed
accept/deny budget recommendations. Date/savings limitations are inherited from v1.

Verification: 16 tests pass, including the actual routing chain, display-only view,
all original domain regression scenarios and CLI setup/add/delete/check/restart.
Independent review verified the route and unchanged v1 checksums. The one minor
overview warning parity issue was restored and covered by a regression test.
VS Code opened Version2 in a separate window; v1's window/data were preserved.

## Update 2026-11-24: terminal replaced by a basic web page

The notes above describe the terminal version, now kept in terminal-version.zip.
main.js, views.js and controllers.js were rewritten for plain HTML and server.js was
added. Services, ServiceHub, models and Storage were not changed. 22 tests pass.

## Update 2026-11-24: DAOs added behind ServiceHub

The user asked for DAOs, replacing the earlier "do not add DAO layers" note above.
daos.js was added; storage.js, service-hub.js and main.js were changed. Views,
controllers, server, services, models and the saved file format were not changed.
29 tests pass, including one that compares the file with memory after every action.
