import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { bottleMarkup, mountBottle } from '../components/bottle';
import { galleryMarkup, mountGallery } from '../components/gallery';
import { mountProductCards, productCardMarkup } from '../components/product-card';
import { createRotator, rotatorControlsMarkup, type RotatorValue } from '../components/rotator';
import { formatPrice, getProduct, otherProducts, type Product } from '../data/products';
import { attachLabelDebug, isDebugMode, type BottleLabel } from '../lib/bottle-label';
import { addToCart } from '../lib/cart';
import { esc, pad2, qs } from '../lib/dom';
import { MOTION_OK_QUERY, prefersReducedMotion } from '../lib/motion';
import { scrollToY } from '../lib/smooth-scroll';
import type { Page } from '../router';
import { notFoundPage } from './not-found';

gsap.registerPlugin(ScrollTrigger);

// ---------------------------------------------------------------------------
// Rozdziały przypiętego hero. Każdy obraca etykietę do innego panelu
// (front → nuty → przerwa z płynem → pełny obrót) i lekko zmienia pozę flakonu.
// Obroty dobrane do etykiet z generatora placeholderów (GAP 0.12).
// ---------------------------------------------------------------------------

interface Pose {
  x: number; // xPercent
  y: number; // yPercent
  s: number; // scale
  r: number; // rotation (deg)
}

const CHAPTERS: { label: string; spin: number; pose: Pose }[] = [
  { label: 'Profil', spin: 0, pose: { x: 0, y: 0, s: 1, r: 0 } },
  { label: 'Nuty głowy', spin: 0.34, pose: { x: -2, y: 1, s: 1.03, r: -2.5 } },
  { label: 'Nuty serca', spin: 0.5, pose: { x: 2, y: -1, s: 1.06, r: 0 } },
  { label: 'Nuty bazy', spin: 1, pose: { x: 0, y: 0, s: 1.02, r: 2.5 } },
];
const COUNT = CHAPTERS.length;

const chapterCenter = (i: number) => (i + 0.5) / COUNT;
const chapterAt = (progress: number) => Math.min(COUNT - 1, Math.floor(progress * COUNT));

/** Płynne przejście między pozami sąsiednich rozdziałów (smoothstep). */
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

const unitFormat = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sizeScale = (p: Product, ml: number) => 0.8 + 0.2 * (ml / Math.max(...p.sizes.map((s) => s.ml)));
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase('pl') + s.slice(1);

const ICON_CHEVRON = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;

