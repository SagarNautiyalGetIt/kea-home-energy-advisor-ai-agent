import { useLayoutEffect, useRef } from 'react'

/**
 * Measures how far down the page an element starts and writes it to a CSS variable on
 * that element, so CSS can size it to whatever is left of the window below the topbar
 * and heading. How much is left depends on both of those, and both reflow with the
 * window width, so the offset is measured rather than guessed at. `offsetTop` up the
 * chain rather than `getBoundingClientRect`, because the answer must not change with the
 * scroll position.
 *
 * The dashboard's energy home and the profile card both use it, which is what keeps the
 * two boxes the same height on the same window.
 */
export function useViewportOffset<T extends HTMLElement>(variable: string) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      let offset = 0
      for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) offset += node.offsetTop
      element.style.setProperty(variable, `${Math.round(offset)}px`)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [variable])
  return ref
}
