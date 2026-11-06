import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { bottleMarkup, mountBottle } from '../components/bottle';
import { galleryMarkup, mountGallery } from '../components/gallery';
import { setHeader } from '../components/header';
import { mountProductCards, productCardMarkup } from '../components/product-card';
import { createRotator, rotatorControlsMarkup, type RotatorValue } from '../components/rotator';
import { formatPrice, getProduct, otherProducts, type Product, type ProductSize } from '../data/products';
import { attachLabelDebug, isDebugMode, type BottleLabel } from '../lib/bottle-label';
import { addToCart } from '../lib/cart';
import { esc, pad2, qs } from '../lib/dom';
import { MOTION_OK_QUERY, prefersReducedMotion } from '../lib/motion';
import { scrollToY } from '../lib/smooth-scroll';
import { applyAccent, resetAccent } from '../lib/theme';
import type { Page } from '../router';
import { notFoundPage } from './not-found';

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// Rozdziały hero: każdy ma pozę flakonu i obrót etykiety pokazujący inny panel
// (front → nuty → przerwa ze szkłem i płynem → panel ze składem → front).
// Obroty dobrane do układu etykiet z generatora placeholderów (GAP 0.12).
// ---------------------------------------------------------------------------

interface Pose {
  x: number; // xPercent
  y: number; // yPercent
  s: number; // scale
  r: number; // rotation (deg)
}

const CHAPTERS: { label: string; spin: number; pose: Pose }[] = [
  { label: 'Tożsamość', spin: 0, pose: { x: 0, y: 0, s: 1, r: 0 } },
  { label: 'Głowa', spin: 0.34, pose: { x: -6, y: 2, s: 1.06, r: -5 } },
  { label: 'Serce', spin: 0.5, pose: { x: 4, y: -2, s: 1.14, r: 0 } },
  { label: 'Baza', spin: 0.66, pose: { x: 2, y: 3, s: 1.02, r: 6 } },
  { label: 'Sygnatura', spin: 1, pose: { x: 0, y: 0, s: 1.04, r: -8 } },
];
const COUNT = CHAPTERS.length;

/** Środek rozdziału i w postępie 0–1 przypiętego hero. */
const chapterCenter = (i: number) => (i + 0.5) / COUNT;
const chapterAt = (progress: number) => Math.min(COUNT - 1, Math.floor(progress * COUNT));

/** Płynna interpolacja między pozami sąsiednich rozdziałów (smoothstep). */
function sampleChapters(progress: number): { spin: number; pose: Pose } {
  if (progress <= chapterCenter(0)) return CHAPTERS[0];
  if (progress >= chapterCenter(COUNT - 1)) return CHAPTERS[COUNT - 1];
  const i = Math.min(COUNT - 2, Math.floor(progress * COUNT - 0.5));
  const t = (progress - chapterCenter(i)) * COUNT;
  const e = t * t * (3 - 2 * t);
  const a = CHAPTERS[i];
  const b = CHAPTERS[i + 1];
  const lerp = (u: number, v: number) => u + (v - u) * e;
  return {
    spin: lerp(a.spin, b.spin),
    pose: { x: lerp(a.pose.x, b.pose.x), y: lerp(a.pose.y, b.pose.y), s: lerp(a.pose.s, b.pose.s), r: lerp(a.pose.r, b.pose.r) },
  };
}

// ---------------------------------------------------------------------------
// Treść
// ---------------------------------------------------------------------------

const lc = (s: string) => s.charAt(0).toLocaleLowerCase('pl') + s.slice(1);
const joinPl = (items: string[]) =>
  items.length < 2 ? lc(items[0] ?? '') : `${items.slice(0, -1).map(lc).join(', ')} i ${lc(items[items.length - 1])}`;