const table = (rows: [string, string][]) =>
  `<dl class="table">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

function template(p: Product): string {
  const fromPrice = Math.min(...p.sizes.map((s) => s.price));
  const selected = p.sizes.find((s) => s.ml === 50) ?? p.sizes[0];
  const join = (items: string[]) => items.map((t, i) => (i ? t.charAt(0).toLocaleLowerCase('pl') + t.slice(1) : t)).join(', ');

  const story = [
    {
      body: table([
        ['Rodzina', capitalize(p.family.toLocaleLowerCase('pl'))],
        ['Perfumiarz', p.perfumer],
        ['Trwałość', p.specs.longevity],
      ]),
    },
    { body: `<p class="story__notes">${esc(join(p.notes.top))}</p><p class="story__text">${esc(p.story.top)}</p>` },
    { body: `<p class="story__notes">${esc(join(p.notes.heart))}</p><p class="story__text">${esc(p.story.heart)}</p>` },
    { body: `<p class="story__notes">${esc(join(p.notes.base))}</p><p class="story__text">${esc(p.story.base)}</p>` },
  ];

  const details = [
    {
      title: 'Skład',
      body: `<p>Alcohol denat., parfum (fragrance), aqua (water), linalool, limonene, citral, geraniol, coumarin, benzyl benzoate, citronellol.</p>`,
    },
    {
      title: 'Wysyłka i zwroty',
      body: `<p>Zamówienia wysyłamy w ciągu 1–2 dni roboczych kurierem lub do paczkomatu. Dostawa jest bezpłatna od ${formatPrice(300)}. Nieotwarty flakon możesz zwrócić w ciągu 30 dni.</p>`,
    },
    {
      title: 'Stosowanie i przechowywanie',
      body: `<p>Rozpyl z odległości około 15 cm na nadgarstki i szyję. Przechowuj w temperaturze pokojowej, z dala od słońca. Otwarty flakon zachowuje pełny zapach przez co najmniej trzy lata.</p>`,
    },
  ];

  return `
  <main id="main" class="product" tabindex="-1">

    <section class="stage surface-dark" data-stage aria-labelledby="product-title">
      <div class="stage__inner grid">
        <div class="stage__intro">
          <p class="label">${esc(p.concentration)}</p>
          <h1 id="product-title" class="t-display">${esc(p.name)}</h1>
          <p class="stage__tagline">${esc(p.tagline)}</p>
          <div class="stage__buy">
            <p class="stage__price">od ${formatPrice(fromPrice)}</p>
            <a class="btn btn--primary" href="#kup">Wybierz pojemność</a>
          </div>
        </div>

        <div class="stage__visual">
          <div class="spin-surface" data-hero-surface tabindex="0" role="group" aria-roledescription="podgląd 3D"
            aria-label="Flakon ${esc(p.name)}" aria-describedby="rot-help-hero">
            <div class="stage__pose" data-hero-pose>
              ${bottleMarkup(p, { variant: 'hero', eager: true })}
            </div>
          </div>
          <div class="stage__controls" data-hero-controls>${rotatorControlsMarkup('rot-help-hero')}</div>
        </div>

        <div class="stage__story">
          <div class="progress" aria-hidden="true"><span class="progress__fill" data-progress></span></div>
          <ol class="story" aria-label="Kompozycja">
            ${CHAPTERS.map(
              (c, i) => `
              <li class="story__item${i === 0 ? ' is-active' : ''}" data-chapter="${i}">
                <h2 class="story__head">
                  <button type="button" class="story__btn" data-goto="${i}"${i === 0 ? ' aria-current="step"' : ''}>
                    <span class="story__num">${pad2(i + 1)}</span>${c.label}
                  </button>
                </h2>
                <div class="story__body"><div>${story[i].body}</div></div>
              </li>`,
            ).join('')}
          </ol>
        </div>
      </div>
    </section>

    <section class="section surface-light" id="opis" aria-labelledby="about-title">
      <div class="grid about">
        <div class="about__text">
          <h2 id="about-title" class="label">Opis</h2>
          <p class="t-lead">${esc(p.description[0])}</p>
          ${p.description
            .slice(1)
            .map((para) => `<p class="about__para">${esc(para)}</p>`)
            .join('')}
        </div>
        <div class="about__facts">
          <h3 class="label">Nuty</h3>
          ${table([
            ['Głowa', join(p.notes.top)],
            ['Serce', join(p.notes.heart)],
            ['Baza', join(p.notes.base)],
          ])}
          <h3 class="label">Profil</h3>
          ${table([
            ['Rodzina', capitalize(p.family.toLocaleLowerCase('pl'))],
            ['Koncentracja', p.concentration],
            ['Trwałość', p.specs.longevity],
            ['Projekcja', capitalize(p.specs.sillage)],
            ['Pora roku', capitalize(p.specs.season)],
            ['Okazja', capitalize(p.specs.occasion)],
            ['Perfumiarz', p.perfumer],
            ['Premiera', String(p.year)],
          ])}
        </div>
      </div>
    </section>

    <section class="section section--flush surface-light p-gallery">
      ${galleryMarkup(p, 'gallery-title')}
    </section>

    <section class="section surface-dark" id="kup" aria-labelledby="buy-title">
      <div class="grid buy">
        <div class="buy__panel">
          <h2 id="buy-title" class="t-h2">${esc(p.name)}</h2>
          <p class="buy__sub">${esc(p.concentration)} · ${esc(p.tagline)}</p>

          <form class="buy__form" data-buy>
            <fieldset class="sizes">
              <legend class="label">Pojemność</legend>
              ${p.sizes
                .map(
                  (s) => `
                <label class="size">
                  <input type="radio" name="size" value="${s.ml}"${s === selected ? ' checked' : ''} />
                  <span class="size__radio" aria-hidden="true"></span>
                  <span class="size__ml">${s.ml} ml</span>
                  <span class="size__unit">${unitFormat.format(s.price / s.ml)} / ml</span>
                  <span class="size__price">${formatPrice(s.price)}</span>
                </label>`,
                )
                .join('')}
            </fieldset>

            <div class="buy__row">
              <div class="qty" role="group" aria-labelledby="qty-label">
                <span class="label" id="qty-label">Ilość</span>
                <div class="qty__ctrl">
                  <button type="button" data-qty="-1" aria-label="Zmniejsz ilość">−</button>
                  <output data-qty-value aria-live="polite">1</output>
                  <button type="button" data-qty="1" aria-label="Zwiększ ilość">+</button>
                </div>
              </div>
              <p class="buy__total"><span class="label">Razem</span><strong data-total>${formatPrice(selected.price)}</strong></p>
            </div>

            <button class="btn btn--primary btn--block" type="submit">Dodaj do koszyka</button>
            <button class="btn btn--quiet btn--block" type="button" data-sample>Zamów próbkę 2 ml · ${formatPrice(19)}</button>
            <p class="buy__status" role="status" data-status></p>

            <ul class="buy__info">
              <li>Wysyłka w 1–2 dni robocze</li>
              <li>Darmowa dostawa od ${formatPrice(300)}</li>
              <li>Zwrot do 30 dni</li>
            </ul>
          </form>
        </div>

        <figure class="buy__visual">
          <div class="spin-surface buy__surface" data-buy-surface tabindex="0" role="group" aria-roledescription="podgląd 3D"
            aria-label="Flakon ${esc(p.name)}, wybrana pojemność" aria-describedby="rot-help-buy">
            <div class="buy__pose" data-buy-pose>
              ${bottleMarkup(p, { variant: 'buy', alt: `Flakon ${p.name}` })}
            </div>
            <div class="buy__controls" data-buy-controls>${rotatorControlsMarkup('rot-help-buy')}</div>
          </div>
          <figcaption class="buy__caption"><span>${esc(p.name)}</span><span data-caption-size>${selected.ml} ml</span></figcaption>
        </figure>
      </div>

      <div class="grid details">
        <h2 class="label details__title">Szczegóły</h2>
        <div class="accordion" data-accordion>
          ${details
            .map(
              (d, i) => `
            <div class="acc">
              <h3 class="acc__heading">
                <button type="button" class="acc__btn" id="acc-btn-${i}" aria-controls="acc-panel-${i}" aria-expanded="false">
                  <span>${d.title}</span>${ICON_CHEVRON}
                </button>
              </h3>
              <div class="acc__panel" id="acc-panel-${i}" role="region" aria-labelledby="acc-btn-${i}" hidden>${d.body}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>
    </section>

    <section class="section surface-light" aria-labelledby="others-title">
      <div class="grid others__head">
        <h2 id="others-title" class="t-h2">Inne zapachy</h2>
        <a class="link" href="/perfumy">Wszystkie zapachy</a>
      </div>
      <div class="cards grid">
        ${otherProducts(p.slug, 3)
          .map((o) => productCardMarkup(o))
          .join('')}
      </div>
    </section>

    <div class="buybar surface-dark" data-buybar aria-hidden="true" inert>
      <div class="buybar__inner">
        <p class="buybar__id"><span class="buybar__name">${esc(p.name)}</span><span data-bar-size>${selected.ml} ml</span></p>
        <p class="buybar__price" data-bar-price>${formatPrice(selected.price)}</p>
        <button type="button" class="btn btn--primary btn--small" data-bar-add>Dodaj do koszyka</button>
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
  const cleanups: (() => void)[] = [];

  return {
    title: `${p.name}, ${p.concentration} | Perfumowa Aura`,

    mount(view) {
      view.innerHTML = template(p);
      const main = qs(view, 'main');

      const hero = mountBottle(qs(main, '.stage [data-bottle]'), p);
      const buy = mountBottle(qs(main, '.buy [data-bottle]'), p);
      labels.push(hero, buy);

      cleanups.push(mountStage(main, hero));
      cleanups.push(mountBuy(main, p, buy));
      cleanups.push(mountAccordion(qs(main, '[data-accordion]')));
      cleanups.push(mountGallery(qs(main, '[data-gallery]')));
      cleanups.push(mountProductCards(main));

      if (isDebugMode()) void attachLabelDebug(hero, p.name).then((dispose) => cleanups.push(dispose));
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },

    unmount() {
      cleanups.splice(0).forEach((fn) => fn());
      labels.splice(0).forEach((label) => label.dispose());
    },
  };
}

/** Przypięte hero: postęp scrolla wybiera warstwę zapachu i obraca etykietę. */
function mountStage(main: HTMLElement, label: BottleLabel): () => void {
  const stage = qs(main, '[data-stage]');
  const pose = qs(stage, '[data-hero-pose]');
  const items = [...stage.querySelectorAll<HTMLElement>('[data-chapter]')];
  const buttons = [...stage.querySelectorAll<HTMLButtonElement>('[data-goto]')];
  const progressFill = qs(stage, '[data-progress]');

  const state = { intro: 0, progress: chapterCenter(0), chapter: 0, user: { turn: 0, tilt: 0 } as RotatorValue };
  let trigger: ScrollTrigger | null = null;

  const render = () => {
    const { spin, pose: q } = sampleChapters(state.progress);
    label.setOffset(state.intro + spin + state.user.turn);
    gsap.set(pose, { xPercent: q.x, yPercent: q.y, scale: q.s, rotation: q.r + state.user.tilt });
    const filled = trigger ? state.progress : (state.chapter + 1) / COUNT;
    progressFill.style.transform = `scaleX(${filled})`;
  };

  const setChapter = (next: number) => {
    if (next === state.chapter) return;
    state.chapter = next;
    items.forEach((item, i) => item.classList.toggle('is-active', i === next));
    buttons.forEach((b, i) => (i === next ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  };

  const goTo = (i: number) => {
    if (trigger) {
      scrollToY(trigger.start + (trigger.end - trigger.start) * chapterCenter(i));
      return;
    }
    // Bez przypięcia (reduced motion) rozdziały działają jak zakładki.
    state.progress = chapterCenter(i);
    setChapter(i);
    render();
  };

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-goto]');
    if (button) goTo(Number(button.dataset.goto));
  };
  stage.addEventListener('click', onClick);

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
    gsap
      .timeline({ defaults: { ease: 'power3.out' } })
      .from('.stage__intro > *', { opacity: 0, y: 16, duration: 1.1, stagger: 0.07 }, 0.1)
      .from('.stage .bottle', { opacity: 0, y: 24, duration: 1.4 }, 0)
      .from('.stage__story, .stage__controls', { opacity: 0, duration: 1.2 }, 0.5);
    state.intro = -0.25;
    render();
    void label.ready.then(() => gsap.to(state, { intro: 0, duration: 2.2, ease: 'power3.out', onUpdate: render }));

    const tl = gsap.timeline({
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
          render();
        },
      },
    });
    trigger = tl.scrollTrigger ?? null;
    state.progress = trigger?.progress ?? 0;
    render();

    return () => {
      trigger = null;
      gsap.killTweensOf(state);
      state.intro = 0;
      state.progress = chapterCenter(state.chapter);
      render();
    };
  });

  render();

  return () => {
    mm.revert();
    rotator.destroy();
    stage.removeEventListener('click', onClick);
    gsap.killTweensOf(state);
  };
}

/** Wybór pojemności, ilość, suma, drugi obracany flakon i pływający pasek zakupu. */
function mountBuy(main: HTMLElement, p: Product, label: BottleLabel): () => void {
  const form = qs<HTMLFormElement>(main, '[data-buy]');
  const pose = qs(main, '[data-buy-pose]');
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
    qs(form, '[data-total]').textContent = formatPrice(size.price * state.qty);
    qs(form, '[data-qty-value]').textContent = String(state.qty);
    qs(main, '[data-caption-size]').textContent = `${size.ml} ml`;
    qs(bar, '[data-bar-size]').textContent = `${size.ml} ml`;
    qs(bar, '[data-bar-price]').textContent = formatPrice(size.price);
    const scale = sizeScale(p, size.ml);
    if (animate && !prefersReducedMotion()) gsap.to(pose, { scale, duration: 0.8, ease: 'power3.out' });
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
  const barAdd = qs(bar, '[data-bar-add]');
  const onBarAdd = () => add(1, `${p.name}, ${selected().ml} ml`);

  form.addEventListener('change', onChange);
  form.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  barAdd.addEventListener('click', onBarAdd);

  const rotator = createRotator({
    surface: qs(main, '[data-buy-surface]'),
    controls: main.querySelector<HTMLElement>('[data-buy-controls]'),
    onChange: (value) => {
      state.turn = value.turn;
      apply();
      gsap.set(pose, { rotation: value.tilt });
    },
  });

  // Pasek zakupu: po hero, chowa się przy sekcji zakupu i w stopce.
  const seen = new Map<Element, boolean>();
  const watched = [qs(main, '[data-stage]'), qs(main, '#kup'), document.querySelector('.site-footer')].filter(Boolean) as Element[];
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
      trigger: '#kup',
      start: 'top 70%',
      once: true,
      onEnter: () => {
        state.intro = -0.3;
        apply();
        gsap.to(state, { intro: 0, duration: 2, ease: 'power3.out', onUpdate: apply });
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
    barAdd.removeEventListener('click', onBarAdd);
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
