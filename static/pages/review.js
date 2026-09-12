import { articles, PUBLICATION, readingMinutes as minutes } from '../content/articles.js';
import { articleUrl, findArticle } from '../content/article-links.js';
const meta = (a) => `${a.category} <span>·</span> ${minutes(a)} min read`;
const attribute = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const articleDate = (article, month = 'long') => {
  const date = new Date(article.publishedAt || article.date || '');
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month,
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : '';
};
const masthead = () =>
  /* HTML */ `<div class="publication-masthead">
    <div class="publication-top">
      <span>DALLAS COLLEGE AI CLUB</span><span>${PUBLICATION.edition}</span>
    </div>
    <div class="publication-name">
      The AI Review<span>Ideas worth<br />thinking through.</span>
    </div>
    <div class="publication-rule">
      <span>Student perspectives on AI, research & the world around us.</span>
      <div class="review-actions">
        <button data-open="contribute">Contribute an article ↗</button
        ><button data-open="subscribe">Subscribe ↗</button>
      </div>
    </div>
  </div>`;

export function renderPublication(root, id, reference, { open }) {
  const article = reference == null ? articles[0] : findArticle(articles, reference);
  const filters = ['All articles', ...new Set(articles.map((article) => article.category))];
  document.body.classList.add('reading');
  root.classList.add('publication');
  root.classList.toggle('reader-page', id === 'article');
  root.innerHTML = masthead();
  if (id !== 'article') {
    const heading = root.querySelector('.publication-name');
    const h1 = document.createElement('h1');
    h1.className = heading.className;
    h1.innerHTML = heading.innerHTML;
    heading.replaceWith(h1);
  }
  if (id === 'article' && !article) {
    document.title = 'Article unavailable | The AI Review';
    root.insertAdjacentHTML(
      'beforeend',
      /* HTML */ `<section class="reader">
        <header class="reader-header">
          <p class="article-kicker">THE AI REVIEW</p>
          <h1>This article is unavailable.</h1>
          <p class="standfirst">
            The link may be incomplete, or the article may have been removed.
          </p>
          <button data-open="journal">Browse all articles ↗</button>
        </header>
      </section>`,
    );
  } else if (id === 'article') {
    const a = article;
    document.title = a.title + ' | The AI Review';
    root.insertAdjacentHTML(
      'beforeend',
      /* HTML */ `<div class="article-crumb">
          <button data-open="journal">← All articles</button><span>${a.section}</span>
        </div>
        <article class="reader">
          <header class="reader-header">
            <p class="article-kicker">${a.category} / ${a.section}</p>
            <h1>${a.title}</h1>
            <p class="standfirst">${a.abstract}</p>
            <div class="reader-byline">
              <span class="byline-monogram" aria-hidden="true">ai</span>
              <div>
                <strong>${a.author || 'Dallas College AI Club'}</strong
                ><span
                  >${articleDate(a) ? `${articleDate(a)} <i>·</i> ` : ''}${minutes(a)} min
                  read${a.editor ? ` <i>·</i> Edited by ${a.editor}` : ''}</span
                >
              </div>
              <button id="print-article" aria-label="Print this article">Print ↗</button>
            </div>
            ${
              a.isSample
                ? /* HTML */ `<p class="sample-credit">
                    Sample article. Published student work will include author and editor credits.
                  </p>`
                : ''
            }
          </header>
          <div class="article-columns">
            <aside class="article-toc" ${a.headings.length || a.references.length ? '' : 'hidden'}>
              <span>IN THIS ARTICLE</span
              >${a.headings.map((h, i) => /* HTML */ `<a href="#${attribute(a.headingIds?.[i] || 'section-' + i)}">${h}</a>`).join('')}${a.references.length ? '<a href="#article-references">References</a>' : ''}
            </aside>
            <div class="reader-body">
              ${a.bodyHtml || a.paragraphs.map((p, i) => (i % 2 === 0 ? /* HTML */ `<h2 id="section-${i / 2}">${a.headings[i / 2]}</h2>` : '') + /* HTML */ `<p>${p}</p>`).join('')}
              ${
                a.takeaway
                  ? /* HTML */ `<aside class="article-takeaway">
                      <span>TAKE IT FURTHER</span>
                      <p>${a.takeaway.text}</p>
                      <button data-open="${a.takeaway.mode}">${a.takeaway.label} →</button>
                    </aside>`
                  : ''
              }
              <section
                class="article-references"
                id="article-references"
                ${a.references.length ? '' : 'hidden'}
              >
                <h2>References & further reading</h2>
                <ol>
                  ${a.references.map(([author, title, href]) => /* HTML */ `<li><span>${author}</span><a href="${href}" target="_blank" rel="noreferrer">${title} ↗</a></li>`).join('')}
                </ol>
              </section>
              <footer class="article-end">
                <strong>About this edition</strong>
                <p>${PUBLICATION.note}</p>
                <button data-open="contribute">Develop an article of your own ↗</button>
              </footer>
            </div>
          </div>
        </article>
        <section class="related-reading">
          <p class="article-kicker">CONTINUE READING</p>
          ${articles
            .map((other) =>
              other === a
                ? ''
                : /* HTML */ `<a href="${articleUrl(other)}" data-read="${other.slug}"
                    ><span>${other.category}</span>
                    <h2>${other.title}</h2>
                    <b>↗</b></a
                  >`,
            )
            .join('')}
        </section>`,
    );
    root.querySelector('#print-article').onclick = () => window.print();
  } else {
    root.insertAdjacentHTML(
      'beforeend',
      /* HTML */ `<div class="publication-filter" aria-label="Filter articles">
          ${filters.map((f, i) => /* HTML */ `<button data-filter="${attribute(f)}" aria-pressed="${i === 0}">${f === 'Essay' ? 'Essays' : f === 'Reflection' ? 'Reflections' : f === 'Method note' ? 'Method notes' : f}</button>`).join('')}<span
            >${String(articles.length).padStart(2, '0')}
            ${articles.length === 1 ? 'ARTICLE' : 'ARTICLES'}</span
          >
        </div>
        <section id="publication-stories"></section>
        <div class="publication-callout">
          <div>
            <span class="article-kicker">THE NEXT IDEA COULD BE YOURS</span>
            <h2>Good questions deserve a place.</h2>
            <p>
              Essays, research notes, experiments, and thoughtful reflections from across the club.
            </p>
          </div>
          <button data-open="contribute">Start a draft ↗</button>
        </div>
        <p class="edition-note">${PUBLICATION.note}</p>`,
    );
    const draw = (filter) => {
      const list = articles
        .map((a, i) => ({ ...a, index: i }))
        .filter((a) => filter === 'All articles' || a.category === filter);
      root.querySelector('#publication-stories').innerHTML = list.length
        ? list
            .map(
              (a, i) =>
                /* HTML */ `<article class="publication-story">
                  <div class="story-index">
                    ${String(a.index + 1).padStart(2, '0')}<span>${a.section}</span>
                  </div>
                  <div class="story-main">
                    <p class="article-kicker">${meta(a)}</p>
                    <h2><a href="${articleUrl(a)}" data-read="${a.slug}">${a.title}</a></h2>
                    <p>${a.abstract}</p>
                    <div class="story-byline">
                      <span>${a.author || 'Dallas College AI Club'}</span
                      ><span>${articleDate(a, 'short')}</span>
                    </div>
                  </div>
                  <a
                    class="story-read"
                    href="${articleUrl(a)}"
                    data-read="${a.slug}"
                    aria-label="Read ${attribute(a.title)}"
                    >↗</a
                  >
                </article>`,
            )
            .join('')
        : '<p class="edition-note">No articles are available in this selection yet.</p>';
      bindReads();
    };
    root.querySelectorAll('[data-filter]').forEach(
      (b) =>
        (b.onclick = () => {
          root
            .querySelectorAll('[data-filter]')
            .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          draw(b.dataset.filter);
        }),
    );
    draw('All articles');
  }
  function bindReads() {
    root.querySelectorAll('[data-read]').forEach(
      (a) =>
        (a.onclick = (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          open('article', a.dataset.read);
        }),
    );
  }
  bindReads();
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => open(b.dataset.open)));
  return () => {
    document.body.classList.remove('reading');
    root.classList.remove('publication', 'reader-page');
  };
}
