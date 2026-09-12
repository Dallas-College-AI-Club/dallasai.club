import { MAP_BOUNDS } from '../drive/geography.js';
import { DriveScore, pageId } from '../drive/score.js';
export const RUN_KEY = 'dc-drive-progress-v1';
export function readRun(storage) {
  try {
    const run = JSON.parse((storage ?? globalThis.localStorage).getItem(RUN_KEY) || 'null');
    if (!run || run.version !== 1) return null;
    const p = run.position;
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.z) ||
      p.x < MAP_BOUNDS.minX ||
      p.x > MAP_BOUNDS.maxX ||
      p.z < MAP_BOUNDS.minZ ||
      p.z > MAP_BOUNDS.maxZ ||
      !Number.isFinite(run.heading)
    )
      return null;
    return run;
  } catch {
    return null;
  }
}
export function writeRun(run, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(RUN_KEY, JSON.stringify({ ...run, version: 1 }));
    return true;
  } catch {
    return false;
  }
}
export function visitSavedPage(id, storage) {
  const run = readRun(storage);
  if (!run) return;
  const score = new DriveScore({ nodes: [], edges: [] });
  if (!score.restore(run.score)) return;
  score.visitPage(pageId(id));
  writeRun({ ...run, score: score.snapshot() }, storage);
}
