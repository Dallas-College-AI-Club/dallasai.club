import { PUBLISHED } from './published.js';
export const articles = PUBLISHED.articles;
export const PUBLICATION = PUBLISHED.publication;
export const readingMinutes = (article) =>
  Math.max(1, Math.ceil(article.paragraphs.join(' ').split(/\s+/).length / 200));
