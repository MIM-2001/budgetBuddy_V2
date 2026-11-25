// All saved dates use YYYY-MM-DD. Money is stored as whole cents.
export function today() {
  const date = new Date();
  return makeDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function parseDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Use YYYY-MM-DD for dates.');
  const date = new Date(text + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error('That date does not exist.');
  }
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) throw new Error('Use a year from 1900 through 2100.');
  return date;
}

export function makeDate(year, month, day) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, Math.min(day, lastDay), 12));
  return date.toISOString().slice(0, 10);
}

export function addDays(text, days) {
  const date = parseDate(text);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(first, last) {
  return Math.round((parseDate(last) - parseDate(first)) / 86400000);
}

export function monthEnd(text) {
  const date = parseDate(text);
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 31);
}

export function daysInMonth(text) {
  return parseDate(monthEnd(text)).getUTCDate();
}

export function validAmount(amount, allowZero = false) {
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 100000000000) {
    throw new Error('Enter a valid positive amount (at most $1 billion).');
  }
}

export function money(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
