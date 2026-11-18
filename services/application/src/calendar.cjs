'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');

function validateCalendar(value) {
  if (!value || Object.keys(value).some(key => !['cadence', 'time', 'timezone', 'day'].includes(key)) || !['daily', 'weekly', 'monthly'].includes(value.cadence) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || '')) fail(400, 'INVALID_SCHEDULE', 'Choose a daily, weekly or monthly schedule and a valid time.');
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format(); }
  catch { fail(400, 'INVALID_SCHEDULE', 'Choose an IANA timezone such as Europe/Berlin.'); }
  if (typeof value.timezone !== 'string' || !value.timezone.length || value.timezone.length > 80) fail(400, 'INVALID_SCHEDULE', 'A timezone is required.');
  const max = value.cadence === 'weekly' ? 7 : 31;
  if (!Number.isInteger(value.day) || value.day < 1 || value.day > max) fail(400, 'INVALID_SCHEDULE', 'Choose a valid day. Monday is 1; Sunday is 7.');
  return { cadence: value.cadence, time: value.time, timezone: value.timezone, day: value.day };
}
function clock(timezone) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return timestamp => Object.fromEntries(formatter.formatToParts(timestamp).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
// Calendar days, not 24-hour durations. Nonexistent DST times are skipped;
// ambiguous times use the first occurrence only. Short months skip absent dates.
function nextOccurrence(calendar, after) {
  const local = clock(calendar.timezone), current = local(after);
  const [hour, minute] = calendar.time.split(':').map(Number);
  const firstDay = Date.UTC(current.year, current.month - 1, current.day);
  for (let offset = 0; offset < 370; offset++) {
    const date = new Date(firstDay + offset * 86400000);
    if (calendar.cadence === 'weekly' && (date.getUTCDay() || 7) !== calendar.day) continue;
    if (calendar.cadence === 'monthly' && date.getUTCDate() !== calendar.day) continue;
    const wall = date.getTime() + hour * 3600000 + minute * 60000;
    const offsets = new Set();
    for (const delta of [-86400000, 0, 86400000]) {
      const probe = wall + delta, parts = local(probe);
      offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - probe);
    }
    const candidates = [...offsets].map(zoneOffset => wall - zoneOffset).filter(candidate => {
      const parts = local(candidate);
      return parts.year === date.getUTCFullYear() && parts.month === date.getUTCMonth() + 1 && parts.day === date.getUTCDate() && parts.hour === hour && parts.minute === minute;
    }).sort((a, b) => a - b);
    if (candidates.length && candidates[0] > after) return candidates[0];
  }
  throw new Error('No calendar occurrence within the supported horizon');
}
function monthKey(calendar, timestamp) {
  const parts = clock(calendar.timezone)(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}
module.exports = { validateCalendar, nextOccurrence, monthKey };
