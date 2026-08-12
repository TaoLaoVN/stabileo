/**
 * label-layout.ts — placing labels so they do not land on top of each other.
 *
 * # The problem, stated once
 *
 * Every annotation on the canvas wants to sit at one particular place: a load's
 * value belongs next to its arrow, a member's tag next to the member. When two
 * of them want overlapping places, both become unreadable — and the drawing
 * looks broken in a way that suggests the numbers are wrong rather than merely
 * badly positioned.
 *
 * The previous answer was a per-load `labelYOffset` decided upstream: a
 * hard-coded nudge that had to be maintained by hand, knew nothing about what
 * was actually on screen, and could not react to zoom. Two distributed loads on
 * one beam still collided, because the offset was chosen without looking.
 *
 * # The approach
 *
 * Greedy placement in priority order, which is the standard answer to label
 * collision and the right one here for a specific reason: it lets us decide WHO
 * keeps their preferred spot. The largest load is the one a reader looks for
 * first, so it is placed first and keeps its natural position; smaller ones move
 * out of its way. That produces the ordering by magnitude a reader expects
 * rather than an arbitrary one that depends on element ids.
 *
 * A label displaced along its own preferred direction — outward from the member
 * it annotates — stays visibly attached to what it describes. Displacing it
 * sideways, or to wherever there happens to be room, would break that.
 *
 * # What counts as an obstacle
 *
 * Other labels, and the STRUCTURE itself: a value written across a column is as
 * unreadable as one written across another value, which is what the point-load
 * labels were doing. Members are passed in as segments and treated as thin
 * boxes, so the same routine handles both.
 */

/**
 * Collects every label drawn in one frame so they can be laid out together.
 *
 * Resolving each KIND of load separately is not enough, and the reason is the
 * whole point of this module: a point load's value and a distributed load's
 * value are drawn by different functions, know nothing about each other, and
 * land on the same beam. Whoever ran last won. One collector, passed through
 * the draw context and flushed once, is what makes the guarantee hold across
 * the whole drawing rather than within each renderer.
 */
export interface LabelCollector {
  /** Queue a label. Nothing is drawn until `flush`. */
  add(entry: { text: string; colour: string; font: string; box: LabelBox }): void;
  /** Declare something labels must avoid — an arrow, a member, a node marker. */
  block(seg: SegmentObstacle): void;
  /** Lay everything out and draw it. Safe to call with nothing queued. */
  flush(ctx: CanvasRenderingContext2D, extra?: SegmentObstacle[]): void;
}

export function createLabelCollector(): LabelCollector {
  const entries: Array<{ text: string; colour: string; font: string; box: LabelBox }> = [];
  const blockers: SegmentObstacle[] = [];
  return {
    add(entry) { entries.push(entry); },
    block(seg) { blockers.push(seg); },
    flush(ctx, extra = []) {
      if (entries.length === 0) return;
      const obstacles = [...blockers, ...extra].flatMap((s) => segmentToBoxes(s));
      const placed = placeLabels(entries.map((e) => e.box), obstacles);
      const prevAlign = ctx.textAlign;
      const prevBaseline = ctx.textBaseline;
      // Everything is measured from the alphabetic baseline, so anything the
      // caller left set would move the text away from the box that was tested.
      ctx.textBaseline = 'alphabetic';
      for (let i = 0; i < entries.length; i++) {
        ctx.textAlign = entries[i].box.anchorX === 'left' ? 'left' : 'center';
        ctx.font = entries[i].font;
        ctx.fillStyle = entries[i].colour;
        ctx.fillText(entries[i].text, placed[i].x, placed[i].y);
      }
      ctx.textAlign = prevAlign;
      ctx.textBaseline = prevBaseline;
      entries.length = 0;
      blockers.length = 0;
    },
  };
}

export interface LabelBox {
  /** Preferred position: where the label goes if nothing is in the way. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Unit vector along which the label may be pushed, screen space.
   *
   * Displacement follows this so the label stays on the side of the member it
   * belongs to. Zero-length means the label cannot move and will simply be
   * placed at its preferred spot.
   */
  dirX: number;
  dirY: number;
  /**
   * Higher goes first and keeps its preferred position. Use the magnitude the
   * label reports, so the biggest number stays where the eye looks for it.
   */
  priority: number;
  /**
   * Where `x` sits relative to the text. `'left'` matches a `fillText` drawn
   * with the default `textAlign`, which is what canvas code writes without
   * thinking about it; the box then extends to the right of `x`.
   *
   * Getting this wrong misplaces the collision box by half a width — the label
   * is tested somewhere it will not be drawn, so it dodges obstacles it does
   * not touch and lands on ones it does.
   */
  anchorX?: 'left' | 'center';
  /**
   * How far the label is allowed to look for room.
   *
   * - `'forward'` — along `dir` only.
   * - `'both'` — along `dir` either way, preferring `dir`.
   * - `'any'` — `dir` first, then perpendicular to it.
   *
   * Stacked distributed loads want `'forward'`: they must all move away from
   * the member, or the smaller ones end up inside the arrows.
   *
   * A point load's value wants `'any'`, and the reason is worth stating: an
   * escape direction only helps if it is transverse to the obstacle. Sliding a
   * label left when what blocks it is a horizontal beam moves it the whole
   * search distance and leaves it on the beam — which is how the axial and
   * moment values ended up 150 px away and still unreadable. Searching the
   * perpendicular too costs one more ring and finds the way out immediately.
   */
  sweep?: 'forward' | 'both' | 'any';
}

