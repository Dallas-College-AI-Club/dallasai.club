import * as T from '../vendor/three.module.js';
import { CITY_PLACES } from './places-data.js';
import { LANDMARKS } from './landmarks.js';
import { CAMPUSES } from './geography.js';
import { hitsObstacle, avoidObstacles, localRoute } from './collisions.js';
import { routeLength } from './physics.js';
export function placeApproach(p, obstacles) {
  for (let r = p.radius + 2; r < p.radius + 18; r += 3)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2,
        q = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r };
      if (!obstacles.some((o) => hitsObstacle(q, o, 1.8))) return q;
    }
  throw new Error('No clear entrance for ' + p.name);
}
export function routeToPlace(world, p) {
  const entry = placeApproach(p, world.obstacles),
    nodes = world.router.nodes;
  const candidates = nodes
    .map(([x, z], i) => ({ x, z, i, d: Math.hypot(x - entry.x, z - entry.z) }))
    .filter((n) => !world.obstacles.some((o) => hitsObstacle(n, o, 1.5)))
    .sort((a, b) => a.d - b.d);
  for (const node of candidates.slice(0, 16)) {
    try {
      const road = world.router.route(world.position, { node: node.i }),
        approach = localRoute(road.at(-1), entry, world.obstacles);
      return avoidObstacles([...road, ...approach.slice(1)], world.obstacles);
    } catch {
      // This road cannot reach the entrance; try the next nearby connection.
    }
  }
  throw new Error('No connected approach. Drive closer and try again.');
}
export class CityPlaces {
  constructor(world) {
    this.world = world;
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.lastPick = 0;
    this.selection = null;
    this.down = null;
    this.hover = null;
    const stage = world.canvas.parentElement;
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'place-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.hidden = true;
    stage.append(this.tooltip);
    this.card = document.createElement('aside');
    this.card.className = 'place-card';
    this.card.hidden = true;
    this.card.setAttribute('aria-label', 'Dallas place');
    this.card.innerHTML =
      '<button class="place-close" aria-label="Close place details">×</button><small></small><h2></h2><p></p><div><button class="place-drive">Drive here ↗</button><button class="place-look">Look closer</button></div><a target="_blank" rel="noreferrer">Official website ↗</a>';
    stage.append(this.card);
    this.card.querySelector('.place-close').onclick = () => this.close();
    this.card.querySelector('.place-drive').onclick = () => this.travel(this.selection);
    this.card.querySelector('.place-look').onclick = () => {
      if (this.world.inspect?.id === this.selection?.id) {
        this.world.setView(false);
        this.world.camDistance = 8;
        this.close();
      } else this.look(this.selection);
    };
    this.targets = [];
    world.scene.traverse((g) => {
      const p =
        g.userData.cityPlace ||
        LANDMARKS.find((p) => g.name === p.name) ||
        CAMPUSES.find((p) => g.name.startsWith(p.name + ' — '));
      if (p) {
        g.userData.hoverPlace = p;
        this.targets.push(g);
      }
    });
    world.canvas.addEventListener('pointermove', (e) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6)
        this.down.drag = true;
      if (e.buttons || performance.now() - this.lastPick < 75) return;
      this.lastPick = performance.now();
      const p = this.pick(e);
      this.hover = p;
      this.tooltip.hidden = !p;
      if (p) {
        this.tooltip.textContent = p.name;
        const r = world.canvas.getBoundingClientRect();
        this.tooltip.style.left =
          Math.min(r.width - 230, Math.max(10, e.clientX - r.left + 16)) + 'px';
        this.tooltip.style.top = Math.max(12, e.clientY - r.top - 44) + 'px';
      }
      world.canvas.style.cursor = p ? 'pointer' : 'grab';
    });
    world.canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY };
      this.tooltip.hidden = true;
    });
    world.canvas.addEventListener('pointerup', (e) => {
      if (this.down && !this.down.drag) {
        const p = this.pick(e);
        if (p) this.open(p);
        else this.close();
      }
      this.down = null;
    });
    world.canvas.addEventListener('pointercancel', () => (this.down = null));
    world.canvas.addEventListener('pointerleave', () => {
      this.tooltip.hidden = true;
    });
    this.addList();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }
  pick(e) {
    const r = this.world.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, this.world.camera);
    const hit = this.ray.intersectObjects(this.targets, true).find((h) => h.object.isMesh);
    let obj = hit?.object;
    while (obj && !obj.userData.hoverPlace) obj = obj.parent;
    return obj?.userData.hoverPlace;
  }
  open(p) {
    this.selection = p;
    this.card.hidden = false;
    this.card.querySelector('small').textContent =
      p.kind || (p.area ? 'Dallas College' : 'Landmark');
    this.card.querySelector('h2').textContent = p.name;
    this.card.querySelector('p').textContent = p.note || 'Explore this Dallas landmark.';
    const a = this.card.querySelector('a');
    a.href = p.source || 'https://www.dallascollege.edu/';
    this.card.querySelector('.place-drive').textContent = 'Drive here ↗';
    this.card.querySelector('.place-look').textContent =
      this.world.inspect?.id === p.id ? 'Back to car' : 'Look closer';
  }
  close() {
    this.card.hidden = true;
    this.selection = null;
    if (this.world.inspect) {
      this.world.inspect = null;
      this.world.camDistance = 8;
      this.world.setView(false);
    }
  }
  look(p) {
    this.world.setView(false);
    this.world.inspect = { ...p };
    this.world.orbit = 0.5;
    this.world.camDistance = Math.max(5, Math.min(13, p.radius || 6));
    this.world.onStatus(p.name);
    document.querySelector('#journey-stage').dataset.view = 'place';
    this.open(p);
  }
  async travel(p) {
    if (!p) return;
    const w = this.world,
      ticket = (w.requestTicket = (w.requestTicket || 0) + 1);
    if (!(await w.roadsReady) || ticket !== w.requestTicket) return;
    if (CAMPUSES.some((c) => c.id === p.id)) {
      this.close();
      w.travelTo(p.id);
      return;
    }
    w.onStatus('Finding the road to ' + p.name + '…');
    try {
      const route = routeToPlace(w, { radius: 6, ...p });
      w.keys = {};
      w.speed = 0;
      w.target = { campus: p, place: true };
      w.route = route.slice(1);
      w.distanceDone = 0;
      w.distanceTotal = routeLength(route);
      w.setView(false);
      w.orbit = 0;
      w.routeLine.geometry.dispose();
      w.routeLine.geometry = new T.BufferGeometry().setFromPoints(
        route.map((p) => new T.Vector3(p.x, (w.terrain?.height(p.x, p.z) || 0) + 0.16, p.z)),
      );
      w.routeLine.computeLineDistances();
      w.routeLine.visible = true;
      w.onProgress(0, w.target);
      this.close();
    } catch (e) {
      w.onStatus(e.message);
    }
  }
  addList() {
    const panel = document.querySelector('.destinations-panel .drive-panel-body');
    const heading = document.createElement('h3');
    heading.textContent = 'Around Dallas';
    heading.className = 'city-list-title';
    panel.append(heading);
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'city-search';
    search.placeholder = 'Museums, parks, places…';
    search.setAttribute('aria-label', 'Find a Dallas place');
    panel.append(search);
    const list = document.createElement('div');
    list.className = 'city-destinations';
    panel.append(list);
    for (const p of CITY_PLACES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.place = p.id;
      b.innerHTML = /* HTML */ `<span>${p.name}<small>${p.kind}</small></span
        ><span aria-hidden="true">↗</span>`;
      b.onclick = () => {
        panel.closest('details').open = false;
        this.look(p);
      };
      list.append(b);
    }
    const empty = document.createElement('p');
    empty.textContent = 'No matching places.';
    empty.hidden = true;
    list.after(empty);
    search.oninput = () => {
      for (const b of list.children)
        b.hidden = !b.textContent.toLowerCase().includes(search.value.toLowerCase());
      empty.hidden = [...list.children].some((b) => !b.hidden);
    };
  }
  update(time) {
    if (!this.world.reduced)
      for (const p of CITY_PLACES) {
        const a = p.animation;
        if (a) {
          const t = (time * 0.000045) % 1,
            n = t * (a.points.length - 1),
            i = Math.floor(n),
            f = n - i,
            b = a.points[i],
            c = a.points[(i + 1) % a.points.length];
          a.mesh.position.set(
            b[0] + (c[0] - b[0]) * f,
            b[1] + (c[1] - b[1]) * f,
            b[2] + (c[2] - b[2]) * f,
          );
          a.mesh.rotation.y = Math.atan2(c[0] - b[0], c[2] - b[2]);
        }
      }
  }
}
