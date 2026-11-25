import { addDays, daysBetween, daysInMonth } from './helpers.js';

// A challenge is now a suggested budget change, not a timed competition.
export class ChallengesService {
  constructor(account) {
    this.account = account;
  }

  suggest(today) {
    const ideas = [];
    if (daysBetween(this.account.historyStart, today) < 28) return ideas;
    const from = addDays(today, -27); // 28 calendar dates, including today
    for (const category of this.account.categories) {
      if (!category.flexible || daysBetween(category.createdAt, today) < 28) continue;
      const spent = this.account.spentBetween(category.id, from, today);
      const recommended = Math.round(spent / 28 * daysInMonth(today));
      const key = category.id + ':' + today.slice(0, 7) + ':' + category.amount + ':' + recommended;
      const answered = this.account.challengeResponses.some(r => r.key === key);
      if (spent > 0 && recommended < category.amount && !answered) {
        ideas.push({ key, categoryId: category.id, current: category.amount, recommended, spent });
      }
    }
    return ideas;
  }

  accept(idea, today) {
    this.checkCurrent(idea, today);
    this.account.getCategory(idea.categoryId).setBudget(idea.recommended);
    this.account.challengeResponses.push({ key: idea.key, answer: 'accepted', date: today });
  }

  deny(idea, today) {
    this.checkCurrent(idea, today);
    this.account.challengeResponses.push({ key: idea.key, answer: 'denied', date: today });
  }

  checkCurrent(idea, today) {
    if (!this.suggest(today).some(current => current.key === idea.key)) {
      throw new Error('That recommendation changed. Open Challenges again.');
    }
  }
}
