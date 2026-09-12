export function articleUrl(article) {
  const slug = typeof article === 'string' ? article : article.slug;
  return 'club.html?' + new URLSearchParams({ mode: 'article', article: slug });
}

export function findArticle(articles, reference) {
  if (reference == null) return;
  const value = String(reference);
  const article = articles.find((article) => article.slug === value);
  if (article) return article;
  if (/^\d+$/.test(value)) {
    const legacyIndex = Number(value);
    if (Number.isSafeInteger(legacyIndex))
      return articles.find((article) => article.legacyIndex === legacyIndex);
  }
}
