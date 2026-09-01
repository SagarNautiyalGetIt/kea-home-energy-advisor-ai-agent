/**
 * Sparky Sparks — public types.
 *
 * Four states, chosen because the host app has exactly four surfaces for them. Adding a
 * fifth without a surface to put it on is how the Thinking Orbs set ended up with nine
 * states and three of them unused.
 */

export type SparkState =
  /** At rest. A few embers drifting, a slow breath. The assistant is present, not busy. */
  | 'idle'
  /** Working. Sparks stream inward from the rim and flare at the core. */
  | 'thinking'
  /** Microphone open. Radial pulses ripple outward — the field is reacting, not producing. */
  | 'listening'
  /** Speaking the answer back. Sparks burst outward in syncopated volleys. */
  | 'speaking';

export interface SparkyOptions {
  state: SparkState;
  /** Rendered size in CSS pixels. The canvas backing store scales by devicePixelRatio. */
  size: number;
  /**
   * Overrides the palette's hues. Leave unset for the electric amber default.
   * Useful when embedding somewhere the warm palette would fight the surrounding UI.
   */
  colors?: Partial<SparkPalette>;
  /**
   * Respect `prefers-reduced-motion`. Default true. When the user has asked for reduced
   * motion the field renders a still, softly-lit arrangement rather than freezing on an
   * arbitrary frame — a frozen particle system looks broken, not calm.
   */
  respectReducedMotion?: boolean;
}

export interface SparkPalette {
  /** The hottest point of the head — blue-white. */
  core: string;
  /** Just behind the head, where blue gives way to heat. */
  hot: string;
  /** The body of the trail. */
  body: string;
  /** The cooling end of the trail. */
  tail: string;
  /** The occasional all-blue arc spark. */
  arc: string;
  /** The core at the centre of the field. */
  ember: string;
}
