const KEY = 'dc-ai-event-plans-v1';
export function readEventPlans(storage) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
export function saveEventPlan(id, going, storage) {
  try {
    const target = storage || globalThis.localStorage,
      plans = new Set(readEventPlans(target));
    if (going) plans.add(id);
    else plans.delete(id);
    target.setItem(KEY, JSON.stringify([...plans]));
    return true;
  } catch {
    return false;
  }
}