function chapterCopy(p: Product) {
  return [
    { eyebrow: `Perfumowa Aura · ${p.concentration}`, title: `${p.name}.`, text: p.tagline, tags: p.family.split(' · '), ghost: p.name.split(' ')[0] },
    {
      eyebrow: 'Nuty głowy',
      title: `${p.notes.top[0]}.`,
      text: `Otwarcie to ${joinPl(p.notes.top)}. Najlotniejsza warstwa – czujesz ją przez pierwsze kwadranse.`,
      tags: ['0–15 min', 'Otwarcie'],
      ghost: 'Głowa',
    },
    {
      eyebrow: 'Nuty serca',
      title: `${p.notes.heart[0]}.`,
      text: `W sercu: ${joinPl(p.notes.heart)}. Rozwija się po kilkunastu minutach i trwa kilka godzin.`,
      tags: ['30 min – 4 h', 'Serce'],
      ghost: 'Serce',
    },
    {
      eyebrow: 'Nuty bazy',
      title: `${p.notes.base[0]}.`,
      text: `Baza to ${joinPl(p.notes.base)} – ślad, który zostaje na skórze do wieczora.`,
      tags: [p.specs.longevity, 'Ślad'],
      ghost: 'Baza',
    },
    {
      eyebrow: 'Sygnatura',
      title: p.signature,
      text: p.description[1] ?? p.tagline,
      tags: [`Perfumiarz: ${p.perfumer}`, `Partia ${p.year}`],
      ghost: 'Aura',
    },
  ];
}

const SIZE_COPY: Record<number, string> = {
  30: 'Format podróżny – zmieści się w każdej torebce i kieszeni marynarki.',
  50: 'Najczęściej wybierana – na codzienne sięganie przez kilka miesięcy.',
  100: 'Flakon na dłużej – najniższa cena za mililitr.',
};
const sizeScale = (p: Product, size: ProductSize) => 0.78 + 0.22 * (size.ml / Math.max(...p.sizes.map((s) => s.ml)));

const unitFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ICON_ARROW_UR = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M7 17 17 7M8 7h9v9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const ICON_ARROW_DOWN = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 4v15m-6-6 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const ICON_ARROW_R = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const ICON_BAG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const ICON_BOTTLE = `<svg viewBox="0 0 24 40" aria-hidden="true" focusable="false"><rect x="7.5" y="1" width="9" height="8" rx="1.6"/><rect x="10" y="9" width="4" height="3.5" opacity=".7"/><rect x="3.5" y="12.5" width="17" height="26" rx="3.2" opacity=".85"/></svg>`;

