/**
 * React wrapper around the field.
 *
 * Two things it is careful about:
 *
 * 1. **State changes do not remount the canvas.** `state` is pushed through a ref into
 *    the running field, so switching idle -> thinking is a change of weather, not a
 *    teardown. Remounting would blank the canvas for a frame, which is exactly the
 *    moment the user is looking at it.
 * 2. **It always cleans up.** A `requestAnimationFrame` loop outlives its component
 *    silently — the canvas is gone, the callback is not, and it keeps drawing into a
 *    detached node until the tab closes.
 */

import { useEffect, useRef } from 'react';
import { createField, type FieldHandle } from './engine';
import type { SparkyOptions } from './types';

export interface SparkySparksProps extends SparkyOptions {
  className?: string;
  /**
   * Announced to screen readers. Defaults to a phrase describing the state, because a
   * bare canvas is invisible to assistive tech and "the assistant is thinking" is real
   * information, not decoration.
   */
  label?: string;
}

const DEFAULT_LABELS: Record<SparkyOptions['state'], string> = {
  idle: 'Sparky is ready',
  thinking: 'Sparky is working on your answer',
  listening: 'Sparky is listening',
  speaking: 'Sparky is speaking',
};

export function SparkySparks({
  state,
  size = 64,
  colors,
  respectReducedMotion = true,
  className,
  label,
}: SparkySparksProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<FieldHandle | null>(null);

  // Recreated only when the things baked into the canvas change. `state` is deliberately
  // absent — see the note above.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced =
      respectReducedMotion &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const field = createField(canvas, state, size, colors, reduced);
    fieldRef.current = field;
    return () => {
      field.destroy();
      fieldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, respectReducedMotion, colors]);

  useEffect(() => {
    fieldRef.current?.setState(state);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label ?? DEFAULT_LABELS[state]}
      style={{ display: 'block', width: size, height: size }}
    />
  );
}

export default SparkySparks;
