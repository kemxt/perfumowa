import './styles/main.css';
import { productUrl, products } from './data/products';
import { initSmoothScroll } from './lib/smooth-scroll';
import { notFoundPage } from './pages/not-found';
import { productPage } from './pages/product';
import { stubPage } from './pages/stub';
import { Router } from './router';

initSmoothScroll();

const view = document.getElementById('view');
if (!view) throw new Error('Brak #view w index.html');

new Router(
  view,
  [
    { path: /^\/perfumy\/([a-z0-9-]+)\/?$/, page: ([slug]) => productPage(slug) },
    // Etap 1: bez strony głównej – start od pierwszego zapachu. Do podmiany w etapie 2.
    { path: /^\/$/, page: () => productUrl(products[0]) },
    { path: /^\/perfumy\/?$/, page: () => stubPage() },
  ],
  notFoundPage,
).start();