function template(p: Product): string {
  const copy = chapterCopy(p);
  const fromPrice = Math.min(...p.sizes.map((s) => s.price));
  const smallest = p.sizes.reduce((a, b) => (a.ml < b.ml ? a : b));
  const selected = p.sizes.find((s) => s.ml === 50) ?? p.sizes[0];
  const kv = (rows: [string, string][]) =>
    `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const accordion: { title: string; body: string }[] = [
    {
      title: 'Kompozycja',
      body: kv([
        ['Koncentracja', p.concentration],
        ['Rodzina zapachowa', p.family],
        ['Perfumiarz', p.perfumer],
        ['Premiera', String(p.year)],
      ]),
    },
    {
      title: 'Na skórze',
      body: kv([
        ['Trwałość', p.specs.longevity],
        ['Projekcja', p.specs.sillage],
        ['Pora roku', p.specs.season],
        ['Okazja', p.specs.occasion],
      ]),
    },
    {
      title: 'Skład i przechowywanie',
      body: kv([
        ['Skład', 'Alcohol denat., parfum, aqua, linalool, limonene, citral, coumarin'],
        ['Przechowywanie', 'W temperaturze pokojowej, z dala od słońca'],
        ['Pochodzenie', 'Komponowane i rozlewane w Krakowie'],
      ]),
    },
  ];
  const features = [
    { label: 'Trwałość', title: `${p.specs.longevity} na skórze`, text: 'Na ubraniach i szalu zapach zostaje dłużej – często do następnego dnia.' },
    { label: 'Projekcja', title: `Projekcja ${p.specs.sillage}`, text: 'Jak daleko niesie się zapach w pierwszych godzinach po aplikacji.' },
    { label: 'Pora roku', title: p.specs.season.charAt(0).toLocaleUpperCase('pl') + p.specs.season.slice(1), text: 'Kiedy kompozycja rozwija się najpełniej.' },
    { label: 'Okazja', title: p.specs.occasion.charAt(0).toLocaleUpperCase('pl') + p.specs.occasion.slice(1), text: 'Sugerowany moment – choć najlepsza okazja to ta, którą wybierzesz.' },
  ];
  const tiers = [
    { title: 'Nuty głowy', items: p.notes.top, note: 'Pierwsze 15 minut – świeże, lotne otwarcie.' },
    { title: 'Nuty serca', items: p.notes.heart, note: 'Od pół godziny do czterech – charakter zapachu.' },
    { title: 'Nuty bazy', items: p.notes.base, note: 'Ślad do wieczora – to, co zostaje na skórze.' },
  ];

  return `
  <main id="main" class="product" tabindex="-1">

    <section class="stage surface-dark" id="zapach" data-stage aria-label="${esc(p.name)} – prezentacja zapachu">
      <div class="stage__inner grid">
        <div class="stage__meta">
          <span class="eyebrow">Perfumy niszowe · ${esc(p.family)}</span>
          <span class="eyebrow">Aura / Partia ${p.year}</span>
        </div>

        <div class="stage__ghosts" aria-hidden="true">
          ${copy.map((c, i) => `<span class="ghost${i === 0 ? ' is-active' : ''}" data-ghost="${i}">${esc(c.ghost)}</span>`).join('')}
        </div>

        <div class="stage__copy">
          <div class="stage__chapters">
            ${copy
              .map((c, i) => {
                const h = i === 0 ? 'h1' : 'h2';
                return `
              <div class="chapter${i === 0 ? ' is-active' : ''}" data-chapter="${i}">
                <p class="chapter__eyebrow"><span class="dot" aria-hidden="true"></span>${esc(c.eyebrow)}</p>
                <${h} class="chapter__title display">${esc(c.title)}</${h}>
                <p class="chapter__text">${esc(c.text)}</p>
                <ul class="tags">${c.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
              </div>`;
              })
              .join('')}
          </div>
          <div class="stage__actions">
            <a class="btn btn--light" href="#pojemnosci">Wybierz pojemność ${ICON_ARROW_UR}</a>
            <a class="link-quiet" href="#nuty">Poznaj nuty ${ICON_ARROW_DOWN}</a>
          </div>
          <p class="stage__price"><strong>od ${formatPrice(fromPrice)}</strong><span>${smallest.ml} ml · wysyłka w 24 h</span></p>
        </div>

        <div class="stage__visual">
          <div class="stage__glow" aria-hidden="true"></div>
          <div class="spin-surface" data-hero-surface tabindex="0" role="group" aria-roledescription="podgląd 3D"
            aria-label="Flakon ${esc(p.name)}" aria-describedby="rot-help-hero">
            <div class="stage__pose" data-hero-pose>
              ${bottleMarkup(p, { variant: 'hero', eager: true })}
            </div>
          </div>
        </div>

        <div class="stage__foot">
          <div class="stage__foot-head" data-hero-controls>
            <span class="eyebrow">Poznaj zapach</span>
            ${rotatorControlsMarkup('rot-help-hero')}
          </div>
          <ol class="chapter-nav" aria-label="Rozdziały">
            ${CHAPTERS.map(
              (c, i) => `
              <li>
                <button type="button" class="chapter-nav__btn" data-goto="${i}"${i === 0 ? ' aria-current="step"' : ''}>
                  <span class="chapter-nav__num">${pad2(i + 1)}</span>
                  <span class="chapter-nav__label">${c.label}</span>
                  <span class="chapter-nav__bar" aria-hidden="true"><span class="chapter-nav__fill" data-fill></span></span>
                </button>
              </li>`,
            ).join('')}
          </ol>
        </div>
      </div>
    </section>

    <section class="section surface-light" id="charakter" aria-labelledby="char-title">
      <div class="grid split">
        <div class="split__head">
          <p class="eyebrow">01 / Charakter</p>
          <h2 id="char-title" class="display display--md">${esc(p.motto)}</h2>
          <p class="lead">${esc(p.description[0])}</p>
        </div>
        <ul class="split__body features">
          ${features
            .map(
              (f) => `
            <li class="feature" data-reveal>
              <p class="eyebrow">${esc(f.label)}</p>
              <h3 class="feature__title">${esc(f.title)}</h3>
              <p class="feature__text">${esc(f.text)}</p>
            </li>`,
            )
            .join('')}
        </ul>
      </div>
    </section>

    <section class="section section--joined surface-light" id="nuty" aria-labelledby="notes-title">
      <div class="grid split">
        <div class="split__head">
          <p class="eyebrow">02 / Piramida zapachowa</p>
          <h2 id="notes-title" class="title">Trzy warstwy,<br />jeden ślad.</h2>
          <p class="lead">Nuty ujawniają się po kolei – od najlotniejszych po najtrwalsze.</p>
        </div>
        <ol class="split__body pillars">
          ${tiers
            .map(
              (t, i) => `
            <li class="pillar" data-reveal>
              <span class="pillar__num">${pad2(i + 1)}</span>
              <div>
                <h3 class="pillar__title">${t.title}</h3>
                <p class="pillar__notes">${t.items.map(esc).join(' · ')}</p>
                <p class="pillar__note">${t.note}</p>
              </div>
            </li>`,
            )
            .join('')}
        </ol>
      </div>
    </section>

    <section class="section surface-dark" id="pojemnosci" aria-labelledby="sizes-title">
      <div class="grid config">
        <div class="config__panel">
          <p class="eyebrow eyebrow--accent">03 / Pojemności</p>
          <h2 id="sizes-title" class="title">Trzy pojemności.<br />Jeden zapach.</h2>
          <p class="lead">Ta sama kompozycja w każdym flakonie – wybierz, jak często chcesz po nią sięgać.</p>

          <form class="config__form" data-buy>
            <fieldset class="variants">
              <div class="variants__head">
                <legend>Wybierz pojemność</legend>
                <span aria-hidden="true">01 — ${pad2(p.sizes.length)}</span>
              </div>
              <div class="variants__grid">
                ${p.sizes
                  .map(
                    (s) => `
                  <label class="variant">
                    <input type="radio" name="size" value="${s.ml}"${s === selected ? ' checked' : ''} />
                    <span class="variant__icon" style="--s:${sizeScale(p, s).toFixed(2)}">${ICON_BOTTLE}</span>
                    <span class="variant__name">${s.ml} ml</span>
                    <span class="variant__price">${formatPrice(s.price)}</span>
                    <span class="variant__check" aria-hidden="true"></span>
                  </label>`,
                  )
                  .join('')}
              </div>
            </fieldset>
            <p class="config__desc" data-size-desc>${esc(SIZE_COPY[selected.ml] ?? '')}</p>

            <div class="config__row">
              <div class="qty">
                <span class="qty__label" id="qty-label">Ilość</span>
                <div class="qty__ctrl" role="group" aria-labelledby="qty-label">
                  <button type="button" data-qty="-1" aria-label="Zmniejsz ilość">−</button>
                  <output data-qty-value aria-live="polite">1</output>
                  <button type="button" data-qty="1" aria-label="Zwiększ ilość">+</button>
                </div>
              </div>
              <div class="config__price">
                <span>Cena · brutto</span>
                <strong data-price>${formatPrice(selected.price)}</strong>
                <span data-unit>${unitFormat.format(selected.price / selected.ml)} / ml</span>
              </div>
            </div>

            <button class="btn btn--light btn--wide" type="submit">${ICON_BAG}<span>Dodaj do koszyka</span>${ICON_ARROW_R}</button>
            <button class="btn btn--outline btn--wide" type="button" data-sample>Zamów próbkę 2 ml · ${formatPrice(19)}</button>
            <p class="config__status" role="status" data-status></p>
            <p class="config__note"><span class="dot" aria-hidden="true"></span>Wysyłka w 24 h · darmowa dostawa od ${formatPrice(300)}.</p>
          </form>
        </div>

        <div class="config__visual">
          <div class="spin-surface config__surface" data-config-surface tabindex="0" role="group" aria-roledescription="podgląd 3D"
            aria-label="Flakon ${esc(p.name)} – wybrana pojemność" aria-describedby="rot-help-config">
            <div class="config__pose" data-config-pose>
              ${bottleMarkup(p, { variant: 'config', alt: `Flakon ${p.name}` })}
            </div>
          </div>
          <div class="config__controls" data-config-controls>${rotatorControlsMarkup('rot-help-config')}</div>
          <div class="config__caption"><span>${esc(p.name)}</span><span data-caption-size>${selected.ml} ml</span></div>
        </div>
      </div>
    </section>

    <section class="section section--joined surface-dark" id="szczegoly" aria-labelledby="spec-title">
      <div class="grid split">
        <div class="split__head">
          <p class="eyebrow eyebrow--accent">04 / Szczegóły</p>
          <h2 id="spec-title" class="title">Skład i pochodzenie.<br />Bez zbędnych słów.</h2>
          <p class="lead">Wszystko, co warto wiedzieć, zanim zapach trafi na skórę.</p>
          <p class="note-box">Dane demonstracyjne – kompozycje i parametry są fikcyjne.</p>
        </div>
        <div class="split__body accordion" data-accordion>
          ${accordion
            .map(
              (a, i) => `
            <div class="acc">
              <h3 class="acc__heading">
                <button type="button" class="acc__btn" id="acc-btn-${i}" aria-controls="acc-panel-${i}" aria-expanded="${i === 0}">
                  <span class="acc__num">${pad2(i + 1)}</span>
                  <span class="acc__title">${a.title}</span>
                  ${ICON_CHEVRON}
                </button>
              </h3>
              <div class="acc__panel" id="acc-panel-${i}" role="region" aria-labelledby="acc-btn-${i}"${i === 0 ? '' : ' hidden'}>${a.body}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section surface-light p-gallery">
      ${galleryMarkup(p, 'gallery-title', { eyebrow: '05 / W każdym detalu', title: 'Zapach, który widać.' })}
    </section>

    <section class="section surface-dark" aria-labelledby="others-title">
      <div class="grid others__head">
        <div>
          <p class="eyebrow eyebrow--accent">Kolekcja</p>
          <h2 id="others-title" class="title">Inne zapachy</h2>
        </div>
        <a class="link-quiet" href="/perfumy">Cała kolekcja ${ICON_ARROW_UR}</a>
      </div>
      <div class="cards grid">
        ${otherProducts(p.slug, 3)
          .map((o) => productCardMarkup(o))
          .join('')}
      </div>
    </section>

    <div class="buybar surface-dark" data-buybar aria-hidden="true" inert>
      <div class="buybar__inner">
        <span class="buybar__dot" aria-hidden="true"></span>
        <div class="buybar__id"><strong>${esc(p.name)}</strong><span data-bar-size>${selected.ml} ml</span></div>
        <div class="buybar__price"><strong data-bar-price>${formatPrice(selected.price)}</strong><span>brutto</span></div>
        <a class="buybar__link" href="#pojemnosci">Zmień pojemność ${ICON_ARROW_UR}</a>
        <button type="button" class="btn btn--light btn--sm" data-bar-add>${ICON_BAG}<span>Dodaj</span></button>
      </div>
    </div>
  </main>`;
}

// ---------------------------------------------------------------------------
// Strona
// ---------------------------------------------------------------------------

export function productPage(slug: string): Page {
  const product = getProduct(slug);
  if (!product) return notFoundPage();
  const p = product;

  const labels: BottleLabel[] = [];
  let mm: gsap.MatchMedia | null = null;
  const cleanups: (() => void)[] = [];

  return {
    title: `${p.name} — ${p.concentration} | Perfumowa Aura`,

    mount(view) {
      applyAccent(p.palette.accent);
      setHeader({
        sub: p.name,
        links: [
          { href: '#zapach', label: 'Zapach' },
          { href: '#nuty', label: 'Nuty' },
          { href: '#pojemnosci', label: 'Pojemności' },
          { href: '#szczegoly', label: 'Szczegóły' },
        ],
        cta: { href: '#pojemnosci', label: 'Wybierz pojemność' },
      });
      view.innerHTML = template(p);
      const main = qs(view, 'main');

      const hero = mountBottle(qs(main, '.stage [data-bottle]'), p);
      const config = mountBottle(qs(main, '.config [data-bottle]'), p);
      labels.push(hero, config);

      cleanups.push(mountStage(main, hero));
      cleanups.push(mountConfigurator(main, p, config));
      cleanups.push(mountAccordion(qs(main, '[data-accordion]')));
      cleanups.push(mountGallery(qs(main, '[data-gallery]')));
      cleanups.push(mountProductCards(main));

      mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
          gsap.from(el, { autoAlpha: 0, y: 40, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
        });
      });

      if (isDebugMode()) void attachLabelDebug(hero, p.name).then((dispose) => cleanups.push(dispose));
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },

    unmount() {
      mm?.revert();
      mm = null;
      cleanups.splice(0).forEach((fn) => fn());
      labels.splice(0).forEach((label) => label.dispose());
      resetAccent();
    },
  };
}