export interface PlacedLabel {
  x: number;
  y: number;
  /** How far it had to move, in pixels. Zero means it got its first choice. */
  displaced: number;
}

/** An axis-aligned box that a label must not cover. */
export interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Line segment obstacle — a member, an arrow, a row of symbols. */
export interface SegmentObstacle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Half-thickness in px. A line has none of its own, but the thing it stands
   * for often does: the row of `+` symbols marking a thermal load is a strip
   * about ten pixels deep, and describing it as a bare line lets a label land
   * in the middle of it.
   */
  pad?: number;
}

const overlaps = (a: Obstacle, b: Obstacle): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * A segment as one box, padded so a label does not merely graze it.
 *
 * Exact for an axis-aligned member — a beam or a column, which is most of what
 * a frame is made of. For anything diagonal use `segmentToBoxes`.
 */
export function segmentToBox(s: SegmentObstacle, pad = 3): Obstacle {
  const p = s.pad ?? pad;
  const x = Math.min(s.x1, s.x2) - p;
  const y = Math.min(s.y1, s.y2) - p;
  return {
    x, y,
    width: Math.abs(s.x2 - s.x1) + p * 2,
    height: Math.abs(s.y2 - s.y1) + p * 2,
  };
}

/**
 * A segment as a CHAIN of boxes that follows the line.
 *
 * One bounding box around a diagonal declares the entire triangle on either
 * side of it occupied — a truss brace would forbid a quarter of the screen,
 * and every label near it would be shoved the full search distance away for no
 * reason. Chaining short boxes keeps the obstacle the shape of the member.
 *
 * An axis-aligned segment gets a single box, since for that case the bounding
 * box IS the member and subdividing would only add work.
 */
export function segmentToBoxes(s: SegmentObstacle, pad = 3, span = 24): Obstacle[] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [segmentToBox(s, pad)];

  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / span));
  const out: Obstacle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(segmentToBox({
      x1: s.x1 + (dx * i) / n, y1: s.y1 + (dy * i) / n,
      x2: s.x1 + (dx * (i + 1)) / n, y2: s.y1 + (dy * (i + 1)) / n,
      pad: s.pad,
    }, pad));
  }
  return out;
}

/**
 * Place labels so none overlaps another or an obstacle.
 *
 * `step` is how far each attempt moves; `maxSteps` bounds the search so a
 * hopeless case — a label boxed in on every side — degrades to "slightly
 * overlapping" rather than to an infinite loop or a label thrown off screen.
 * Returned in the SAME ORDER as the input, whatever order they were placed in,
 * because the caller indexes by its own list.
 */
export function placeLabels(
  labels: LabelBox[],
  obstacles: Obstacle[] = [],
  step = 14,
  maxSteps = 8,
): PlacedLabel[] {
  const out: PlacedLabel[] = new Array(labels.length);
  const taken: Obstacle[] = [...obstacles];

  // Largest first, so the number a reader looks for keeps its natural place and
  // the smaller ones are the ones that move.
  const order = labels
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.priority - a.l.priority);

  for (const { l, i } of order) {
    const len = Math.hypot(l.dirX, l.dirY);
    const ux = len > 1e-9 ? l.dirX / len : 0;
    const uy = len > 1e-9 ? l.dirY / len : 0;
    const left = l.anchorX === 'left';
    const boxAt = (dx: number, dy: number): Obstacle => ({
      x: l.x + dx - (left ? 0 : l.width / 2),
      y: l.y + dy - l.height,
      width: l.width,
      height: l.height,
    });

    // Candidate displacements, nearest first: the preferred spot, then one
    // ring at a time. Within a ring, the label's own direction comes first, so
    // ties are broken toward where it wants to be.
    const sweep = l.sweep ?? 'forward';
    const candidates: Array<[number, number]> = [[0, 0]];
    if (len > 1e-9) {
      // Perpendicular in screen space; sign chosen so "up" is tried before
      // "down" for a horizontal preference, matching how labels read.
      const px = uy;
      const py = -ux;
      for (let k = 1; k <= maxSteps; k++) {
        const d = k * step;
        candidates.push([ux * d, uy * d]);
        if (sweep !== 'forward') candidates.push([-ux * d, -uy * d]);
        if (sweep === 'any') {
          candidates.push([px * d, py * d]);
          candidates.push([-px * d, -py * d]);
        }
      }
    }

    let best = { x: l.x, y: l.y, displaced: 0 };
    let placed = false;

    for (const [dx, dy] of candidates) {
      const box = boxAt(dx, dy);
      if (!taken.some((o) => overlaps(box, o))) {
        best = { x: l.x + dx, y: l.y + dy, displaced: Math.hypot(dx, dy) };
        taken.push(box);
        placed = true;
        break;
      }
    }

    if (!placed) {
      /*
       * Nothing was free. Keep the PREFERRED spot rather than the last thing
       * tried: a label that cannot avoid an overlap is at least still beside
       * what it describes, whereas one parked at the end of the search is both
       * overlapping and detached — which reads as belonging to something else.
       */
      best = { x: l.x, y: l.y, displaced: 0 };
      taken.push(boxAt(0, 0));
    }
    out[i] = best;
  }

  return out;
}
