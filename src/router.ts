import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { setHeader } from './components/header';
import { scrollToElement, scrollToTop } from './lib/smooth-scroll';

export interface Page {
  title: string;
  /** Renderuje stronę do kontenera widoku. */
  mount(view: HTMLElement): void | Promise<void>;
  /** Sprząta: ScrollTriggery, WebGL, listenery. */
  unmount(): void;
}

export interface Route {
  path: RegExp;
  page: (params: string[]) => Page;
}

const HEADER_OFFSET = -96;

export class Router {
  private current: Page | null = null;
  private token = 0;

  constructor(
    private readonly view: HTMLElement,
    private readonly routes: Route[],
    private readonly fallback: () => Page,
  ) {}

  start(): void {
    document.addEventListener('click', this.onClick);
    window.addEventListener('popstate', () => void this.render(window.location.pathname, false));
    void this.render(window.location.pathname, true);
  }

  navigate(href: string): void {
    const url = new URL(href, window.location.href);
    // Tryb kalibracji przechodzi między stronami, żeby można było stroić kolejne produkty.
    let search = url.search;
    if (new URLSearchParams(window.location.search).has('debug') && !url.searchParams.has('debug')) {
      search = search ? `${search}&debug` : '?debug';
    }
    history.pushState(null, '', `${url.pathname}${search}${url.hash}`);
    void this.render(url.pathname, false);
  }

  private readonly onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest('a');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download') || link.dataset.external !== undefined) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;

    // Kotwica na bieżącej stronie: płynny scroll + fokus (np. skip link).
    if (url.pathname === window.location.pathname && url.hash) {
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      scrollToElement(target, HEADER_OFFSET);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      return;
    }

    event.preventDefault();
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    this.navigate(url.href);
  };

  private resolve(pathname: string): Page {
    for (const route of this.routes) {
      const match = pathname.match(route.path);
      if (match) return route.page(match.slice(1).map(decodeURIComponent));
    }
    return this.fallback();
  }

  private async render(pathname: string, initial: boolean): Promise<void> {
    const token = ++this.token;
    this.current?.unmount();
    this.current = null;
    this.view.replaceChildren();
    scrollToTop();

    const page = this.resolve(pathname);
    this.current = page;
    document.title = page.title;
    setHeader();
    await page.mount(this.view);
    if (token !== this.token) return;

    ScrollTrigger.refresh();
    this.updateNav(pathname);
    if (!initial) this.view.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }

  private updateNav(pathname: string): void {
    document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
      if (a.getAttribute('href')?.startsWith('#')) return;
      const path = new URL(a.href).pathname;
      const active = path === '/' ? pathname === '/' : pathname.startsWith(path);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
}