/** Przypięte hero z rozdziałami, obrotem etykiety ze scrolla i ręcznym obracaniem. */
function mountStage(main: HTMLElement, label: BottleLabel): () => void {
  const stage = qs(main, '[data-stage]');
  const pose = qs(stage, '[data-hero-pose]');
  const chapters = [...stage.querySelectorAll<HTMLElement>('[data-chapter]')];
  const ghosts = [...stage.querySelectorAll<HTMLElement>('[data-ghost]')];
  const navButtons = [...stage.querySelectorAll<HTMLButtonElement>('[data-goto]')];
  const fills = [...stage.querySelectorAll<HTMLElement>('[data-fill]')];

  const state = { intro: 0, progress: chapterCenter(0), chapter: 0, user: { turn: 0, tilt: 0 } as RotatorValue };
  let trigger: ScrollTrigger | null = null;

  const render = () => {
    const { spin, pose: q } = sampleChapters(state.progress);
    label.setOffset(state.intro + spin + state.user.turn);
    gsap.set(pose, { xPercent: q.x, yPercent: q.y, scale: q.s, rotation: q.r + state.user.tilt });
  };

  const updateFills = () => {
    fills.forEach((fill, i) => {
      const value = trigger ? Math.min(1, Math.max(0, state.progress * COUNT - i)) : i <= state.chapter ? 1 : 0;
      fill.style.transform = `scaleX(${value})`;
    });
  };

  const setChapter = (next: number) => {
    if (next === state.chapter) return;
    const prev = state.chapter;
    state.chapter = next;
    chapters.forEach((c, i) => c.classList.toggle('is-active', i === next));
    ghosts.forEach((g, i) => g.classList.toggle('is-active', i === next));
    navButtons.forEach((b, i) => (i === next ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    if (prefersReducedMotion()) return;
    const dir = next > prev ? 1 : -1;
    gsap.to(chapters[prev], { opacity: 0, y: -20 * dir, duration: 0.35, ease: 'power2.in', overwrite: true });
    gsap.fromTo(chapters[next], { opacity: 0, y: 28 * dir }, { opacity: 1, y: 0, duration: 0.8, delay: 0.12, ease: 'expo.out', overwrite: true });
    gsap.to(ghosts[prev], { opacity: 0, xPercent: -4 * dir, duration: 0.5, overwrite: true });
    gsap.fromTo(ghosts[next], { opacity: 0, xPercent: 4 * dir }, { opacity: 1, xPercent: 0, duration: 1, ease: 'expo.out', overwrite: true });
  };

  const goTo = (i: number) => {
    if (trigger) {
      scrollToY(trigger.start + (trigger.end - trigger.start) * chapterCenter(i));
      return;
    }
    // Bez pinu (reduced motion): przyciski działają jak zakładki.
    state.progress = chapterCenter(i);
    setChapter(i);
    updateFills();
    render();
  };

  const onNav = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-goto]');
    if (button) goTo(Number(button.dataset.goto));
  };
  stage.addEventListener('click', onNav);

  const rotator = createRotator({
    surface: qs(stage, '[data-hero-surface]'),
    controls: stage.querySelector<HTMLElement>('[data-hero-controls]'),
    onChange: (value) => {
      state.user = value;
      render();
    },
  });

  const mm = gsap.matchMedia();
  mm.add(MOTION_OK_QUERY, () => {
    // Wejście
    const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
    intro
      .from(chapters[0].children, { opacity: 0, y: 40, duration: 1.3, stagger: 0.08 }, 0.15)
      .from('.stage__actions, .stage__price', { opacity: 0, y: 20, duration: 1.1, stagger: 0.08 }, 0.5)
      .from('.stage .bottle', { opacity: 0, y: 70, duration: 1.8 }, 0.1)
      .from('.stage__glow', { opacity: 0, scale: 0.6, duration: 2.2 }, 0)
      .from('.stage__ghosts', { opacity: 0, duration: 2 }, 0.3)
      .from('.stage__meta, .stage__foot', { opacity: 0, duration: 1.2 }, 0.7);
    state.intro = -0.35;
    render();
    void label.ready.then(() =>
      gsap.to(state, { intro: 0, duration: 2.6, ease: 'expo.out', onUpdate: render }),
    );

    // Pin + scrub: postęp scrolla wybiera rozdział i kręci etykietą.
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: stage,
        start: 'top top',
        end: () => `+=${Math.round(window.innerHeight * (COUNT - 1))}`,
        pin: true,
        scrub: true,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          state.progress = self.progress;
          setChapter(chapterAt(self.progress));
          updateFills();
          render();
        },
      },
    });
    tl.fromTo('.stage__ghosts', { xPercent: 3 }, { xPercent: -3 }, 0).fromTo('.stage__glow', { scale: 0.9 }, { scale: 1.2 }, 0);
    trigger = tl.scrollTrigger ?? null;
    state.progress = 0;
    updateFills();

    return () => {
      trigger = null;
      gsap.killTweensOf([state, ...chapters, ...ghosts]);
      gsap.set([...chapters, ...ghosts], { clearProps: 'opacity,transform' });
      state.intro = 0;
      state.progress = chapterCenter(state.chapter);
      updateFills();
      render();
    };
  });

  updateFills();
  render();

  return () => {
    mm.revert();
    rotator.destroy();
    stage.removeEventListener('click', onNav);
    gsap.killTweensOf([state, ...chapters, ...ghosts]);
  };
}

