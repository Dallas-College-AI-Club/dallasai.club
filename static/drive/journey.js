import { mountTouchDrive } from './touch.js';
import { StationNewsBubble } from './station-news.js';
import { DriveWorld } from './world.js';
import { CAMPUSES } from './geography.js';
import { STOPS } from './physics.js';
const $ = (s) => document.querySelector(s);
export class ClubJourney {
  constructor({ reduced = false, onOpen = () => {} } = {}) {
    this.onOpen = onOpen;
    this.campus = CAMPUSES.find((c) => c.id === 'el-centro');
    this.stop = null;
    this.active = true;
    this.world = new DriveWorld($('#club-world'), {
      reduced,
      onStatus: (text) => ($('#journey-status').textContent = text),
      onArrive: (place) => this.arrive(place),
      onProgress: (n, target) => {
        const route = $('#drive-route');
        route.hidden = !target;
        if (target) {
          if (!target.place) {
            this.campus = target.campus;
            $('#campus-select').value = this.campus.id;
          }
          $('#route-caption').textContent =
            (target.stop ? STOPS.find((s) => s.id === target.stop).title + ' · ' : '') +
            target.campus.name;
          $('#route-progress').value = n;
        }
      },
      onView: (overview) => {
        $('#camera-mode').textContent = overview ? 'Follow the car' : 'Dallas map';
        $('#camera-mode').setAttribute('aria-pressed', String(overview));
        $('#journey-stage').dataset.view = overview ? 'map' : 'drive';
      },
      onEnter: (id) => {
        if (!this.newsBubble?.open()) this.openPlace(id);
      },
    });
    for (const c of CAMPUSES) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      $('#campus-select').append(o);
    }
    $('#campus-select').value = this.campus.id;
    $('#campus-select').onchange = (e) => this.goCampus(e.target.value);
    for (const s of STOPS) {
      const b = document.createElement('button');
      b.dataset.stop = s.id;
      b.textContent = s.title;
      b.onclick = () => this.goPlace(s.id);
      $('#journey-stops').append(b);
    }
    $('#campus-view').onclick = () => this.world.inspectCampus();
    $('#camera-mode').onclick = () => this.world.setView(!this.world.overview);
    $('#reset-rover').onclick = () => {
      this.world.reset();
      this.campus = CAMPUSES.find((c) => c.id === 'el-centro');
      $('#campus-select').value = this.campus.id;
      $('#club-world').focus({ preventScroll: true });
    };
    $('#cancel-route').onclick = () => {
      this.world.cancel();
      $('#club-world').focus({ preventScroll: true });
    };
    $('#enter-place').onclick = () => {
      if (this.stop) this.openPlace(this.stop.id);
    };
    this.newsBubble = new StationNewsBubble(this);
    this.releaseTouch = mountTouchDrive(this.world);
    document.querySelectorAll('[data-drive]').forEach((b) => {
      const key = b.dataset.drive;
      b.onpointerdown = (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        this.world.startDriving();
        this.world.keys[key] = true;
      };
      const stop = () => delete this.world.keys[key];
      b.onpointerup = stop;
      b.onpointercancel = stop;
      b.onlostpointercapture = stop;
    });
  }
  goCampus(id) {
    const campus = CAMPUSES.find((c) => c.id === id);
    if (!campus) return;
    this.campus = campus;
    $('#campus-select').value = id;
    this.world.travelTo(id);
    $('#club-world').focus({ preventScroll: true });
  }
  goPlace(id) {
    this.campus = CAMPUSES.find((c) => c.id === $('#campus-select').value) || this.campus;
    this.world.travelTo(this.campus.id, id);
    $('#club-world').focus({ preventScroll: true });
  }
  openPlace(id, article = 0) {
    if (this.world.nearest) this.world.experience.page(id);
    this.world.cancel();
    this.onOpen(id, article);
  }
  arrive(place) {
    this.stop = place?.stop || null;
    document
      .querySelectorAll('[data-stop]')
      .forEach((b) =>
        b.setAttribute('aria-current', place?.stop.id === b.dataset.stop ? 'location' : 'false'),
      );
    if (place) {
      this.campus = place.campus;
      $('#campus-select').value = this.campus.id;
      $('#journey-status').textContent = 'You’ve arrived. Discover what’s new or keep exploring.';
    }
    this.newsBubble?.show(place);
  }

  pause() {
    this.newsBubble?.clear();
    this.releaseTouch();
    this.active = false;
    this.world.pause();
  }
  resume() {
    this.active = true;
    this.world.resume();
    this.newsBubble?.show(this.world.nearest);
  }
  setMotion(reduced) {
    this.world.reduced = reduced;
  }
}
