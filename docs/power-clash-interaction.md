# Power Clash navigation and Arena interaction

KEA-348 follows the two Home weather/energy PRs without changing their model or effects.

The shared navigation has six destinations: Home, Usage, Sparky AI, Billing, Power Clash, More. Power Clash appears once in both the bottom horizontal bar and Home's shortcut sheet. Responsive outer margins reserve48px targets at tested viewport widths320–1024px. Selection/accessibility labels retain the existing routing behaviour.

The Arena board claims touch at start and pauses the parent page's ScrollView until release, cancellation or unmount. The previous SVG press responders and competing pan recognizer had no explicit coordination with vertical scrolling. Native responder ownership now matches Home's proven gesture boundary. Reanimated still draws bounded±12° sideways/±9° vertical tilt and settles in260ms; device/game reduced motion keeps the same static board and tap selection.

Taps are converted from measured window coordinates into SVG's300×245 xMidYMid meet space, including narrow-phone scaling and wide-tablet letterboxing. The hit test checks actual pillar side/top polygons in reverse painter order so front faces win overlaps. A drag that exceeds6px at any point, including one that returns to its start, or multi-touch is never a tap. The untransformed wrapper supplies stable coordinates. Empty board/letterbox areas do not select a pillar. Accessible score controls remain below the board and reuse selection haptics; demo points never become earned XP.

Strict checks and108 mobile regressions cover narrow-target fit, unique routes, short/tall selected pillars, overlap, letterboxing, invalid/empty hits, bounded tilt and gesture sequences. Touch-start events invalidate multi-touch even if no finger moves; a drag returning to origin also stays ineligible. Android/iOS/web exports are build evidence. Physical taps, momentum/scroll ownership, cancellation, reduced motion and navigating away still require iOS/Android and second-machine acceptance before merge; source tests are not that evidence.
