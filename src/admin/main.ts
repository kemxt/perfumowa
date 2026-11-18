import './admin.css';
import { RequestError, api, setUnauthorizedHandler } from './api';
import { categoriesView } from './categories';
import { pageEditorView, pagesListView } from './pages';
import { productEditorView, productListView } from './products';
import { settingsView } from './settings';
import { esc, toast, type View } from './ui';

/** Panel admina: hash routing (#/produkty, #/produkty/12, #/kategorie, #/strony, #/ustawienia), sesja w ciasteczku. */

const root = document.getElementById('admin');
if (!root) throw new Error('Brak #admin');

root.innerHTML = `
  <header class="topbar">
    <a class="topbar__brand" href="#/produkty">Aura <span>panel</span></a>
    <nav class="topbar__nav" aria-label="Sekcje panelu">
      <a href="#/produkty" data-nav="produkty">Produkty</a>
      <a href="#/kategorie" data-nav="kategorie">Kategorie</a>
      <a href="#/strony" data-nav="strony">Strony</a>
      <a href="#/ustawienia" data-nav="ustawienia">Ustawienia</a>
    </nav>
    <div class="topbar__actions">
      <a href="/" target="_blank" rel="noopener">Zobacz sklep <span aria-hidden="true">↗</span></a>
      <button type="button" class="link-btn" data-logout>Wyloguj</button>
    </div>
  </header>
  <main class="page" id="view" tabindex="-1"></main>
  <dialog class="login" data-login aria-labelledby="login-title">
    <form method="dialog" class="login__form" data-login-form>
      <p class="topbar__brand">Aura <span>panel</span></p>
      <h1 id="login-title" class="login__title">Zaloguj się</h1>
      <div class="field">
        <label for="login-password">Hasło</label>
        <input id="login-password" type="password" name="password" autocomplete="current-password" required />
      </div>
      <p class="field__error" data-login-error role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">Zaloguj</button>
    </form>
  </dialog>`;

const viewEl = root.querySelector<HTMLElement>('#view')!;
const dialog = root.querySelector<HTMLDialogElement>('[data-login]')!;
const loginForm = root.querySelector<HTMLFormElement>('[data-login-form]')!;
const loginError = root.querySelector<HTMLElement>('[data-login-error]')!;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

let current: View | null = null;
let currentHash = '';
let started = false;
let token = 0;

function resolve(hash: string): View {
  const path = hash.replace(/^#\/?/, '');
  const product = path.match(/^produkty\/(nowy|\d+)$/);
  if (product) return productEditorView(product[1] === 'nowy' ? null : Number(product[1]));
  if (path === 'kategorie') return categoriesView();
  const page = path.match(/^strony\/(nowa|\d+)$/);
  if (page) return pageEditorView(page[1] === 'nowa' ? null : Number(page[1]));
  if (path === 'strony') return pagesListView();
  if (path === 'ustawienia') return settingsView();
  return productListView();
}

async function render(): Promise<void> {
  const hash = location.hash || '#/produkty';
  if (current?.canLeave && !current.canLeave() && !confirm('Masz niezapisane zmiany. Wyjść bez zapisywania?')) {
    history.replaceState(null, '', currentHash);
    return;
  }
  currentHash = hash;
  current?.unmount?.();
  const view = resolve(hash);
  current = view;
  const mine = ++token;

  // Każdy widok dostaje świeży kontener – jego listenery znikają razem z nim.
  const container = document.createElement('div');
  viewEl.replaceChildren(container);
  document.title = `${view.title} · Panel · Perfumowa Aura`;
  const section = hash.replace(/^#\/?/, '').split('/')[0] || 'produkty';
  root!.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  try {
    await view.mount(container);
  } catch (error) {
    if (mine !== token) return;
    const message = error instanceof Error ? error.message : String(error);
    container.innerHTML = `<div class="empty"><p>Nie udało się wczytać widoku.</p><p class="muted">${esc(message)}</p></div>`;
  }
}

function start(): void {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => void render());
  window.addEventListener('beforeunload', (event) => {
    if (current?.canLeave && !current.canLeave()) event.preventDefault();
  });
  void render();
}

// ---------------------------------------------------------------------------
// Logowanie
// ---------------------------------------------------------------------------

function showLogin(): void {
  if (dialog.open) return;
  loginError.textContent = '';
  loginForm.reset();
  dialog.showModal();
}

// Okna logowania nie da się zamknąć Escape'em.
dialog.addEventListener('cancel', (event) => event.preventDefault());

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button')!;
  button.disabled = true;
  loginError.textContent = '';
  try {
    await api('POST', 'login', { password: new FormData(loginForm).get('password') });
    dialog.close();
    if (started) toast('Zalogowano. Możesz kontynuować.');
    else start();
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : 'Nie udało się zalogować.';
  } finally {
    button.disabled = false;
  }
});

root.querySelector('[data-logout]')!.addEventListener('click', async () => {
  if (current?.canLeave && !current.canLeave() && !confirm('Masz niezapisane zmiany. Wylogować bez zapisywania?')) return;
  await api('POST', 'logout').catch(() => {});
  location.reload();
});

setUnauthorizedHandler(showLogin);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  await api('GET', 'session');
  start();
} catch (error) {
  if (error instanceof RequestError && error.status === 401) {
    showLogin();
  } else {
    viewEl.innerHTML = `<div class="empty"><h1 class="page-title">Panel niedostępny</h1><p>${esc(error instanceof Error ? error.message : String(error))}</p></div>`;
  }
}
