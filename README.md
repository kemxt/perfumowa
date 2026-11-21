# Perfumowa Aura

Sklep z perfumami (Vite + TypeScript) i panel admina na jednym Workerze Cloudflare.

| Ścieżka        | Co to                                                        |
| -------------- | ------------------------------------------------------------ |
| `src/`         | strona sklepu                                                |
| `src/admin/`   | panel admina pod `/admin/` (zamówienia, produkty, ceny, pojemności, kategorie, zdjęcia, opisy) |
| `worker/`      | Worker: `/api/catalog`, `/api/checkout`, `/api/admin/*`, `/media/*`, webhook `/admin/completed` |
| `shared/`      | typy API wspólne dla Workera, sklepu i panelu                |
| `migrations/`  | schemat bazy D1 i dane startowe (seed)                       |

Dane produktów są w **D1** (baza `perfumowa`), a zdjęcia wgrane w panelu w **Workers KV**
(`perfumowa-media`). Pliki w `public/assets/` (zdjęcia startowe, flakony, etykiety) nadal są w repo.
`src/data/products.json` służy już tylko do seeda (`npm run db:seed-sql`) i generatora placeholderów.

## Lokalnie

```sh
cp .dev.vars.example .dev.vars    # hasło do panelu (ADMIN_PASSWORD)
npm run db:migrate:local          # lokalna baza D1 ze schematem i 6 zapachami
npm run dev                       # Worker (:8787) + Vite (:5173)
```

- sklep: http://localhost:5173/
- panel: http://localhost:5173/admin/

Lokalna baza i pliki leżą w `.wrangler/state` (poza gitem).

## Wdrożenie

Konto Cloudflare „Tomex9989@gmail.com's Account”: baza D1 `perfumowa` (WEUR) i KV `perfumowa-media`,
wspólne dla obu Workerów – dane wpisane w wersji testowej są od razu danymi sklepu.

| Worker           | Adres                                        | Wdrożenie             |
| ---------------- | -------------------------------------------- | --------------------- |
| `perfumowa-test` | https://perfumowa-test.tomex9989.workers.dev | `npm run deploy:test` |
| `perfumowa`      | https://perfumowaaura.com (domena w panelu CF) | `npm run deploy`      |

Przy pierwszym `npm run deploy` Worker `perfumowa` potrzebuje też hasła:
`npx wrangler secret put ADMIN_PASSWORD` (każdy Worker ma własne).

## Płatności (Stripe)

Kasa to **Stripe Checkout**: koszyk wysyła pozycje na `POST /api/checkout`, Worker liczy ceny
z bazy, zapisuje zamówienie (`pending`) i przekierowuje klienta do kasy Stripe. Tam klient
podaje adres, wybiera dostawę (sposoby i ceny z Ustawień, darmowa dostawa też) i płaci.
Po płatności wraca na `/kasa/dziekujemy`, a Stripe wysyła webhook na `/admin/completed` –
zamówienie dostaje status „Do wysłania” i pojawia się w panelu w zakładce **Zamówienia**.

Sekrety Workera `perfumowa` (nie trafiają do repo):

```sh
npx wrangler secret put STRIPE_SECRET_KEY       # sk_live_… albo ograniczony rk_live_…
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_… z panelu Stripe (Webhooks)
```

W panelu Stripe:

- **Webhook** `https://perfumowaaura.com/admin/completed`, zdarzenia: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`.
- **Klucz ograniczony (rk_…)** potrzebuje zapisu dla *Checkout Sessions* oraz – bo produkty
  i stawki dostawy powstają w locie – dla *Products*, *Prices* i *Shipping rates*. Gdy czegoś
  brakuje, kasa pokazuje „Nie udało się połączyć z systemem płatności”, a dokładny komunikat
  Stripe jest w logach Workera (Cloudflare → Workers → perfumowa → Logs).
- **Metody płatności** (BLIK, karta, Przelewy24, Google Pay, Apple Pay): Settings → Payment methods.
- **Potwierdzenia e-mail** dla klientów: Settings → Customer emails → Successful payments.
- **Zwroty pieniędzy** robisz w Stripe przy płatności, potem w panelu sklepu status „Anulowane”.

Lokalnie i na `perfumowa-test` używaj kluczy testowych (`sk_test_…`, karta 4242 4242 4242 4242);
bez klucza kasa pokazuje „Płatności nie są jeszcze włączone”. Webhooki Stripe docierają tylko
na produkcję – lokalnie status ustawia strona podziękowania, która sama pyta Stripe o sesję.

## Pierwsze wdrożenie na nowym koncie (jednorazowo)

Na koncie Cloudflare, na którym ma stać Worker `perfumowa`:

```sh
npx wrangler login
npx wrangler d1 create perfumowa             # baza (wrangler znajdzie ją po nazwie)
npx wrangler kv namespace create perfumowa-media   # ID wpisz w wrangler.jsonc (kv_namespaces)
npm run db:migrate:remote                    # schemat + seed
npx wrangler secret put ADMIN_PASSWORD       # hasło do panelu, min. 8 znaków
```

Potem `npm run deploy`. Baza musi powstać **przed** deployem –
inaczej sklep przez chwilę działałby na pustej bazie.

## Na co dzień

- **Zamówienia**: domyślnie opłacone; „Do wysłania” → wpisz numer przesyłki i ustaw „Wysłane”.
  Nieopłacone i porzucone kasy są w filtrze „Nieopłacone i porzucone”.
- Produkty, strony i ustawienia edytujesz w panelu: zapisane zmiany widać w sklepie od razu.
- **Katalog** (`/perfumy`): zakładki z kategorii (Damskie, Męskie, Unisex) i Nowości, filtr pory
  roku, wyszukiwanie po nazwie i nutach. Pora roku, „Nowość” i dostępność pojemności ustawiasz
  w edytorze produktu.
- **Ustawienia**: kontakt, godziny obsługi, dane firmy, sposoby i koszty dostawy (najwyżej 5 – tyle
  pokazuje kasa Stripe; nazwa z „paczkomat” dodaje w kasie pole na kod paczkomatu), darmowa dostawa,
  czas realizacji, śledzenie przesyłki, metody płatności, dni na zwrot.
- **Strony**: Kontakt, Dostawa i płatności (część z ustawień + własny tekst) oraz dokumenty:
  regulamin, polityka prywatności, cookies, zwroty, reklamacje, formularz odstąpienia. Treść to
  prosty Markdown; pola `{{firma}}`, `{{adres}}`, `{{nip}}`, `{{email}}`… wypełniają się z Ustawień.
  Opublikowane strony trafiają do stopki.
  Szkic nie trafia do sklepu. Publikacja wymaga ceny i zdjęcia flakonu.
- Zdjęcia: panel sam robi warianty 600 i 1200 px w WebP przed wysłaniem.
- Hasło: `npx wrangler secret put ADMIN_PASSWORD` (zmiana wylogowuje wszystkie sesje).
- Zmiana schematu: nowy plik `migrations/000N_opis.sql`, potem `npm run db:migrate:remote`
  **przed** pushem. `npm run deploy` robi to sam.
- Po zmianie `wrangler.jsonc`: `npm run cf:types`.
