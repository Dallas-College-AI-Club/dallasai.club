// Keep deep links intact when changing preferences or navigating browser history.
export function routeFromUrl(value) {
  const url = new URL(value, 'https://dallasai.club/');
  const article = url.searchParams.get('article');
  let anchor = url.hash.slice(1);
  try {
    anchor = decodeURIComponent(anchor);
  } catch {
    // A malformed bookmark should not prevent the rest of the page from opening.
  }
  return {
    mode: url.searchParams.get('mode') || 'summary',
    article: article !== null && /^\d+$/.test(article) ? Number(article) : article,
    event: url.searchParams.get('event'),
    anchor,
  };
}
