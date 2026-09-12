import assert from 'node:assert/strict';
import test from 'node:test';
import { DriveWorld } from '../public/drive/world.js';

function controls(t, initial = {}) {
  const frames = new Map();
  let frameId = 0;
  const globals = {
    window: new EventTarget(),
    document: new EventTarget(),
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const canvas = Object.assign(new EventTarget(), { setPointerCapture() {}, focus() {} });
  const world = Object.assign(Object.create(DriveWorld.prototype), {
    canvas,
    active: true,
    searchOpen: false,
    orbit: 0,
    camDistance: 8,
    ...initial,
  });
  world.loop = world.loop.bind(world);
  DriveWorld.prototype.controls.call(world);
  return {
    world,
    frames,
    search(open) {
      const event = new Event('club:search');
      event.detail = { open };
      globals.document.dispatchEvent(event);
    },
    pointer(type, pointerId, clientX, clientY = 0) {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId, clientX, clientY, button: 0 });
      canvas.dispatchEvent(event);
    },
  };
}

test('Drive camera stops dragging after pointer capture is lost', (t) => {
  const app = controls(t);
  app.pointer('pointerdown', 1, 10);
  app.pointer('pointermove', 1, 30);
  assert.notEqual(app.world.orbit, 0);
  const camera = { orbit: app.world.orbit, distance: app.world.camDistance };
  app.pointer('lostpointercapture', 1, 30);
  app.pointer('pointermove', 1, 100, 100);
  assert.equal(app.world.orbit, camera.orbit, 'hovering must not keep rotating the camera');
  assert.equal(app.world.camDistance, camera.distance);
});

test('Drive camera follows only the pointer that began its drag', (t) => {
  const app = controls(t);
  app.pointer('pointerdown', 1, 10);
  app.pointer('pointermove', 2, 200, 100);
  assert.equal(app.world.orbit, 0, 'a second touch must not rotate the first touch’s camera');
  assert.equal(app.world.camDistance, 8);
  app.pointer('pointerup', 2, 200);
  app.pointer('pointermove', 1, 30);
  assert.notEqual(app.world.orbit, 0, 'releasing a second touch must not end the first drag');
});

test('Quick Find freezes Drive input and its route, then resumes the same world once', (t) => {
  const route = [
      { x: 10, z: 20 },
      { x: 30, z: 40 },
    ],
    target = { campus: 'richland' },
    vehicle = { name: 'current vehicle' };
  const app = controls(t, {
    route,
    target,
    rover: vehicle,
    keys: { w: true },
    speed: 4,
    driveInput: { throttle: 1, steer: 0.5 },
    experience: {
      persist: () => assert.fail('search is not page navigation'),
      returnBonus: () => assert.fail('search does not earn a return bonus'),
    },
  });
  app.world.frame = globalThis.requestAnimationFrame(app.world.loop);
  app.pointer('pointerdown', 1, 10);
  app.search(true);
  assert.equal(app.world.active, true);
  assert.equal(app.world.searchOpen, true);
  assert.equal(app.frames.size, 0);
  assert.deepEqual(app.world.keys, {});
  assert.equal(app.world.driveInput, null);
  assert.equal(app.world.speed, 0);
  app.world.loop(500);
  app.pointer('pointermove', 1, 100);
  assert.equal(app.world.orbit, 0, 'search releases the camera drag');
  assert.strictEqual(app.world.route, route);
  assert.deepEqual(route, [
    { x: 10, z: 20 },
    { x: 30, z: 40 },
  ]);
  app.search(true);
  app.search(false);
  assert.equal(app.frames.size, 1);
  assert.strictEqual([...app.frames.values()][0], app.world.loop);
  const frame = app.world.frame;
  app.search(false);
  assert.equal(
    app.world.frame,
    frame,
    'duplicate close notifications cannot schedule another loop',
  );
  assert.equal(app.frames.size, 1);
  assert.strictEqual(app.world.target, target);
  assert.strictEqual(app.world.rover, vehicle);
  assert.strictEqual(app.world.route, route);
});

test('closing Quick Find cannot restart Drive after the visitor left the page', (t) => {
  let saves = 0;
  const app = controls(t, {
    keys: {},
    speed: 0,
    experience: { persist: () => saves++ },
  });
  app.world.frame = globalThis.requestAnimationFrame(app.world.loop);
  app.search(true);
  app.world.pause();
  app.search(false);
  assert.equal(saves, 1);
  assert.equal(app.world.active, false);
  assert.equal(app.frames.size, 0);
  app.world.loop(500);
  assert.equal(app.frames.size, 0);
});
