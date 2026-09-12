export const TASKBAR_HEIGHT = 38;
export const WINDOW_MINIMUM = { width: 300, height: 280 };
export const MAJOR_MINIMUM = { width: 420, height: 540 };

const DESKTOP_MINIMUM = { width: 1000, height: 600 };
const TILED_MINIMUM = { width: 1240, height: 742 };
const TOP_INSET = 48;
const ICON_RAIL_WIDTH = 96;
const WINDOW_GAP = 18;

export const fitsDesktop = (width, height) =>
  width >= DESKTOP_MINIMUM.width && height >= DESKTOP_MINIMUM.height;

export function clampBox(box, area, minimum = { width: 280, height: 180 }) {
  const width = Math.min(area.width, Math.max(minimum.width, box.width));
  const height = Math.min(area.height, Math.max(minimum.height, box.height));
  return {
    width,
    height,
    left: Math.max(0, Math.min(area.width - width, box.left)),
    top: Math.max(0, Math.min(area.height - height, box.top)),
  };
}

export function initialLayout(width, height) {
  const box = (x, y, w, h) => clampBox({ left: x, top: y, width: w, height: h }, { width, height });
  const optional = {
    projects: box((width - 480) / 2 + 20, (height - 356) / 2, 480, 356),
    games: box((width - 480) / 2 + 40, (height - 356) / 2 + 20, 480, 356),
    join: box((width - 490) / 2, (height - 346) / 2, 490, 346),
  };
  if (width < TILED_MINIMUM.width || height < TILED_MINIMUM.height) {
    const left = Math.max(ICON_RAIL_WIDTH, Math.round((width - 1140) / 2));
    const majorWidth = Math.max(MAJOR_MINIMUM.width, Math.min(520, Math.round(width * 0.38)));
    const majorLeft = Math.min(width - majorWidth - 24, left + 318);
    const right = Math.min(width - 374, majorLeft + majorWidth - 160);
    // Keep title bars reachable when the main windows need to overlap.
    return {
      events: box(left, TOP_INSET, 300, 350),
      major: box(
        majorLeft,
        TOP_INSET,
        majorWidth,
        Math.max(MAJOR_MINIMUM.height, Math.min(640, height - 72)),
      ),
      journal: box(right, 100, 350, 314),
      lab: box(Math.min(width - 374, right + 24), 152, 350, 334),
      ...optional,
    };
  }
  const contentWidth = Math.min(width - 124, 1550);
  const left = Math.max(ICON_RAIL_WIDTH, Math.round((width - contentWidth) / 2));
  const eventWidth = Math.max(300, Math.min(340, Math.round(contentWidth * 0.24)));
  const reviewWidth = Math.max(350, Math.min(400, Math.round(contentWidth * 0.27)));
  const majorWidth = contentWidth - eventWidth - reviewWidth - WINDOW_GAP * 2;
  const majorLeft = left + eventWidth + WINDOW_GAP;
  const right = majorLeft + majorWidth + WINDOW_GAP;
  const availableHeight = height - TOP_INSET - 24;
  return {
    events: box(left, TOP_INSET, eventWidth, eventWidth < 330 ? 382 : 350),
    major: box(
      majorLeft,
      TOP_INSET,
      majorWidth,
      Math.min(availableHeight, majorWidth * 0.55 + 320),
    ),
    journal: box(right, TOP_INSET, reviewWidth, 314),
    lab: box(right, TOP_INSET + 314 + WINDOW_GAP, reviewWidth, 334),
    ...optional,
  };
}
