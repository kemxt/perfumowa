export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const MOTION_OK_QUERY = '(prefers-reduced-motion: no-preference)';

const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);

export function prefersReducedMotion(): boolean {
  return reducedMotion.matches;
}

export function onReducedMotionChange(callback: (reduced: boolean) => void): () => void {
  const listener = (event: MediaQueryListEvent) => callback(event.matches);
  reducedMotion.addEventListener('change', listener);
  return () => reducedMotion.removeEventListener('change', listener);
}
