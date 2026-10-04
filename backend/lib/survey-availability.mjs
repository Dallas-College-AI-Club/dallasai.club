import { RequestError } from './errors.mjs';
import { isCalendarDate } from './validation.mjs';
import { availabilityStatuses } from '../surveys/availability-values.js';

const invalid = (message) => {
  throw new RequestError(400, message);
};
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function availabilityDates(dates, required = true) {
  if (
    !Array.isArray(dates) ||
    dates.length > 31 ||
    (required && !dates.length) ||
    dates.some((date) => !isCalendarDate(date)) ||
    new Set(dates).size !== dates.length
  )
    invalid('Choose up to 31 different calendar dates for availability.');
  return [...dates].sort();
}

// An explicit whole-list answer and selected slots are mutually exclusive.
// Empty optional answers stay empty rather than becoming "Not available".
export function validateAvailability(value, question) {
  if (value === '' && !question.required) return '';
  if (
    !exactKeys(value, ['status', 'selections', 'alternatives']) ||
    !Object.hasOwn(availabilityStatuses, value.status) ||
    !Array.isArray(value.selections) ||
    !Array.isArray(value.alternatives) ||
    value.selections.length > question.dates.length ||
    value.alternatives.length > 10
  )
    invalid('Check your availability answer.');
  const selected = new Map();
  for (const slot of value.selections) {
    if (
      !exactKeys(slot, ['date', 'periods']) ||
      !question.dates.includes(slot.date) ||
      selected.has(slot.date) ||
      !Array.isArray(slot.periods) ||
      !slot.periods.length ||
      slot.periods.some((period) => !question.options.includes(period)) ||
      new Set(slot.periods).size !== slot.periods.length
    )
      invalid('Choose listed dates and time periods.');
    selected.set(slot.date, slot.periods);
  }
  if (
    (value.status === 'available' && !selected.size) ||
    (value.status !== 'available' && selected.size)
  )
    invalid('Choose dates or one answer for the whole list.');
  if (
    (!['unavailable', 'alternative'].includes(value.status) &&
      value.alternatives.length) ||
    (value.status === 'alternative' && !value.alternatives.length)
  )
    invalid(
      'Add an alternative date only when suggesting dates or unavailable.',
    );
  const alternatives = new Set();
  for (const slot of value.alternatives) {
    if (
      !exactKeys(slot, ['date', 'time']) ||
      !isCalendarDate(slot.date) ||
      typeof slot.time !== 'string' ||
      (slot.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time)) ||
      alternatives.has(slot.date + '|' + slot.time)
    )
      invalid('Use different alternative dates with valid optional times.');
    alternatives.add(slot.date + '|' + slot.time);
  }
  return {
    status: value.status,
    selections: question.dates
      .filter((date) => selected.has(date))
      .map((date) => ({
        date,
        periods: question.options.filter((period) =>
          selected.get(date).includes(period),
        ),
      })),
    alternatives: value.alternatives.map(({ date, time }) => ({ date, time })),
  };
}
