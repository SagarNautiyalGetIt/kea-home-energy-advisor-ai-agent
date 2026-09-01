/**
 * Sparky's orbit ring. Plain 2D canvas — no WebGL, no CSS filters, no dependencies.
 *
 * ## The design
 *
 * Two concentric tracks, counter-rotating, with a handful of sparks running them. The
 * tracks breathe in radius on a slow sine and a soft core pulses at the centre. Each
 * spark is a short arc of trail with a bright head — drawn as a stroked arc, never as a
 * filled circle.
 *
 * It is calm on purpose. This sits on the assistant screen the whole time a customer is
 * reading, so the brief was "should not pull the eye" before it was anything else.
 *
 * ## Two mistakes from earlier attempts, both recorded so they stay dead
 *
 * **Filled circles with soft halos do not read as sparks.** They read as embers, or as
 * bokeh. A spark is a hairline: thin, saturated, with a tapered trail. Every stroke here
 * is a line or an arc, and the only filled shape in the file is the central core.
 *
 * **A free particle field reads as noise.** The first version threw particles on random
 * headings and was described, accurately, as a firecracker. Here the *structure* is
 * fixed — two circles, always — and only the sparks' positions on them move. That is
 * what makes it look designed rather than chaotic.
 *
 * ## Why counter-rotation
 *
 * One ring reads as a spinner, which is a loading affordance and says "wait". Two rings
 * turning against each other read as a mechanism doing something. It also stops the eye
 * locking onto a single spark and following it round, which is what makes a single ring
 * feel fast even when it is slow.
 */

import { VIOLET, withAlpha } from './theme';
import type { SparkPalette, SparkState } from './types';

interface Tuning {
  /** Sparks on the outer and inner track. */
  counts: [number, number];
  /** Radians per second on each track. Opposite signs — see the header. */
  speeds: [number, number];
  /** Trail length in radians. */
  trail: number;
  /** Seconds per breath. */
  breathPeriod: number;
  /** How far the tracks move, as a fraction of the field radius. */
  breathDepth: number;
  /** Core brightness, 0..1. */
  coreGain: number;
  /** Track line opacity. */
  trackAlpha: number;
  /**
   * Sparks bunch and release rather than running evenly spaced. 0 is even. Used by
   * `speaking`, where a steady ring would look like it was still thinking.
   */
  clump: number;
}

const TUNINGS: Record<SparkState, Tuning> = {
  // At rest. Three sparks, slow, a long breath. Should be ignorable in peripheral vision.
  idle: {
    counts: [3, 2],
    speeds: [0.30, -0.22],
    trail: 0.30,
    breathPeriod: 6.0,
    breathDepth: 0.030,
    coreGain: 0.45,
    trackAlpha: 0.07,
    clump: 0,
  },
  // Working. More sparks, quicker, but the same shape — the customer should read "still
  // the same thing, now busy", not "a different animation started".
  thinking: {
    counts: [6, 4],
    speeds: [0.95, -0.68],
    trail: 0.44,
    breathPeriod: 2.6,
    breathDepth: 0.055,
    coreGain: 0.85,
    trackAlpha: 0.11,
    clump: 0,
  },
  // Microphone open. Slower than thinking but a much deeper breath, so the ring visibly
  // expands and contracts — reacting rather than working.
  listening: {
    counts: [5, 3],
    speeds: [0.52, -0.40],
    trail: 0.34,
    breathPeriod: 1.7,
    breathDepth: 0.105,
    coreGain: 0.70,
    trackAlpha: 0.10,
    clump: 0,
  },
  // Answering. Sparks bunch and release around the track, which reads as cadence.
  speaking: {
    counts: [6, 4],
    speeds: [0.80, -0.58],
    trail: 0.40,
    breathPeriod: 1.15,
    breathDepth: 0.045,
    coreGain: 0.95,
    trackAlpha: 0.10,
    clump: 0.55,
  },
};

/** The size the tunings were authored against. */
const REFERENCE_SIZE = 96;

export interface FieldHandle {
  setState(state: SparkState): void;
  destroy(): void;
}

