import { landscape } from './environment.js';
import { addCityPlaces } from './places-models.js';
import { CityPlaces } from './places.js';
import { roadSurfaces } from './road-surface.js';
import { makeVehicle } from './vehicle.js';
import { DallasTerrain } from './terrain.js';
import { addLandmarks } from './landmark-models.js';
import { addStations, updateStations } from './stations.js';
import { localRoute, hitsObstacle, avoidObstacles, movementBlocked } from './collisions.js';
import { SkyWeather } from './sky.js';
import { DriveExperience } from './experience.js';
import * as T from '../vendor/three.module.js';
import { MeshPrimitives } from './mesh-primitives.js';
import { CAMPUSES, project } from './geography.js';
import {
  STOPS,
  START,
  campusScale,
  forecourtX,
  campusPoint,
  stopPoint,
  routeLength,
  advanceRoute,
  advanceDrive,
  resetDrive,
} from './physics.js';
import { RoadRouter } from './road-routing.js';
import { addCampusArchitecture, BUILDINGS } from './campuses.js';
export class DriveWorld extends MeshPrimitives {
  constructor(
    canvas,
    {
      reduced = false,
      onArrive = () => {},
      onStatus = () => {},
      onProgress = () => {},
      onView = () => {},
      onEnter = () => {},
    } = {},
  ) {
    super();
    Object.assign(this, {
      canvas,
      reduced,
      onArrive,
      onStatus,
      onProgress,
      onView,
      onEnter,
      active: true,
      searchOpen: false,
      materials: {},
      wheels: [],
      keys: {},
      route: [],
      target: null,
      nearest: null,
      speed: 0,
      heading: Math.PI,
      overview: false,
      orbit: 0,
      camDistance: 8,
      distanceDone: 0,
      distanceTotal: 0,
      last: performance.now(),
    });
    this.position = new T.Vector3(START.x, 0, START.z);
    this.lookTarget = this.position.clone();
    this.cameraHeading = Math.PI;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#253638');
    this.scene.fog = new T.FogExp2('#253638', 0.001);
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.camera = new T.PerspectiveCamera(48, 1, 0.1, 14000);
    this.camera.position.set(START.x, 4.8, START.z + 9);
    this.boxGeo = new T.BoxGeometry(1, 1, 1);
    this.sphereGeo = new T.SphereGeometry(1, 20, 12);
    this.obstacles = [];
    this.markers = [];
    this.hemi = new T.HemisphereLight('#d8e3e1', '#333b2e', 2.1);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight('#fff0d5', 3.3);
    this.sun.position.set(-30, 65, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -26,
      right: 26,
      top: 26,
      bottom: -26,
      near: 1,
      far: 140,
    });
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.ground = new T.Mesh(new T.PlaneGeometry(2800, 2800), this.mat('#253c39', 0.08, 0.85));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.08;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.surfaceDetails();
    this.makeCampuses();
    this.makeLandmarks();
    this.makeVehicle();
    this.weather = new SkyWeather(this);
    this.experience = new DriveExperience(this);
    this.loadMap();
    this.roadsReady = this.loadRoads();
    for (const [name, lon, lat] of [
      ['Cedar Hill', -96.957, 32.588],
      ['Dallas', -96.822, 32.747],
    ]) {
      const c = project(lon, lat),
        button = document.createElement('span');
      button.className = 'drive-city-label';
      button.textContent = name;
      document.querySelector('#map-labels').append(button);
      this.markers.push({ c, button });
    }
    this.routeLine = new T.Line(
      new T.BufferGeometry(),
      new T.LineDashedMaterial({
        color: '#f4d2a2',
        dashSize: 0.35,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.scene.add(this.routeLine);
    this.places = new CityPlaces(this);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.controls();
    this.resize();
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  surfaceDetails() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#888';
    g.fillRect(0, 0, 256, 256);
    let seed = 67;
    for (let i = 0; i < 8000; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % 256;
      seed = (seed * 16807) % 2147483647;
      const y = seed % 256;
      g.fillStyle = i % 2 ? '#777' : '#999';
      g.fillRect(x, y, 1, 1);
    }
    this.surfaceTexture = new T.CanvasTexture(c);
    this.surfaceTexture.wrapS = this.surfaceTexture.wrapT = T.RepeatWrapping;
    this.surfaceTexture.repeat.set(5, 3);
    this.ground.material.bumpMap = this.surfaceTexture;
    this.ground.material.bumpScale = 0.02;
    const env = document.createElement('canvas');
    env.width = 512;
    env.height = 256;
    const ctx = env.getContext('2d'),
      grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#657e87');
    grad.addColorStop(0.5, '#d8d6bb');
    grad.addColorStop(1, '#24392d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);
    const tx = new T.CanvasTexture(env);
    tx.mapping = T.EquirectangularReflectionMapping;
    tx.colorSpace = T.SRGBColorSpace;
    const pm = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromEquirectangular(tx).texture;
    pm.dispose();
    tx.dispose();
    this.scene.environmentIntensity = 0.3;
  }
  makeVehicle() {
    makeVehicle(this, { shuffle: true });
  }

  async loadRoads() {
    try {
      const data = await (await fetch('road-network.json')).json();
      this.roadData = data;
      this.router = new RoadRouter(data);
      this.makeRoads(data);
      this.experience.ready(data);
      return true;
    } catch (e) {
      this.onStatus('Roads could not load. Refresh to try again.');
      console.error(e);
      return false;
    }
  }
  makeRoads(data) {
    roadSurfaces(this, data);
  }
  makeLandmarks() {
    addLandmarks(this);
    addCityPlaces(this);
  }

  label(lines, w, h, bg = '#172a2b', ink = '#e4e7d9', serif = false) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = Math.round((1024 * h) / w);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = ink + '55';
    g.strokeRect(12, 12, c.width - 24, c.height - 24);
    g.fillStyle = ink;
    g.font = `400 ${Math.min(lines.length > 1 ? 72 : 64, Math.round((c.height / (lines.length + 1)) * 0.74))}px ${serif ? 'Source Serif 4' : 'DM Sans'}, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((s, i) =>
      g.fillText(s, c.width / 2, (c.height * (i + 1)) / (lines.length + 1), c.width - 70),
    );
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    return new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex, toneMapped: false, side: T.DoubleSide }),
    );
  }
  makeCampuses() {
    const layer = document.querySelector('#map-labels');
    for (const [ci, c] of CAMPUSES.entries()) {
      const firstChild = this.scene.children.length,
        firstObstacle = this.obstacles.length;
      const stone = this.mat(
          ['#878775', '#8f7d6a', '#848575', '#8f8873', '#8b7d66', '#818e88', '#958d75'][ci],
          0.05,
          0.9,
        ),
        wood = this.mat('#8c7556', 0.05, 0.75),
        metal = this.mat('#344e4c', 0.3, 0.48);
      this.box(c.x, -0.01, c.z + 1, 22, 0.12, 16, this.mat('#777e6c', 0.03, 0.94));
      stone.bumpMap = this.surfaceTexture;
      stone.bumpScale = 0.035;
      addCampusArchitecture(this, c);
      this.box(c.x, 0, c.z - 5.5, 21, 0.25, 1, stone);
      const glow = new T.MeshStandardMaterial({
        color: '#f8e0ad',
        emissive: '#efc98c',
        emissiveIntensity: 2,
      });
      this.box(c.x, 0.2, c.z - 5.5, 20.7, 0.035, 0.035, glow);

      const name = this.label(
        [c.name.toUpperCase(), BUILDINGS[c.id]],
        9.4,
        1.1,
        '#233c38',
        '#e1e5d5',
      );
      name.position.set(c.x, 4.5, c.z - 5.1);
      this.scene.add(name);
      for (const side of [-1, 1]) {
        const x = c.x + side * 9.4,
          z = c.z + 4.2;
        this.box(x, 0.2, z, 2.4, 0.13, 0.55, wood);
        this.obstacles.push({ x, z, w: 2.4, d: 0.55 });
        for (const dx of [-0.9, 0.9]) this.box(x + dx, 0, z, 0.12, 0.25, 0.4, metal);
        this.tree(c.x + side * 11.6, c.z + 4.5, ci);
        this.tree(c.x + side * 11.6, c.z - 5, ci + 2);
      }
      for (const dx of [-9.6, 9.6]) {
        this.cylinder(c.x + dx, 0, c.z + 6.5, 0.055, 3, '#a3ad98');
        this.obstacles.push({ x: c.x + dx, z: c.z + 6.5, w: 0.12, d: 0.12 });
        this.sphere(
          c.x + dx,
          3,
          c.z + 6.5,
          0.15,
          new T.MeshStandardMaterial({
            color: '#ffebc0',
            emissive: '#ffdab0',
            emissiveIntensity: 2,
          }),
        );
      }
      if (campusScale(c) !== 1) {
        const scale = campusScale(c),
          group = new T.Group();
        group.position.set(c.x, 0, c.z);
        for (const child of this.scene.children.slice(firstChild)) {
          child.position.x -= c.x;
          child.position.z -= c.z;
          group.add(child);
        }
        group.scale.setScalar(scale);
        group.position.x = forecourtX(c);
        this.scene.add(group);
        for (const obstacle of this.obstacles.slice(firstObstacle)) {
          obstacle.x = forecourtX(c) + (obstacle.x - c.x) * scale;
          obstacle.z = c.z + (obstacle.z - c.z) * scale;
          obstacle.w *= scale;
          obstacle.d *= scale;
        }
      }
      addStations(this, c);
      const button = document.createElement('button');
      button.className = 'drive-campus-pin';
      button.textContent = c.name;
      button.dataset.campus = c.id;
      button.setAttribute('aria-label', 'Drive to ' + c.name);
      button.onclick = () => this.travelTo(c.id);
      layer.append(button);
      this.markers.push({ c, button });
    }
  }
  tree(x, z, seed) {
    this.cylinder(x, 0, z, 0.085, 2.2, '#666a53');
    const leaves = this.mat('#465f47', 0, 0.98);
    this.leafMaterials ??= new Set();
    this.leafMaterials.add(leaves);
    for (let i = 0; i < 8; i++) {
      const t = this.sphere(
        x + Math.sin(i * 2.4 + seed) * 0.55,
        1.8 + (i % 3) * 0.45,
        z + Math.cos(i * 2.4 + seed) * 0.5,
        0.65,
        leaves,
      );
      t.scale.y = 1.5;
    }
    this.obstacles.push({ x, z, w: 1.2, d: 1.2 });
  }
  async loadMap() {
    try {
      const data = await (await fetch('dallas-map.json')).json(),
        canvas = document.createElement('canvas');
      canvas.width = canvas.height = 4096;
      const g = canvas.getContext('2d');
      g.fillStyle = '#c9d1c6';
      g.fillRect(0, 0, 4096, 4096);
      g.translate(2048, 2048);
      g.scale(4096 / 2800, 4096 / 2800);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const f of data.features) {
        g.beginPath();
        f.points.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)));
        if (f.type === 'water') {
          g.fillStyle = '#668eac';
          g.fill();
        } else {
          g.lineWidth = f.type === 'river' ? 3.5 : f.type === 'motorway' ? 1.6 : 0.7;
          g.strokeStyle =
            f.type === 'river' ? '#7190a8' : f.type === 'motorway' ? '#ecede1' : '#a3b5a8';
          g.stroke();
        }
      }
      g.textAlign = 'center';
      g.fillStyle = '#a1b5a2';
      for (const [name, lon, lat] of [
        ['DALLAS', -96.81, 32.75],
        ['IRVING', -96.985, 32.824],
        ['MESQUITE', -96.651, 32.77],
        ['LANCASTER', -96.792, 32.594],
        ['CEDAR HILL', -96.957, 32.588],
        ['FARMERS BRANCH', -96.895, 32.955],
        ['GARLAND', -96.643, 32.915],
      ]) {
        const p = project(lon, lat);
        g.font = '400 17.5px DM Sans, sans-serif';
        g.fillText(name, p.x, p.z);
      }
      const tx = new T.CanvasTexture(canvas);
      tx.colorSpace = T.SRGBColorSpace;
      tx.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.ground.material.map = tx;
      this.ground.material.color.set('#ffffff');
      this.ground.material.needsUpdate = true;
      this.weather.set();
      if (await this.roadsReady) {
        this.terrain = new DallasTerrain(this, data, this.roadData);
        this.makeRoads(this.roadData);
        landscape(this);
      }
    } catch (e) {
      this.onStatus('Street detail unavailable. Campus routes are still open.');
    }
  }
  async travelTo(id, stop = null) {
    const c = CAMPUSES.find((c) => c.id === id);
    if (!c) return;
    const ticket = (this.requestTicket = (this.requestTicket || 0) + 1);
    this.onStatus('Preparing the road route…');
    if (!(await this.roadsReady) || ticket !== this.requestTicket) return;
    let route;
    try {
      const near =
        Math.hypot(this.position.x - forecourtX(c), this.position.z - c.z) < 44 * campusScale(c);
      route = near
        ? localRoute(this.position, campusPoint(c), this.obstacles, campusScale(c))
        : this.router.route(this.position, c);
      if (stop) {
        const entry = stopPoint(c, stop);
        route.push(...localRoute(route.at(-1), entry, this.obstacles, campusScale(c)).slice(1));
      }
      route = avoidObstacles(route, this.obstacles);
    } catch (e) {
      this.onStatus(e.message);
      return;
    }
    this.keys = {};
    this.speed = 0;
    this.target = { campus: c, stop };
    this.route = route.slice(1);
    this.distanceDone = 0;
    this.distanceTotal = routeLength([{ x: this.position.x, z: this.position.z }, ...this.route]);
    this.setView(false);
    this.orbit = 0;
    this.routeLine.geometry.dispose();
    this.routeLine.geometry = new T.BufferGeometry().setFromPoints(
      [this.position, ...this.route].map(
        (p) => new T.Vector3(p.x, (this.terrain?.height(p.x, p.z) || 0) + 0.16, p.z),
      ),
    );
    this.routeLine.computeLineDistances();
    this.routeLine.visible = true;
    this.currentRoad = '';
    this.onStatus(
      'Driving to ' + (stop ? STOPS.find((s) => s.id === stop).title + ' · ' : '') + c.name,
    );
    this.onProgress(0, this.target);
  }
  cancel() {
    this.requestTicket = (this.requestTicket || 0) + 1;
    this.route = [];
    this.target = null;
    this.speed = 0;
    this.routeLine.visible = false;
    this.onProgress(0, null);
    this.onStatus('You have the wheel.');
  }
  startDriving() {
    this.inspect = null;
    document.querySelector('#campus-view').setAttribute('aria-pressed', 'false');
    if (this.target) this.cancel();
    this.setView(false);
  }
  reset() {
    this.experience.reset();
    this.inspect = null;
    document.querySelector('#campus-view').setAttribute('aria-pressed', 'false');
    this.requestTicket = (this.requestTicket || 0) + 1;
    resetDrive(this);
    this.cameraHeading = Math.PI;
    this.lookTarget.copy(this.position);
    this.camera.position.set(START.x, 4.8, START.z + 9);
    this.routeLine.visible = false;
    this.onArrive(null);
    this.onProgress(0, null);
    this.onView(false);
    this.onStatus('New drive. A fresh vehicle is ready.');
    makeVehicle(this, { shuffle: true });
    this.experience.persist();
  }
  setView(value) {
    this.inspect = null;
    document.querySelector('#campus-view').setAttribute('aria-pressed', 'false');
    this.overview = value;
    this.onView(value);
  }
  inspectCampus() {
    if (this.inspect) {
      this.inspect = null;
    } else {
      this.overview = false;
      this.onView(false);
      this.inspect = CAMPUSES.reduce((a, b) =>
        Math.hypot(a.x - this.position.x, a.z - this.position.z) <
        Math.hypot(b.x - this.position.x, b.z - this.position.z)
          ? a
          : b,
      );
      this.orbit = 0.5;
    }
    document.querySelector('#campus-view').setAttribute('aria-pressed', String(!!this.inspect));
    document.querySelector('#journey-stage').dataset.view = this.inspect ? 'campus' : 'drive';
  }
  updateArrival() {
    let found = null;
    for (const c of CAMPUSES) {
      if (Math.hypot(c.x - this.position.x, c.z - this.position.z) > 44) continue;
      for (const s of STOPS) {
        const p = stopPoint(c, s.id);
        if (Math.hypot(p.x - this.position.x, p.z - this.position.z) < 1.45 * campusScale(c))
          found = { campus: c, stop: s };
      }
    }
    const key = (f) => (f ? f.campus.id + '/' + f.stop.id : '');
    if (key(found) !== key(this.nearest)) {
      this.nearest = found;
      this.onArrive(found);
    }
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }
  pause() {
    if (!this.active) return;
    this.experience.persist();
    this.projectVideo?.pause();
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.keys = {};
    this.speed = 0;
  }
  resume() {
    if (this.active) return;
    this.experience.returnBonus();
    makeVehicle(this, { shuffle: true });
    this.active = true;
    this.last = performance.now();
    this.resize();
    this.updateArrival();
    if (!this.searchOpen) this.frame = requestAnimationFrame(this.loop);
  }
  setSearchOpen(open) {
    if (this.searchOpen === open) return;
    this.searchOpen = open;
    cancelAnimationFrame(this.frame);
    if (open) this.projectVideo?.pause();
    else if (this.active) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.loop);
    }
  }
  controls() {
    window.addEventListener('keydown', (e) => {
      if (
        !this.active ||
        this.searchOpen ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target.closest('input,select,textarea,button,a,summary,[contenteditable]')
      )
        return;
      const k = e.key.toLowerCase();
      if (
        ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)
      ) {
        e.preventDefault();
        this.startDriving();
        this.keys[k] = true;
      }
      if (!e.repeat) {
        if (k === 'r') this.reset();
        if (k === 'm') this.setView(!this.overview);
        if (k === 'enter' && this.nearest) this.onEnter(this.nearest.stop.id);
      }
    });
    window.addEventListener('keyup', (e) => delete this.keys[e.key.toLowerCase()]);
    let drag = null;
    const release = () => {
      this.keys = {};
      this.driveInput = null;
      this.speed = 0;
      drag = null;
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) release();
    });
    document.addEventListener('club:search', (e) => {
      const open = e.detail?.open === true;
      if (open) release();
      this.setSearchOpen(open);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.searchOpen || drag || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.focus({ preventScroll: true });
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.active || this.searchOpen || e.pointerId !== drag?.id) return;
      this.orbit -= (e.clientX - drag.x) * 0.006;
      this.camDistance = Math.max(5, Math.min(18, this.camDistance + (e.clientY - drag.y) * 0.025));
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const endDrag = (e) => {
      if (e.pointerId === drag?.id) drag = null;
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      this.canvas.addEventListener(type, endDrag);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || this.searchOpen) return;
        e.preventDefault();
        this.camDistance = Math.max(5, Math.min(18, this.camDistance + e.deltaY * 0.007));
      },
      { passive: false },
    );
  }
  loop(now) {
    if (!this.active || this.searchOpen) return;
    const dt = Math.min((now - this.last) / 1000, 0.04);
    this.last = now;
    if (this.active) {
      const scoreBefore = this.position.clone(),
        manual = !this.route.length;
      if (this.route.length) {
        const nearCampus = CAMPUSES.some(
            (c) => Math.hypot(c.x - this.position.x, c.z - this.position.z) < 22,
          ),
          road = this.route[0]?.road;
        if (road && road !== this.currentRoad) {
          this.currentRoad = road;
          this.onStatus(road + ' · to ' + this.target.campus.name);
        }
        this.distanceDone += advanceRoute(this, dt, nearCampus ? 7 : 60);
        this.onProgress(
          Math.min(100, (this.distanceDone / (this.distanceTotal || 1)) * 100),
          this.target,
        );
        if (!this.route.length) {
          const target = this.target;
          this.target = null;
          this.routeLine.visible = false;
          this.onProgress(100, null);
          if (target?.place) this.places.open(target.campus);
          if (target)
            this.onStatus(
              target.stop
                ? 'You’ve arrived. Open this section or keep exploring.'
                : 'Arrived at ' +
                    target.campus.name +
                    (target.place ? '.' : '. Choose a content stop.'),
            );
        }
      } else {
        const before = this.position.clone();
        advanceDrive(this, this.keys, dt);
        if (this.obstacles.some((o) => hitsObstacle(this.position, o))) {
          this.position.copy(before);
          this.speed = 0;
        }
      }
      if (movementBlocked(scoreBefore, this.position, this.obstacles)) {
        this.position.copy(scoreBefore);
        this.speed = 0;
        if (this.route.length) {
          this.cancel();
          this.onStatus('That approach is blocked. Choose another route or turn away.');
        }
      }
      this.experience.tick(scoreBefore, manual, now);
      this.position.y = this.terrain ? this.terrain.height(this.position.x, this.position.z) : 0;
      this.rover.position.copy(this.position);
      this.rover.rotation.y +=
        Math.atan2(
          Math.sin(this.heading - this.rover.rotation.y),
          Math.cos(this.heading - this.rover.rotation.y),
        ) * (this.reduced ? 1 : 1 - Math.exp(-dt * 12));
      for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.27;
      for (const w of this.steeringWheels || []) w.rotation.y = this.steer || 0;
      this.rover.rotation.z = this.reduced
        ? 0
        : -(this.steer || 0) * Math.min(Math.abs(this.speed), 8) * 0.007;
      this.updateArrival();
      const smooth = this.reduced ? 1 : 1 - Math.exp(-dt * 4);
      const delta = Math.atan2(
        Math.sin(this.heading - this.cameraHeading),
        Math.cos(this.heading - this.cameraHeading),
      );
      this.cameraHeading += delta * smooth;
      const angle = this.cameraHeading + this.orbit;
      this.scene.fog.density = this.overview ? 0 : 0.0006;
      const fit =
        (Math.max(2000, 1950 / this.camera.aspect) /
          (2 * Math.tan((this.camera.fov * Math.PI) / 360))) *
        1.22;
      const inspectScale = this.inspect ? campusScale(this.inspect) : 1;
      const view = this.inspect?.kind
        ? new T.Vector3(
            this.inspect.x + Math.sin(this.orbit) * Math.max(7, this.inspect.radius * 1.6),
            Math.max(5, this.inspect.radius * 0.75),
            this.inspect.z + Math.cos(this.orbit) * Math.max(7, this.inspect.radius * 1.6),
          )
        : this.inspect
          ? new T.Vector3(
              forecourtX(this.inspect) + Math.sin(this.orbit) * this.camDistance * 3 * inspectScale,
              16 * inspectScale,
              this.inspect.z + Math.cos(this.orbit) * this.camDistance * 3 * inspectScale,
            )
          : this.overview
            ? new T.Vector3(-25, fit, 337)
            : new T.Vector3(
                this.position.x - Math.sin(angle) * this.camDistance,
                this.position.y + 2.4 + this.camDistance * 0.14,
                this.position.z - Math.cos(angle) * this.camDistance,
              );
      const target = this.inspect?.kind
        ? new T.Vector3(this.inspect.x, 1.8, this.inspect.z)
        : this.inspect
          ? new T.Vector3(
              forecourtX(this.inspect),
              3.5 * inspectScale,
              this.inspect.z - 7 * inspectScale,
            )
          : this.overview
            ? new T.Vector3(-25, 0, 150)
            : new T.Vector3(
                this.position.x + Math.sin(angle) * 2,
                this.position.y + 1.1,
                this.position.z + Math.cos(angle) * 2,
              );
      if (!this.overview && !this.inspect) {
        const ray = new T.Raycaster(
          target,
          view.clone().sub(target).normalize(),
          0.25,
          target.distanceTo(view),
        );
        const hits = ray
          .intersectObjects(
            this.scene.children.filter(
              (c) =>
                c !== this.rover &&
                c !== this.weather.sky &&
                c !== this.ground &&
                c !== this.routeLine &&
                !c.userData.cameraIgnore &&
                Math.hypot(c.position.x - this.position.x, c.position.z - this.position.z) < 45,
            ),
            true,
          )
          .filter(
            (h) => h.object.isMesh && h.object.material?.transparent !== true && h.distance > 1.7,
          );
        if (hits.length) {
          view
            .copy(target)
            .addScaledVector(ray.ray.direction, Math.max(2, hits[0].distance - 0.35));
          view.y = Math.max(view.y, this.position.y + 1.5);
        }
      }
      if (!this.overview && this.terrain)
        view.y = Math.max(view.y, this.terrain.height(view.x, view.z) + 1.1);
      this.camera.position.lerp(view, smooth);
      this.lookTarget.lerp(target, smooth);
      this.camera.lookAt(this.lookTarget);
      this.camera.updateMatrixWorld();
      this.sun.position.set(this.position.x - 25, 60, this.position.z + 30);
      this.sun.target.position.set(
        this.inspect?.x ?? this.position.x,
        0,
        this.inspect?.z ?? this.position.z,
      );
      this.sun.target.updateMatrixWorld();
      const r = this.canvas.getBoundingClientRect();
      for (const { c, button } of this.markers) {
        const p = new T.Vector3(c.x, 4.9, c.z).project(this.camera);
        button.hidden = !this.overview || p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.94;
        button.style.left = ((p.x + 1) * r.width) / 2 + 'px';
        button.style.top = ((1 - p.y) * r.height) / 2 + 'px';
      }
      updateStations(this, now);
      this.weather.update(dt, now);
      this.terrain?.update(now, this.reduced);
      this.places?.update(now);
      this.renderer.render(this.scene, this.camera);
    }
    if (this.active && !this.searchOpen) this.frame = requestAnimationFrame(this.loop);
  }
}
