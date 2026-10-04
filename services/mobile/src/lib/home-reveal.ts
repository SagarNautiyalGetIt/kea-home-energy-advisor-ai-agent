import type { gsap } from 'gsap';
import type { HomeCamera } from './home-camera';

type Pose = HomeCamera & { mix: number };
// Shared executable builders: tests seek the exact timelines used by Home.
export function appendHomeMaterial(timeline: gsap.core.Timeline, pose: Pose, publish: (force?: boolean) => void, pinned: boolean, reduceMotion: boolean) {
  return timeline.to(pose, { mix: pinned ? 1 : 0, duration: reduceMotion ? 0 : 2.2, ease: 'sine.inOut', onUpdate: () => publish(), onComplete: () => publish(true) });
}
export function appendHomeCameraReveal(timeline: gsap.core.Timeline, pose: Pose, publish: (force?: boolean) => void) {
  return timeline.to(pose, { x: 0, y: 0, zoom: 1, focusX: 0, focusY: 0, focusZ: 0, delay: 0.45, duration: 3.8, ease: 'power2.inOut', onUpdate: () => publish(), onComplete: () => publish(true) });
}