/** Wybór pojemności, ilość, cena, drugi flakon z obrotem i pływający pasek zakupu. */
function mountConfigurator(main: HTMLElement, p: Product, label: BottleLabel): () => void {
  const form = qs<HTMLFormElement>(main, '[data-buy]');
  const pose = qs(main, '[data-config-pose]');
  const qtyValue = qs(form, '[data-qty-value]');
  const status = qs(form, '[data-status]');
  const bar = qs(main, '[data-buybar]');
  const state = { qty: 1, intro: 0, turn: 0 };

  const selected = () => {
    const ml = Number(new FormData(form).get('size'));
    return p.sizes.find((s) => s.ml === ml) ?? p.sizes[0];
  };
  const apply = () => label.setOffset(state.intro + state.turn);

  const update = (animate: boolean) => {
    const size = selected();
    qs(form, '[data-price]').textContent = formatPrice(size.price * state.qty);
    qs(form, '[data-unit]').textContent = `${unitFormat.format(size.price / size.ml)} / ml`;
    qs(form, '[data-size-desc]').textContent = SIZE_COPY[size.ml] ?? '';
    qs(main, '[data-caption-size]').textContent = `${size.ml} ml`;
    qs(bar, '[data-bar-size]').textContent = `${size.ml} ml`;
    qs(bar, '[data-bar-price]').textContent = formatPrice(size.price);
    qtyValue.textContent = String(state.qty);
    const scale = sizeScale(p, size);
    if (animate && !prefersReducedMotion()) gsap.to(pose, { scale, duration: 0.9, ease: 'expo.out' });
    else gsap.set(pose, { scale });
  };

  const add = (quantity: number, what: string) => {
    const count = addToCart(quantity);
    status.textContent = `Dodano do koszyka: ${what}. W koszyku: ${count} szt.`;
  };

  const onChange = () => {
    status.textContent = '';
    update(true);
  };
  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    const qty = target.closest<HTMLElement>('[data-qty]');
    if (qty) {
      state.qty = Math.max(1, Math.min(9, state.qty + Number(qty.dataset.qty)));
      update(false);
    } else if (target.closest('[data-sample]')) {
      add(1, `${p.name}, próbka 2 ml`);
    }
  };
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    add(state.qty, `${p.name}, ${selected().ml} ml × ${state.qty}`);
  };
  const onBarAdd = () => add(1, `${p.name}, ${selected().ml} ml`);

  form.addEventListener('change', onChange);
  form.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  qs(bar, '[data-bar-add]').addEventListener('click', onBarAdd);

  const rotator = createRotator({
    surface: qs(main, '[data-config-surface]'),
    controls: main.querySelector<HTMLElement>('[data-config-controls]'),
    onChange: (value) => {
      state.turn = value.turn;
      apply();
      gsap.set(pose, { rotation: value.tilt });
    },
  });

  // Pasek zakupu: widoczny po hero, chowa się przy konfiguratorze i stopce.
  const seen = new Map<Element, boolean>();
  const watched = [qs(main, '[data-stage]'), qs(main, '#pojemnosci'), document.querySelector('.site-footer')].filter(Boolean) as Element[];
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => seen.set(e.target, e.isIntersecting));
    const show = watched.every((el) => !seen.get(el));
    bar.classList.toggle('is-visible', show);
    bar.setAttribute('aria-hidden', String(!show));
    bar.toggleAttribute('inert', !show);
  });
  watched.forEach((el) => observer.observe(el));

  const mm = gsap.matchMedia();
  mm.add(MOTION_OK_QUERY, () => {
    ScrollTrigger.create({
      trigger: '#pojemnosci',
      start: 'top 70%',
      once: true,
      onEnter: () => {
        state.intro = -0.5;
        apply();
        gsap.to(state, { intro: 0, duration: 2.4, ease: 'expo.out', onUpdate: apply });
      },
    });
  });

  update(false);

  return () => {
    mm.revert();
    rotator.destroy();
    observer.disconnect();
    gsap.killTweensOf([state, pose]);
    form.removeEventListener('change', onChange);
    form.removeEventListener('click', onClick);
    form.removeEventListener('submit', onSubmit);
  };
}

function mountAccordion(root: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('.acc__btn');
    if (!button) return;
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
    ScrollTrigger.refresh();
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
