export function weightedScore(familiarPercent) {
  return Math.round((95 * familiarPercent + 55 * (100 - familiarPercent)) / 100);
}
