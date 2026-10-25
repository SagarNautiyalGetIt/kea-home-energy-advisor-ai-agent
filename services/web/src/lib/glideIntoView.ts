/**
 * Scrolls an element up (or down) to the top of whatever scrolls it, less its own
 * `scroll-margin-top`, over a set time, easing in and out. The browser's own smooth scroll
 * takes no duration and covers a long page in about half a second, which reads as a jump.
 *
 * A wheel, touch or key from the reader stops the glide where it is rather than fighting
 * them. Reduced motion goes straight there.
 */
export function glideIntoView(element: HTMLElement, duration = 900) {
  const scroller = scrollParent(element)
  const scrollerTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
  const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
  const from = scroller.scrollTop
  const to = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
    from + element.getBoundingClientRect().top - scrollerTop - margin))
  if (Math.abs(to - from) < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    scroller.scrollTop = to
    return
  }

  let frame = 0
  const interrupts = ['wheel', 'touchstart', 'keydown'] as const
  const stop = () => {
    cancelAnimationFrame(frame)
    interrupts.forEach((type) => window.removeEventListener(type, stop))
  }
  interrupts.forEach((type) => window.addEventListener(type, stop, { passive: true }))

  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    // Cubic ease in and out: a gentle start, the distance in the middle, a soft landing.
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    scroller.scrollTop = from + (to - from) * eased
    if (t < 1) frame = requestAnimationFrame(step)
    else stop()
  }
  frame = requestAnimationFrame(step)
}

/** The nearest ancestor that actually scrolls, or the page itself. */
function scrollParent(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}
