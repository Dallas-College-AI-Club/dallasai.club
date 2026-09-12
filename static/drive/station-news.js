import { stationUpdates } from '../content/discovery.js';
export { stationUpdates };
export const stationNews = (id) => stationUpdates(id)[0];
export const updateRewardKey = (news) => 'news-next:' + news.id;
// Uses the existing arrival card so there is only one destination surface.
export class StationNewsBubble {
  constructor(journey) {
    this.journey = journey;
    this.current = null;
    this.indices = new Map();
    this.node = document.querySelector('#walk-arrival');
    this.node.classList.add('drive-news-card');
    this.node.insertAdjacentHTML(
      'afterbegin',
      '<div class="arrival-news-meta"><span id="arrival-news-label"></span><span id="arrival-news-count"></span></div>',
    );
    const row = document.createElement('div');
    row.className = 'arrival-news-actions';
    const preview = document.querySelector('#preview-toggle');
    preview.before(row);
    row.append(preview);
    this.next = document.createElement('button');
    this.next.className = 'news-next';
    row.append(this.next);
    this.next.onclick = () => this.advance();
    document.querySelector('#enter-place').onclick = () => this.open();
    const content = document.createElement('div');
    content.className = 'arrival-news-content';
    for (const child of [...this.node.children])
      if (!child.classList.contains('arrival-news-meta')) content.append(child);
    this.node.append(content);
    const close = document.createElement('button');
    close.className = 'panel-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close station update');
    close.textContent = '×';
    close.onclick = () => this.dismiss();
    this.node.append(close);
    this.mobileOpen = document.createElement('button');
    this.mobileOpen.className = 'news-mobile-open';
    this.mobileOpen.type = 'button';
    this.mobileOpen.setAttribute('aria-expanded', 'false');
    this.mobileOpen.innerHTML = '<strong></strong><span>Read update ↗</span>';
    this.node.insertBefore(this.mobileOpen, content);
    this.mobileOpen.onclick = () => {
      this.node.classList.add('is-reading');
      this.mobileOpen.setAttribute('aria-expanded', 'true');
      this.journey.world.speed = 0;
      this.journey.world.keys = {};
      this.journey.world.driveInput = null;
      close.focus({ preventScroll: true });
    };
    const titleObserver = new MutationObserver(() => {
      this.mobileOpen.querySelector('strong').textContent =
        this.node.querySelector('#arrival-title').textContent;
    });
    titleObserver.observe(this.node.querySelector('#arrival-title'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.reopen = document.createElement('button');
    this.reopen.type = 'button';
    this.reopen.className = 'arrival-reopen';
    this.reopen.hidden = true;
    this.reopen.textContent = 'Station updates';
    this.reopen.onclick = () => {
      this.dismissed = null;
      this.reopen.hidden = true;
      this.render();
      content.scrollTop = 0;
    };
    this.node.after(this.reopen);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.journey.active && !this.node.hidden) {
        e.preventDefault();
        this.dismiss();
      }
    });
  }
  show(place) {
    if (!place) {
      this.dismissed = null;
      this.clear();
      return;
    }
    const key = place.campus.id + '/' + place.stop.id;
    if (this.dismissed === key) {
      this.current = key;
      this.reopen.hidden = false;
      return;
    }
    if (this.current === key && !this.node.hidden) return;
    this.reopen.hidden = true;
    this.current = key;
    this.items = stationUpdates(place.stop.id);
    if (!this.items.length)
      this.items = [
        {
          id: place.stop.id + '-empty',
          label: 'CLUB INFORMATION',
          title: place.stop.title,
          body: 'There are no updates in this section yet.',
          action: 'Open ' + place.stop.title,
          mode: place.stop.id,
        },
      ];
    this.index = (this.indices.get(key) || 0) % this.items.length;
    this.render();
    const score = this.journey.world.experience.score;
    if (score) {
      score.collected.add(updateRewardKey(this.items[this.index]));
      this.journey.world.experience.persist();
    }
    this.renderNext();
  }
  renderNext() {
    const next = this.items[(this.index + 1) % this.items.length],
      earned = this.journey.world.experience.score?.collected.has(updateRewardKey(next));
    this.next.textContent = earned ? 'Next update →' : 'Next update · +30 →';
    this.next.disabled = this.items.length < 2;
  }
  render() {
    const news = this.items[this.index],
      q = (s) => this.node.querySelector(s);
    this.node.hidden = false;
    q('#arrival-news-label').textContent = news.label;
    q('#arrival-news-count').textContent = this.index + 1 + ' / ' + this.items.length;
    q('#arrival-title').textContent = news.title;
    q('#arrival-hint').textContent = news.body;
    q('#enter-place').textContent = news.action + ' ↗';
    const mode =
      news.mode === 'article'
        ? 'journal'
        : ['ethics', 'compare', 'drift'].includes(news.mode)
          ? 'lab'
          : news.mode;
    q('#arrival-preview').hidden = true;
    q('#preview-toggle').setAttribute('aria-expanded', 'false');
    q('#arrival-preview').dataset.page = mode;
    q('#preview-image').src = 'assets/page-previews/' + mode + '.png';
    q('#preview-image').alt = mode + ' page preview';
    q('#preview-label').textContent = news.label;
    this.renderNext();
  }
  advance() {
    if (this.node.hidden || !this.journey.active) return;
    this.index = (this.index + 1) % this.items.length;
    this.indices.set(this.current, this.index);
    const experience = this.journey.world.experience,
      news = this.items[this.index];
    if (experience.score?.bonus(updateRewardKey(news), 30, 'New club update')) {
      experience.render();
      experience.persist();
      experience.toast('+30 · New club update', performance.now());
    }
    this.render();
    this.node.querySelector('.arrival-news-content').scrollTop = 0;
  }
  open() {
    if (this.node.hidden || !this.items) return false;
    const news = this.items[this.index];
    this.journey.openPlace(news.mode, news.article || 0);
    return true;
  }
  dismiss() {
    this.dismissed = this.current;
    this.node.hidden = true;
    this.node.classList.remove('is-reading');
    this.mobileOpen.setAttribute('aria-expanded', 'false');
    this.node.querySelector('#arrival-preview').hidden = true;
    this.reopen.hidden = false;
    this.reopen.focus({ preventScroll: true });
  }
  clear() {
    this.node.hidden = true;
    this.node.classList.remove('is-reading');
    this.mobileOpen.setAttribute('aria-expanded', 'false');
    this.reopen.hidden = true;
    this.current = null;
  }
}