export function createField(
  canvas: HTMLCanvasElement,
  initial: SparkState,
  size: number,
  palette: Partial<SparkPalette> | undefined,
  reducedMotion: boolean,
): FieldHandle {
  const colors: SparkPalette = { ...VIOLET, ...palette };
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { setState: () => {}, destroy: () => {} };

  // Backing store at device resolution, CSS box at logical size. Without this the ring
  // is visibly soft on any HiDPI screen.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2;
  /** Line widths scale with the field, or a small ring is all outline and no spark. */
  const unit = Math.max(0.62, size / REFERENCE_SIZE);

  //: Track radii as fractions of R. Pushed out from 0.70/0.44, which left a third of the
  //: canvas empty around the rim and made the ring read as small no matter how large the
  //: box got. The margin left outside the outer track is deliberate: it has to clear
  //: half the head stroke plus the breath swell, or the sparks clip against the edge.
  const RADII: [number, number] = [0.82, 0.55];

  let state: SparkState = initial;
  let tuning = TUNINGS[state];
  let raf = 0;
  let last = performance.now();
  let clock = 0;

  /**
   * Where a spark sits on its track. Even spacing plus an optional clump term that
   * bunches them toward one point and releases — `speaking`'s cadence.
   */
  function angleFor(i: number, n: number, t: Tuning, spin: number): number {
    const even = (i / n) * Math.PI * 2;
    if (!t.clump) return even + spin;
    const pull = Math.sin(clock * 2.1) * t.clump;
    return even + spin + Math.sin(even) * pull * 0.5;
  }

  /** One spark: a trailing arc into a bright head. Stroked, never filled. */
  function drawSpark(r: number, ang: number, t: Tuning, tint: string, alpha: number): void {
    // The trail, drawn in three shortening segments of rising opacity. A single arc with
    // a gradient is not possible on a curved path in 2D canvas, and three segments is
    // enough to read as a taper without the cost of stepping it pixel by pixel.
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      const from = ang - t.trail * (1 - s / steps);
      const to = ang - t.trail * (1 - (s + 1) / steps);
      ctx!.strokeStyle = withAlpha(s === steps - 1 ? colors.hot : colors.tail, alpha * (0.18 + 0.34 * (s / steps)));
      ctx!.lineWidth = Math.max(1.0, (1.9 + s * 0.8) * unit);
      ctx!.lineCap = 'round';
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, from, to);
      ctx!.stroke();
    }
    // The head. A very short, thick arc rather than a dot — it keeps the spark reading
    // as something travelling along the track instead of a bead sitting on it.
    ctx!.strokeStyle = withAlpha(tint, alpha);
    ctx!.lineWidth = Math.max(1.8, 3.6 * unit);
    ctx!.lineCap = 'round';
    ctx!.beginPath();
    ctx!.arc(cx, cy, r, ang - 0.075, ang + 0.03);
    ctx!.stroke();
  }

  function render(breath: number): void {
    const t = tuning;
    ctx!.clearRect(0, 0, size, size);

    const swell = (breath - 0.5) * 2 * t.breathDepth;

    // Destructured rather than indexed: under `noUncheckedIndexedAccess` a tuple lookup
    // is `T | undefined`, and silently coercing that away is how a NaN radius ends up
    // drawing nothing with no error.
    const rings: Array<{ radius: number; count: number; speed: number; alpha: number }> = [
      { radius: RADII[0], count: t.counts[0], speed: t.speeds[0], alpha: 1 },
      { radius: RADII[1], count: t.counts[1], speed: t.speeds[1], alpha: 0.78 },
    ];

    rings.forEach((cfg, ring) => {
      const r = R * (cfg.radius + swell * (ring === 0 ? 1 : -0.6));
      // Counter-swell on the inner track: the two move against each other as well as
      // turning against each other, which is what makes the breath legible at a glance.

      ctx!.strokeStyle = withAlpha(colors.body, t.trackAlpha);
      ctx!.lineWidth = Math.max(0.7, 1.3 * unit);
      ctx!.beginPath();
      ctx!.arc(cx, cy, r, 0, Math.PI * 2);
      ctx!.stroke();

      const spin = clock * cfg.speed;
      for (let i = 0; i < cfg.count; i++) {
        const ang = angleFor(i, cfg.count, t, spin);
        // Every third spark takes the paler tint so the ring is not one value repeated.
        drawSpark(r, ang, t, i % 3 === 0 ? colors.arc : colors.core, cfg.alpha);
      }
    });

    // The core. The only filled shape in the file.
    const cr = R * (0.15 + 0.05 * breath);
    const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, cr);
    g.addColorStop(0, withAlpha(colors.ember, 0.62 * t.coreGain));
    g.addColorStop(0.45, withAlpha(colors.hot, 0.28 * t.coreGain));
    g.addColorStop(1, withAlpha(colors.tail, 0));
    ctx!.fillStyle = g;
    ctx!.beginPath();
    ctx!.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx!.fill();
  }

  function frame(now: number): void {
    // Clamped: a backgrounded tab resumes with a multi-second delta, which would jump
    // every spark most of the way round its track in one step.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;
    render(0.5 + 0.5 * Math.sin((clock / tuning.breathPeriod) * Math.PI * 2));
    raf = requestAnimationFrame(frame);
  }

  if (reducedMotion) {
    // A still frame is legitimate here in a way it was not for a particle field: the
    // arrangement is already a composed shape, so stopping it looks deliberate.
    render(0.5);
  } else {
    raf = requestAnimationFrame(frame);
  }

  return {
    setState(next: SparkState) {
      if (next === state) return;
      state = next;
      tuning = TUNINGS[next];
      // No reset. `clock` keeps running, so the rings carry on from where they were and
      // the change is a shift in tempo rather than a cut.
      if (reducedMotion) render(0.5);
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
