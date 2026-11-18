-- Katalog wg klienta: kategorie damskie / męskie / unisex, pory roku, nowości, dostępność
-- pojemności; strony informacyjne (kontakt, dostawa, dokumenty prawne) i ustawienia sklepu.

ALTER TABLE products ADD COLUMN seasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN is_new INTEGER NOT NULL DEFAULT 0;
-- 'available' | 'low' | 'unavailable'
ALTER TABLE product_sizes ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';

-- Pory roku z dotychczasowego pola tekstowego (specs.season, np. „wiosna · lato”).
UPDATE products SET seasons = (
  SELECT json_group_array(s) FROM (
    SELECT 'wiosna' AS s WHERE instr(lower(json_extract(products.specs, '$.season')), 'wiosna') > 0
    UNION ALL SELECT 'lato' WHERE instr(lower(json_extract(products.specs, '$.season')), 'lato') > 0
    UNION ALL SELECT 'jesien' WHERE instr(lower(json_extract(products.specs, '$.season')), 'jesie') > 0
    UNION ALL SELECT 'zima' WHERE instr(lower(json_extract(products.specs, '$.season')), 'zima') > 0
  )
)
WHERE json_valid(specs);

UPDATE products SET is_new = 1 WHERE year >= 2025;

-- Kategorie startowe (grupy zapachowe) zastępujemy podziałem z katalogu klienta.
INSERT INTO categories (slug, name, description, position) VALUES
  ('damskie', 'Damskie', 'Perfumy damskie – kwiatowe, pudrowe i otulające kompozycje.', 0),
  ('meskie', 'Męskie', 'Perfumy męskie – drzewne, aromatyczne i mineralne kompozycje.', 1),
  ('unisex', 'Unisex', 'Perfumy unisex – zapachy dla każdego, bez podziału na płeć.', 2);

UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'damskie') WHERE slug IN ('bialy-bez', 'bursztynowa-noc');
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'meskie') WHERE slug IN ('sol-i-jalowiec', 'kadzidlo-i-deszcz');
UPDATE products SET category_id = (SELECT id FROM categories WHERE slug = 'unisex') WHERE slug IN ('figowy-sad', 'gorzka-pomarancza');

UPDATE products SET category_id = NULL
WHERE category_id IN (SELECT id FROM categories WHERE slug IN ('zielone-i-aromatyczne', 'kwiatowe-i-cytrusowe', 'orientalne-i-drzewne'));
DELETE FROM categories WHERE slug IN ('zielone-i-aromatyczne', 'kwiatowe-i-cytrusowe', 'orientalne-i-drzewne');

