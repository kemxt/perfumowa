import { gsap } from 'gsap';
import { prefersReducedMotion } from '../lib/motion';

export interface RotatorValue {
  /** Obrót etykiety dodany przez użytkownika (w obrotach). */
  turn: number;
  /** Pochylenie flakonu w stopniach. */
  tilt: number;
}

const STEP_KEY = 1 / 16;
const STEP_BUTTON = 1 / 8;
const TILT_STEP = 3;
const TILT_MAX = 12;

const ICON_LEFT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_RIGHT = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function rotatorControlsMarkup(id: string): string {
  return `
    <div class="rotator" role="group" aria-label="Obracanie flakonu">
      <button type="button" class="rotator__btn" data-rot="left" aria-label="Obróć w lewo">${ICON_LEFT}</button>
      <button type="button" class="rotator__reset" data-rot="reset">Reset</button>
      <button type="button" class="rotator__btn" data-rot="right" aria-label="Obróć w prawo">${ICON_RIGHT}</button>
    </div>
    <p class="visually-hidden" id="${id}">Użyj strzałek w lewo i w prawo, aby obrócić flakon, w górę i w dół, aby go pochylić, oraz klawisza Home, aby przywrócić widok. Możesz też przeciągnąć flakon w bok.</p>`;
}

/**
 * Ręczne obracanie: przeciąganie, klawiatura (na `surface`, który musi mieć tabindex)
 * i przyciski [data-rot] w `controls`. Wartość jest wygładzana tickerem GSAP;
 * przy prefers-reduced-motion zmienia się skokowo.
 */
export function createRotator({
  surface,
  controls,
  onChange,
}: {
  surface: HTMLElement;
  controls?: HTMLElement | null;
  onChange: (value: RotatorValue) => void;
}): { reset: () => void; destroy: () => void } {
  const target: RotatorValue = { turn: 0, tilt: 0 };
  const shown: RotatorValue = { turn: 0, tilt: 0 };
  let drag: { id: number; x: number; turn: number } | null = null;

  const set = (turn: number, tilt: number) => {
    target.turn = turn;
    target.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, tilt));
    if (prefersReducedMotion()) {
      Object.assign(shown, target);
      onChange({ ...shown });
    }
  };

  const tick = () => {
    const dt = Math.abs(target.turn - shown.turn) + Math.abs(target.tilt - shown.tilt) / 90;
    if (dt < 1e-5) return;
    shown.turn += (target.turn - shown.turn) * 0.14;
    shown.tilt += (target.tilt - shown.tilt) * 0.14;
    if (dt < 2e-4) Object.assign(shown, target);
    onChange({ ...shown });
  };
  gsap.ticker.add(tick);

  const reset = () => set(0, 0);

  const onKey = (event: KeyboardEvent) => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => set(target.turn + STEP_KEY, target.tilt),
      ArrowRight: () => set(target.turn - STEP_KEY, target.tilt),
      ArrowUp: () => set(target.turn, target.tilt - TILT_STEP),
      ArrowDown: () => set(target.turn, target.tilt + TILT_STEP),
      Home: reset,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || (event.target as Element).closest('button, a')) return;
    drag = { id: event.pointerId, x: event.clientX, turn: target.turn };
    surface.setPointerCapture(event.pointerId);
    surface.classList.add('is-dragging');
  };
  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    // Przeciągnięcie przez całą szerokość = ok. 0.8 obrotu; w prawo obraca w prawo.
    const dx = (event.clientX - drag.x) / Math.max(1, surface.clientWidth);
    set(drag.turn - dx * 0.8, target.tilt);
  };
  const onUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    surface.classList.remove('is-dragging');
  };

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-rot]');
    if (!button) return;
    const action = button.dataset.rot;
    if (action === 'left') set(target.turn + STEP_BUTTON, target.tilt);
    else if (action === 'right') set(target.turn - STEP_BUTTON, target.tilt);
    else reset();
  };

  surface.addEventListener('keydown', onKey);
  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onUp);
  controls?.addEventListener('click', onClick);

  return {
    reset,
    destroy() {
      gsap.ticker.remove(tick);
      surface.removeEventListener('keydown', onKey);
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onUp);
      controls?.removeEventListener('click', onClick);
    },
  };
}
