// Virtual cursor: mouse and keyboard input sent to the page through
// Playwright (CDP input events). The user's real mouse is never moved.
// With `human: true`, movement follows curved paths with variable speed and
// field values are inserted in one go; with `human: false` it acts instantly.

const rand = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Cubic Bezier path from `from` to `to` with randomly bowed control points. */
function bezierPath(from, to, steps) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist, ny = dx / dist; // unit normal
  const bow = () => rand(-0.25, 0.25) * dist;
  const c1 = { x: from.x + dx * 0.3 + nx * bow(), y: from.y + dy * 0.3 + ny * bow() };
  const c2 = { x: from.x + dx * 0.7 + nx * bow(), y: from.y + dy * 0.7 + ny * bow() };
  const points = [];
  for (let i = 1; i <= steps; i++) {
    // Ease in-out so the cursor accelerates then slows near the target.
    const l = i / steps, t = l < 0.5 ? 2 * l * l : 1 - (-2 * l + 2) ** 2 / 2;
    const u = 1 - t;
    points.push({
      x: u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * to.x,
      y: u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * to.y,
    });
  }
  return points;
}

function createCursor(page, { human = true } = {}) {
  let pos = { x: rand(100, 400), y: rand(100, 300) };

  async function moveTo(x, y) {
    if (human) {
      const steps = Math.max(8, Math.min(60, Math.round(Math.hypot(x - pos.x, y - pos.y) / 12)));
      for (const p of bezierPath(pos, { x, y }, steps)) {
        await page.mouse.move(p.x, p.y);
        await sleep(rand(4, 14));
      }
    } else {
      await page.mouse.move(x, y);
    }
    pos = { x, y };
  }

  /** Move to a random point near the middle of the element. */
  async function pointAt(locator) {
    await locator.scrollIntoViewIfNeeded();
    // "In view" can still mean under a sticky header/footer bar, where a click
    // would hit the bar. Then bring the element to the middle of the window.
    await locator.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(el.contains(hit) || hit.contains(el))) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }).catch(() => {});
    // Menus slide or fade in: wait until the element stops moving before aiming.
    let box = await locator.boundingBox();
    for (let i = 0; i < 15 && box; i++) {
      await sleep(80);
      const next = await locator.boundingBox();
      if (next && Math.abs(next.x - box.x) < 1 && Math.abs(next.y - box.y) < 1) break;
      box = next;
    }
    if (!box) throw new Error('Element is not visible');
    await moveTo(box.x + box.width * rand(0.3, 0.7), box.y + box.height * rand(0.3, 0.7));
  }

  /** True when the element (or a child of it) is what sits under the pointer. */
  const underPointer = locator => locator.evaluate((el, p) => {
    const hit = document.elementFromPoint(p.x, p.y);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  }, pos).catch(() => true); // cross-frame or detached: don't block the click

  async function click(locator) {
    await pointAt(locator);
    // Something else under the pointer (an item still sliding in, an overlay): aim again.
    for (let i = 0; i < 5 && !(await underPointer(locator)); i++) {
      await sleep(150);
      await pointAt(locator);
    }
    if (human) await sleep(rand(60, 180));
    await page.mouse.down();
    if (human) await sleep(rand(40, 110));
    await page.mouse.up();
  }

  /**
   * Replace the element's content with `text`: click into the field, clear it,
   * then insert the whole value as one input event (like a paste), not key by key.
   */
  async function type(locator, text) {
    await click(locator);
    await locator.fill('');
    await page.keyboard.insertText(String(text));
  }

  const pause = (min = 300, max = 900) => (human ? sleep(rand(min, max)) : Promise.resolve());

  return { moveTo, pointAt, click, type, pause, get position() { return { ...pos }; } };
}

module.exports = { createCursor, bezierPath };