-- Strony informacyjne. Treść: prosty Markdown z polami {{firma}}, {{email}}… (shared/content.ts).
-- system = 1: strona wbudowana (bez usuwania i zmiany adresu). Dokumenty prawne startują jako
-- szkice do uzupełnienia i weryfikacji.
CREATE TABLE pages (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 0,
  system      INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ustawienia sklepu jako jeden dokument JSON (klucz 'shop').
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES ('shop', '{"company":{"name":"","address":"","nip":"","regon":""},"contact":{"email":"","phone":"","hours":"Poniedziałek–piątek: 9:00–17:00"},"shipping":{"methods":[{"name":"Paczkomat InPost","price":13.99,"time":"1–2 dni robocze"},{"name":"Kurier InPost","price":16.99,"time":"1–2 dni robocze"}],"freeFrom":300,"processingTime":"1–2 dni robocze","tracking":"Po nadaniu paczki wyślemy Ci e-mail z numerem przesyłki i linkiem do śledzenia jej u przewoźnika."},"payments":{"methods":["BLIK","Karta płatnicza","Szybki przelew online","Przelew tradycyjny"],"note":""},"returns":{"days":30}}');

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('kontakt', 'Kontakt', '', 1, 1, 0);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('dostawa-i-platnosci', 'Dostawa i płatności', '', 1, 1, 1);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('regulamin', 'Regulamin sklepu', '## §1. Postanowienia ogólne

1. Sklep internetowy dostępny pod adresem {{strona}} (dalej: Sklep) prowadzi {{firma}}, {{adres}}, NIP {{nip}}, REGON {{regon}} (dalej: Sprzedawca).
2. Kontakt ze Sprzedawcą: e-mail {{email}}, telefon {{telefon}} (w godzinach: {{godziny}}), adres korespondencyjny: {{adres}}.
3. Regulamin określa zasady korzystania ze Sklepu, składania zamówień, zawierania umów sprzedaży, płatności, dostawy, odstąpienia od umowy i składania reklamacji.
4. Regulamin jest udostępniany nieodpłatnie na stronie Sklepu w formie, która umożliwia jego pobranie, utrwalenie i wydrukowanie.

## §2. Definicje

- **Klient** – osoba fizyczna, osoba prawna lub jednostka organizacyjna, która korzysta ze Sklepu.
- **Konsument** – Klient będący osobą fizyczną, który zawiera ze Sprzedawcą umowę niezwiązaną bezpośrednio z jego działalnością gospodarczą lub zawodową.
- **Przedsiębiorca na prawach konsumenta** – osoba fizyczna zawierająca umowę bezpośrednio związaną z jej działalnością gospodarczą, gdy z treści umowy wynika, że nie ma ona dla niej charakteru zawodowego (w szczególności z przedmiotu działalności wpisanego do CEIDG). Przysługują jej uprawnienia Konsumenta opisane w §7–§8.
- **Produkt** – perfumy i inne towary prezentowane w Sklepie.
- **Zamówienie** – oświadczenie woli Klienta zmierzające do zawarcia umowy sprzedaży.

## §3. Wymagania techniczne

Do korzystania ze Sklepu potrzebne są: urządzenie z dostępem do internetu, aktualna przeglądarka internetowa z włączoną obsługą JavaScript oraz aktywny adres e-mail.

## §4. Składanie zamówień i zawarcie umowy

1. Zamówienia można składać przez całą dobę, 7 dni w tygodniu.
2. Aby złożyć zamówienie, Klient wybiera Produkt i pojemność, dodaje go do koszyka, podaje dane do dostawy, wybiera sposób dostawy i płatności, a następnie potwierdza zamówienie przyciskiem oznaczonym słowami „Zamawiam z obowiązkiem zapłaty” lub równoważnymi.
3. Po złożeniu zamówienia Klient otrzymuje e-mail z potwierdzeniem jego przyjęcia. Z tą chwilą zostaje zawarta umowa sprzedaży.
4. Ceny w Sklepie są cenami brutto w złotych polskich i zawierają podatek VAT. Koszt dostawy jest podawany przed złożeniem zamówienia i doliczany do ceny.
5. Przy każdej obniżce ceny Sprzedawca podaje także najniższą cenę Produktu z 30 dni przed wprowadzeniem obniżki.
6. Sprzedawca może odmówić realizacji zamówienia, jeżeli Klient poda nieprawdziwe lub niepełne dane uniemożliwiające jego realizację. W takim przypadku poinformuje o tym Klienta i zwróci otrzymane płatności.

## §5. Płatności

1. Dostępne metody płatności są opisane na stronie [Dostawa i płatności](/dostawa-i-platnosci).
2. Przy płatności przelewem tradycyjnym Klient powinien zapłacić w ciągu 3 dni roboczych od złożenia zamówienia. Po bezskutecznym upływie tego terminu zamówienie może zostać anulowane.
3. Do każdego zamówienia Sprzedawca wystawia paragon lub – na życzenie Klienta – fakturę.

## §6. Dostawa

1. Sprzedawca dostarcza Produkty na terytorium Polski.
2. Czas realizacji zamówienia (do przekazania przesyłki przewoźnikowi) wynosi {{czas_realizacji}} od zaksięgowania płatności, a przy płatności przy odbiorze – od złożenia zamówienia.
3. Sposoby i koszty dostawy oraz przewidywany czas doręczenia są opisane na stronie [Dostawa i płatności](/dostawa-i-platnosci).

## §7. Prawo odstąpienia od umowy

1. Konsument może odstąpić od umowy bez podawania przyczyny w terminie 14 dni od otrzymania Produktu. Sprzedawca wydłuża ten termin do {{dni_na_zwrot}} dni.
2. Aby odstąpić od umowy, wystarczy wysłać przed upływem terminu oświadczenie, np. e-mailem na adres {{email}}. Można skorzystać z [formularza odstąpienia od umowy](/odstapienie-od-umowy), ale nie jest to obowiązkowe.
3. Konsument odsyła Produkt na adres {{adres}} w ciągu 14 dni od złożenia oświadczenia. Bezpośredni koszt odesłania ponosi Konsument.
4. Sprzedawca zwraca wszystkie otrzymane płatności, w tym najtańszy zwykły koszt dostawy, w ciągu 14 dni od otrzymania oświadczenia, tą samą metodą płatności, chyba że Konsument zgodzi się na inną (bez dodatkowych kosztów). Sprzedawca może wstrzymać zwrot do chwili otrzymania Produktu lub dowodu jego odesłania.
5. Konsument odpowiada za zmniejszenie wartości Produktu wynikające z korzystania z niego w sposób wykraczający poza konieczny do stwierdzenia jego charakteru, cech i funkcjonowania.
6. Prawo odstąpienia nie przysługuje w przypadku Produktów dostarczanych w zapieczętowanym opakowaniu, których po otwarciu nie można zwrócić ze względu na ochronę zdrowia lub ze względów higienicznych, jeżeli opakowanie zostało otwarte po dostarczeniu (art. 38 ust. 1 pkt 5 ustawy o prawach konsumenta). Dotyczy to flakonów z naruszoną folią lub plombą.
7. Szczegóły: [Polityka zwrotów](/zwroty).

## §8. Reklamacje

1. Sprzedawca odpowiada wobec Konsumenta za zgodność Produktu z umową istniejącą w chwili jego dostarczenia i ujawnioną w ciągu dwóch lat od tej chwili.
2. Reklamację można złożyć e-mailem na adres {{email}} lub pisemnie na adres {{adres}}. Warto podać: imię i nazwisko, dane kontaktowe, numer zamówienia, opis niezgodności i żądanie (naprawa, wymiana, obniżenie ceny lub odstąpienie od umowy).
3. Sprzedawca odpowiada na reklamację w ciągu 14 dni od jej otrzymania.
4. Szczegóły: [Polityka reklamacji](/reklamacje).

## §9. Pozasądowe sposoby rozpatrywania sporów

Konsument może skorzystać z pomocy miejskiego lub powiatowego rzecznika konsumentów, organizacji konsumenckich (np. Federacji Konsumentów) albo wystąpić do wojewódzkiego inspektora Inspekcji Handlowej z wnioskiem o mediację lub do stałego polubownego sądu konsumenckiego. Informacje: [prawakonsumenta.uokik.gov.pl](https://prawakonsumenta.uokik.gov.pl). Skorzystanie z tych sposobów jest dobrowolne.

## §10. Dane osobowe

Zasady przetwarzania danych osobowych opisuje [Polityka prywatności](/polityka-prywatnosci).

## §11. Postanowienia końcowe

1. Umowy są zawierane w języku polskim i podlegają prawu polskiemu. Regulamin nie wyłącza ani nie ogranicza praw Konsumenta wynikających z przepisów bezwzględnie obowiązujących.
2. Sprzedawca może zmienić Regulamin z ważnych przyczyn (np. zmiana przepisów, metod płatności lub dostawy). Do zamówień złożonych przed zmianą stosuje się Regulamin w dotychczasowym brzmieniu.
3. Regulamin obowiązuje od [data wejścia w życie].', 0, 1, 2);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('polityka-prywatnosci', 'Polityka prywatności', '## Administrator danych

Administratorem Twoich danych osobowych jest {{firma}}, {{adres}}, NIP {{nip}}. W sprawach danych osobowych napisz na {{email}}.

## Jakie dane i w jakim celu przetwarzamy

- **Realizacja zamówienia** (imię i nazwisko, adres dostawy, e-mail, telefon, dane do faktury) – na podstawie umowy (art. 6 ust. 1 lit. b RODO).
- **Rozliczenia i księgowość** (dane z dokumentów sprzedaży) – w celu wykonania obowiązków prawnych, np. podatkowych (art. 6 ust. 1 lit. c RODO).
- **Zwroty i reklamacje** – w celu wykonania umowy i obowiązków wynikających z ustawy o prawach konsumenta (art. 6 ust. 1 lit. b i c RODO).
- **Odpowiedzi na wiadomości** wysłane e-mailem lub telefonicznie – w naszym prawnie uzasadnionym interesie, jakim jest kontakt z Tobą (art. 6 ust. 1 lit. f RODO).
- **Ustalenie, dochodzenie lub obrona roszczeń** – w naszym prawnie uzasadnionym interesie (art. 6 ust. 1 lit. f RODO).

Podanie danych jest dobrowolne, ale bez danych potrzebnych do realizacji zamówienia nie możemy go wysłać.

## Komu przekazujemy dane

Twoje dane mogą otrzymać wyłącznie podmioty, które pomagają nam prowadzić sklep:

- firmy kurierskie i operator paczkomatów – w zakresie potrzebnym do doręczenia przesyłki,
- operator płatności – w zakresie potrzebnym do obsługi płatności,
- dostawca hostingu i infrastruktury strony (Cloudflare, Inc.),
- biuro rachunkowe oraz dostawca poczty e-mail.

Cloudflare może przetwarzać dane poza Europejskim Obszarem Gospodarczym (w USA). Odbywa się to na podstawie decyzji Komisji Europejskiej w sprawie ram ochrony danych UE–USA (Data Privacy Framework) oraz standardowych klauzul umownych.

Strona pobiera czcionki z serwerów Google (Google Fonts). Przy wczytywaniu strony Twoja przeglądarka przekazuje Google adres IP.

## Jak długo przechowujemy dane

- dane związane z zamówieniem – przez czas jego realizacji, a dokumenty księgowe przez 5 lat od końca roku podatkowego,
- dane potrzebne do obrony roszczeń – do upływu terminu ich przedawnienia,
- korespondencję – do czasu zakończenia sprawy, nie dłużej niż 2 lata.

## Twoje prawa

Masz prawo do dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia danych oraz sprzeciwu wobec przetwarzania opartego na prawnie uzasadnionym interesie. Jeśli przetwarzanie opiera się na zgodzie, możesz ją w każdej chwili wycofać – nie wpływa to na zgodność z prawem wcześniejszego przetwarzania.

Masz też prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).

Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, w tym profilowania.

## Pliki cookies

Informacje o plikach cookies i podobnych technologiach znajdziesz w [Polityce cookies](/polityka-cookies).', 0, 1, 3);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('polityka-cookies', 'Polityka cookies', '## Czym są pliki cookies

Pliki cookies to niewielkie pliki tekstowe zapisywane w przeglądarce przy odwiedzaniu stron internetowych. Podobnie działa pamięć przeglądarki (localStorage i sessionStorage).

## Czego używa ten sklep

- **Koszyk** – zawartość koszyka zapisujemy w pamięci sesji przeglądarki (sessionStorage). Dane nie trafiają na nasz serwer i znikają po zamknięciu karty.
- **Panel administracyjny** – techniczne ciasteczko logowania dotyczy wyłącznie pracowników sklepu i nie jest ustawiane klientom.

Sklep nie używa obecnie plików cookies analitycznych ani reklamowych. Wykorzystujemy wyłącznie rozwiązania niezbędne do działania strony, które – zgodnie z art. 399 ustawy Prawo komunikacji elektronicznej – nie wymagają Twojej zgody.

Jeżeli w przyszłości dodamy narzędzia analityczne lub reklamowe, przed ich uruchomieniem poprosimy Cię o zgodę i zaktualizujemy tę politykę.

## Usługi zewnętrzne

Strona wczytuje czcionki z serwerów Google (Google Fonts). Google nie zapisuje przy tym plików cookies, ale otrzymuje adres IP Twojej przeglądarki.

## Jak zarządzać cookies

Możesz w każdej chwili usunąć zapisane dane lub zablokować pliki cookies w ustawieniach swojej przeglądarki. Zablokowanie pamięci przeglądarki może sprawić, że koszyk nie zachowa produktów po odświeżeniu strony.

## Kontakt

Pytania dotyczące plików cookies prosimy kierować na adres {{email}}.', 0, 1, 4);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('zwroty', 'Zwroty', '## {{dni_na_zwrot}} dni na zwrot

Zamówione perfumy możesz zwrócić bez podawania przyczyny w ciągu {{dni_na_zwrot}} dni od dnia, w którym otrzymałeś przesyłkę. Ustawowy termin to 14 dni – wydłużyliśmy go dla wygody klientów.

Prawo to przysługuje konsumentom oraz przedsiębiorcom na prawach konsumenta (osobom fizycznym prowadzącym działalność, dla których zakup nie ma charakteru zawodowego).

## Jak zwrócić produkt

1. Przed upływem terminu wyślij nam oświadczenie o odstąpieniu od umowy – wystarczy e-mail na adres {{email}}. Możesz skorzystać z [formularza odstąpienia od umowy](/odstapienie-od-umowy), ale nie musisz.
2. Odeślij produkt na adres: {{adres}} – najpóźniej w ciągu 14 dni od wysłania oświadczenia. Dołącz numer zamówienia.
3. Zwrócimy Ci pieniądze w ciągu 14 dni od otrzymania oświadczenia.

## Zwrot pieniędzy

- Zwracamy cenę produktu oraz koszt dostawy do Ciebie – do wysokości najtańszej oferowanej przez nas formy dostawy.
- Pieniądze wracają tą samą metodą, którą zapłaciłeś, chyba że wyraźnie zgodzisz się na inną. Nie ponosisz z tego tytułu żadnych opłat.
- Możemy wstrzymać zwrot do chwili otrzymania produktu lub dowodu jego odesłania – w zależności od tego, co nastąpi wcześniej.
- Koszt odesłania produktu do nas ponosisz Ty.

## Kiedy zwrot nie jest możliwy

Perfumy są produktem higienicznym. Prawo odstąpienia od umowy nie przysługuje, jeśli flakon dostarczony w zapieczętowanym opakowaniu (z folią lub plombą) został otwarty po dostarczeniu (art. 38 ust. 1 pkt 5 ustawy o prawach konsumenta).

Za zmniejszenie wartości produktu wynikające z korzystania z niego w sposób wykraczający poza konieczny do sprawdzenia jego charakteru i cech odpowiadasz Ty.

## Pytania

Napisz do nas: {{email}} lub zadzwoń: {{telefon}} ({{godziny}}).', 0, 1, 5);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('reklamacje', 'Reklamacje', '## Nasza odpowiedzialność

Odpowiadamy za zgodność produktu z umową, jeśli niezgodność istniała w chwili dostarczenia i ujawniła się w ciągu dwóch lat od tej chwili. Zasady te wynikają z ustawy o prawach konsumenta i dotyczą konsumentów oraz przedsiębiorców na prawach konsumenta.

Przykłady niezgodności: uszkodzony atomizer, nieszczelny lub pęknięty flakon, inny zapach lub pojemność niż zamówione.

## Jak złożyć reklamację

Napisz na adres {{email}} albo wyślij list na adres {{adres}}. Podaj:

- imię, nazwisko i dane kontaktowe,
- numer zamówienia lub datę zakupu,
- opis niezgodności (najlepiej ze zdjęciem),
- czego oczekujesz: naprawy, wymiany, obniżenia ceny albo odstąpienia od umowy.

## Ile to trwa

Odpowiemy w ciągu 14 dni od otrzymania reklamacji. Jeśli w tym czasie się nie odezwiemy, reklamację uważa się za uznaną.

## Twoje uprawnienia

1. W pierwszej kolejności możesz żądać naprawy lub wymiany produktu. Możemy wybrać inny z tych sposobów, jeśli wybrany przez Ciebie jest niemożliwy albo wymagałby nadmiernych kosztów.
2. Możesz żądać obniżenia ceny albo odstąpić od umowy, jeśli naprawa lub wymiana jest niemożliwa, nie doprowadziła do zgodności produktu z umową, niezgodność jest istotna albo jasno odmówiliśmy jej usunięcia. Od umowy nie można odstąpić, gdy niezgodność jest nieistotna.
3. Koszty naprawy, wymiany i odesłania reklamowanego produktu ponosimy my.

## Uszkodzona przesyłka

Jeśli paczka dotrze uszkodzona, najlepiej sprawdź ją przy kurierze i poproś o protokół szkody. Ułatwi to rozpatrzenie sprawy, ale nie jest warunkiem złożenia reklamacji.

## Pozasądowe rozwiązywanie sporów

Możesz skorzystać z pomocy miejskiego lub powiatowego rzecznika konsumentów albo wojewódzkiego inspektoratu Inspekcji Handlowej. Więcej informacji: [prawakonsumenta.uokik.gov.pl](https://prawakonsumenta.uokik.gov.pl).', 0, 1, 6);

INSERT INTO pages (slug, title, body, published, system, position) VALUES ('odstapienie-od-umowy', 'Formularz odstąpienia od umowy', 'Wzór formularza odstąpienia od umowy (załącznik nr 2 do ustawy z dnia 30 maja 2014 r. o prawach konsumenta). Formularz należy wypełnić i odesłać tylko w przypadku chęci odstąpienia od umowy. Możesz go wydrukować albo przepisać treść do e-maila na adres {{email}}.

---

**Adresat:**
{{firma}}
{{adres}}
e-mail: {{email}}

Ja/My(*) niniejszym informuję/informujemy(*) o moim/naszym(*) odstąpieniu od umowy sprzedaży następujących rzeczy:

……………………………………………………………………………………………

Numer zamówienia: ……………………………………

Data zawarcia umowy(*) / odbioru(*): ……………………………………

Imię i nazwisko konsumenta(-ów): ……………………………………

Adres konsumenta(-ów): ……………………………………

Numer konta do zwrotu płatności (opcjonalnie, jeśli zgadzasz się na zwrot przelewem): ……………………………………

Podpis konsumenta(-ów) (tylko jeżeli formularz jest przesyłany w wersji papierowej): ……………………………………

Data: ……………………

(*) Niepotrzebne skreślić.

---

Więcej informacji: [Polityka zwrotów](/zwroty).', 0, 1, 7);
