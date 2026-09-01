/**
 * The palette. The app's own violet — Sparky belongs to the UI, not beside it.
 *
 * ## Why not amber
 *
 * An earlier version was electric amber, on the reasoning that a warm accent would make
 * the assistant read as its own entity. In the running app it read as *foreign*: the
 * only warm thing on a page of violet buttons, violet charts and violet links, sitting
 * in the middle of the assistant screen. Belonging to the interface turned out to matter
 * more than standing out from it.
 *
 * ## Where these came from
 *
 * Straight out of `services/web/src/index.css`, not eyeballed:
 *
 *   #4318ff   the primary, and by a wide margin the most-used colour in the app
 *   #5f45ff   the lighter step already used for hovers and gradients
 *   #2b3674   the ink navy
 *   #eef1ff   the palest violet tint
 *
 * ## Tuned for a light background
 *
 * The app's surfaces are white and #f4f7ff, so "bright" here means *saturated*, not
 * pale. The spark head is the strongest violet and the trail fades to transparent —
 * the inverse of what a dark-background design would do, where the head would be
 * near-white. A near-white head on white is invisible, which is exactly how the first
 * attempt disappeared.
 */

import type { SparkPalette } from './types';

export const VIOLET: SparkPalette = {
  /** The spark head. The app's primary, at full strength. */
  core: '#4318ff',
  /** The lighter step, for the leading edge of the trail. */
  hot: '#5f45ff',
  /** The body of the trail. */
  body: '#6f57ff',
  /** The cooling end, fading out. */
  tail: '#a89bff',
  /** The occasional paler spark, so the ring is not one value repeated. */
  arc: '#8c78ff',
  /** The core at the centre. */
  ember: '#4a25ff',
};

/**
 * For dark surfaces, where the violet needs lifting off the background. Not used in the
 * app today — kept because the deck and any dark marketing surface will want it.
 */
export const VIOLET_ON_DARK: SparkPalette = {
  core: '#cdc4ff',
  hot: '#a89bff',
  body: '#8c78ff',
  tail: '#5f45ff',
  arc: '#eef1ff',
  ember: '#7c5cff',
};

/** `#rrggbb` -> `rgba(r,g,b,a)`. Called per spark per frame, so it stays trivial. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
