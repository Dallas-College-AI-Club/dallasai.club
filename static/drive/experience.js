import { readRun, writeRun } from '../storage/drive.js';
import { CAMPUSES } from './geography.js';
import { campusScale, campusPoint } from './physics.js';
import { hitsObstacle } from './collisions.js';
import * as T from '../vendor/three.module.js';
import { DriveScore, pageId } from './score.js';
const $ = (s) => document.querySelector(s);
export class DriveExperience {
  constructor(world) {
    this.world = world;
    this.bonuses = [];
    this.toastUntil = 0;
    this.lastScore = -1;
    this.lastTick = 0;
    this.lastSave = 0;
    this.saved = readRun();
    const manualWeather = () => {
      $('#auto-weather').checked = false;
      world.weather.cycle.automatic = false;
    };
    $('#weather-select').onchange = (e) => {
      manualWeather();
      world.weather.set(e.target.value);
    };
    $('#season-select').onchange = (e) => {
      manualWeather();
      world.weather.set(undefined, e.target.value);
    };
    $('#auto-weather').onchange = (e) => {
      world.weather.cycle.automatic = e.target.checked;
      world.weather.cycle.elapsed = 0;
    };
    window.addEventListener('drive-page-preview', (e) => {
      if (this.world.active && this.score?.previewPage(pageId(e.detail))) {
        this.toast('+20 · Page preview', performance.now());
        this.render();
        this.persist();
      }
    });
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
  }
  ready(data) {
    this.score = new DriveScore(data);
    if (this.saved && this.score.restore(this.saved.score)) {
      const run = this.saved,
        c = CAMPUSES.find((c) => c.id === run.campus) || CAMPUSES[3];
      let p = run.position;
      if (this.world.obstacles.some((o) => hitsObstacle(p, o))) p = campusPoint(c);
      this.world.position.set(p.x, 0, p.z);
      this.world.heading = run.heading;
      this.world.cameraHeading = run.heading;
      this.world.lookTarget.copy(this.world.position);
      this.world.camera.position.set(
        p.x - Math.sin(run.heading) * 8,
        4,
        p.z - Math.cos(run.heading) * 8,
      );
      document.querySelector('#campus-select').value = c.id;
      this.world.onStatus('Drive restored. Progress saves automatically.');
      if (
        ['clear', 'overcast', 'rain', 'sunset'].includes(run.weather?.weather) &&
        ['spring', 'summer', 'autumn', 'winter'].includes(run.weather?.season)
      ) {
        this.world.weather.set(run.weather.weather, run.weather.season);
        this.world.weather.cycle.automatic = run.weather.automatic !== false;
        document.querySelector('#auto-weather').checked = this.world.weather.cycle.automatic;
      }
      this.saved = null;
      this.returnBonus();
    }
    const chosen = [];
    for (let i = 0; i < data.nodes.length; i += 19) {
      const [x, z] = data.nodes[i];
      if (chosen.every((p) => Math.hypot(p.x - x, p.z - z) > 38)) chosen.push({ x, z });
      if (chosen.length >= 100) break;
    }
    for (const [i, p] of chosen.entries()) {
      const group = new T.Group(),
        mat = new T.MeshStandardMaterial({
          color: '#ffe0a5',
          emissive: '#dfb979',
          emissiveIntensity: 0.5,
          metalness: 0.6,
          roughness: 0.28,
        });
      const ring = new T.Mesh(new T.TorusGeometry(0.34, 0.055, 8, 24), mat);
      group.add(ring);
      const dot = new T.Mesh(new T.OctahedronGeometry(0.11), mat);
      group.add(dot);
      group.position.set(p.x, 1, p.z);
      this.world.scene.add(group);
      this.bonuses.push({ id: 'route-' + i, ...p, group });
    }
    this.render();
  }
  tick(before, manual, now) {
    if (!this.score) return;
    for (const c of CAMPUSES) {
      if (
        Math.hypot(
          campusPoint(c).x - this.world.position.x,
          campusPoint(c).z - this.world.position.z,
        ) <
          27 * campusScale(c) &&
        this.score.campus(c.id)
      ) {
        this.toast('+250 · New campus: ' + c.name, now);
        this.render();
        this.persist();
      }
    }
    if (now - this.lastSave > 1000) {
      this.persist();
      this.lastSave = now;
    }
    const gained = this.score.step(before, this.world.position, manual);
    if (gained) this.render();
    for (const bonus of this.bonuses) {
      if (this.score.collected.has(bonus.id)) continue;
      const d = Math.hypot(bonus.x - this.world.position.x, bonus.z - this.world.position.z);
      bonus.group.visible = d < 180 && !this.world.overview;
      if (
        d < 1.25 &&
        manual &&
        Math.hypot(before.x - this.world.position.x, before.z - this.world.position.z) > 0.005
      ) {
        this.score.bonus(bonus.id);
        bonus.group.visible = false;
        this.toast('+50 · Route bonus', now);
        this.render();
      }
      if (!this.world.reduced && d < 180) {
        bonus.group.rotation.y = now * 0.001;
        bonus.group.position.y = 1 + Math.sin(now * 0.002) * 0.15;
      }
    }
    if (now - this.lastTick > 250) {
      this.render();
      this.lastTick = now;
    }
    if (now > this.toastUntil) $('#score-toast').hidden = true;
  }
  visit(campus, id) {
    if (this.score?.visit(campus, id)) {
      this.toast('+100 · New club stop', performance.now());
      this.render();
      this.persist();
    }
  }
  reset() {
    this.saved = null;
    this.score?.reset();
    this.bonuses.forEach((b) => (b.group.visible = true));
    this.render();
  }
  toast(text, now) {
    $('#score-toast').textContent = text;
    $('#score-toast').hidden = false;
    this.toastUntil = now + 2000;
  }
  render() {
    if (!this.score) return;
    $('#drive-score').textContent = this.score.points.toLocaleString();
    $('#track-status').textContent = this.world.route.length
      ? 'Guided drive'
      : this.score.onRoad
        ? 'On road · ' + this.score.multiplier + '×'
        : 'Find a road';
    $('#campus-progress').textContent = this.score.campuses.size + ' / 7 campuses';
  }
  page(id) {
    if (this.score) {
      this.score.visitPage(pageId(id));
      this.render();
      this.persist();
    }
  }
  returnBonus() {
    if (this.score?.returnToDrive()) {
      this.toast('+50 · Back to the drive', performance.now());
      this.render();
      this.persist();
    }
  }
  persist() {
    if (!this.score) return;
    const w = this.world,
      c = CAMPUSES.reduce((a, b) =>
        Math.hypot(a.x - w.position.x, a.z - w.position.z) <
        Math.hypot(b.x - w.position.x, b.z - w.position.z)
          ? a
          : b,
      );
    writeRun({
      position: { x: w.position.x, z: w.position.z },
      heading: w.heading,
      campus: c.id,
      score: this.score.snapshot(),
      weather: {
        weather: w.weather.weather,
        season: w.weather.season,
        automatic: w.weather.cycle.automatic,
      },
    });
  }
}
