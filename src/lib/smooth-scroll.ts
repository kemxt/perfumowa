import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { onReducedMotionChange, prefersReducedMotion } from './motion';

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;

function enable() {
  if (lenis) return;
  lenis = new Lenis({ autoRaf: false, lerp: 0.085, wheelMultiplier: 0.9 });
  lenis.on('scroll', ScrollTrigger.update);
}

function disable() {
  lenis?.destroy();
  lenis = null;
}

/**
 * Lenis napędzany tickerem GSAP – jedna pętla rAF dla scrolla i ScrollTriggera.
 * Przy prefers-reduced-motion zostaje natywny scroll.
 */
export function initSmoothScroll(): void {
  history.scrollRestoration = 'manual';
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  if (!prefersReducedMotion()) enable();
  onReducedMotionChange((reduced) => (reduced ? disable() : enable()));
}

export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
}

export function scrollToY(y: number): void {
  if (lenis) lenis.scrollTo(y, { duration: 1.4 });
  else window.scrollTo({ top: y, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function scrollToElement(target: HTMLElement, offset = 0): void {
  if (lenis) {
    lenis.scrollTo(target, { offset });
  } else {
    const top = target.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}
