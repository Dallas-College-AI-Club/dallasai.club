export const DISCOVERY_IDS = ['arcade', 'drive', 'ride', 'snake'];
export const DISCOVERY_POINTS = 25;
const KEY = 'dc-coladde-discoveries-v1';
export function createDiscoveries(getStorage = () => globalThis.localStorage) {
  const found = new Set();
  let persistent = true;
  function read() {
    try {
      const saved = JSON.parse(getStorage().getItem(KEY) || '[]');
      if (Array.isArray(saved))
        for (const id of saved) if (DISCOVERY_IDS.includes(id)) found.add(id);
    } catch {
      persistent = false;
    }
    return {
      found: [...found],
      total: found.size * DISCOVERY_POINTS,
      persistent,
    };
  }
  return {
    read,
    claim(id) {
      read();
      const added = DISCOVERY_IDS.includes(id) && !found.has(id);
      if (added) found.add(id);
      try {
        getStorage().setItem(KEY, JSON.stringify([...found]));
        persistent = true;
      } catch {
        persistent = false;
      }
      return { ...read(), added };
    },
  };
}
