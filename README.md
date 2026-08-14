# NDK – předčítání OCR textu

Userscript pro hlasité předčítání digitalizovaných dokumentů z **Národní digitální knihovny (NDK)**. Skript využívá OCR text, který je již uložen u naskenovaných stránek v systému Kramerius, a předává jej systémovému převodu textu na řeč (TTS).

## K čemu skript slouží

Řada dokumentů v NDK je dostupná pouze jako naskenované stránky. NDK však u digitalizovaných dokumentů často obsahuje také OCR přepis, díky kterému lze v dokumentech textově vyhledávat.

Skript tento OCR text získá přímo z NDK a nechá jej přečíst hlasovým syntetizátorem prohlížeče.

Výhodou je, že:

- není nutné provádět vlastní OCR,
- není nutné stahovat obrázky stránek,
- používá se existující OCR přepis NDK,
- funguje i u dokumentů přístupných po přihlášení, pokud NDK danému uživateli OCR zpřístupní,
- přihlášení zůstává standardně v NDK – skript nezná ani neukládá přihlašovací údaje.

## Požadavky

### PC

Je potřeba:

1. webový prohlížeč podporující userscripty,
2. rozšíření **Tampermonkey**,
3. nainstalovaný userscript `NDK – předčítání OCR`.

Skript byl vyzkoušen na PC přímo v prostředí NDK.

### Android

Použít lze například:

- **Firefox pro Android**,
- rozšíření **Tampermonkey**,
- stejný userscript jako na PC.

Předčítání využívá TTS dostupné v zařízení.

## Instalace

1. Nainstalovat Tampermonkey.
2. V Tampermonkey zvolit vytvoření nového skriptu.
3. Výchozí obsah nahradit souborem userscriptu.
4. Skript uložit.
5. Otevřít dokument na `ndk.cz`.
6. V případě chráněného dokumentu se standardním způsobem přihlásit do NDK.
7. Na stránce se zobrazí ovládací panel předčítání.

## Jak skript funguje

Z URL aktuálně otevřeného dokumentu získá UUID stránky, například:

    uuid:100d6360-5c41-11e4-97e9-5ef3fc9bb22f

OCR přepis stránky následně získává z API Krameria:

    /search/api/v5.0/item/<UUID>/streams/TEXT_OCR

Vrácený text je před předáním TTS automaticky upraven.

## Úprava OCR pro přirozenější čtení

OCR zachovává zalomení řádků podle původní tištěné stránky. Přímé předčítání takového textu může způsobovat nepřirozené pauzy.

Skript proto text před čtením upravuje:

- zalomení uvnitř věty nahrazuje mezerou,
- zachovává skutečné konce vět,
- spojuje slova rozdělená na konci řádku,
- odstraňuje nadbytečné mezery,
- opravuje mezery před interpunkcí,
- odstraňuje samostatné číslo stránky na konci OCR,
- rozděluje text do kratších bloků po celých větách.

Například OCR:

    jak nikdy ne-
    může doprat jeho umouněného prádla a jak nikdy nenadojí dost
    mléka od dvou hubených koz pro celou rodinu.

se pro předčítání upraví na:

    jak nikdy nemůže doprat jeho umouněného prádla a jak nikdy
    nenadojí dost mléka od dvou hubených koz pro celou rodinu.

Tato úprava výrazně zlepšuje plynulost syntetizované řeči.

## Základní funkce

Ovládací panel umožňuje:

- **▶ Číst** – zahájit předčítání,
- **⏸ Pauza** – dočasně pozastavit čtení,
- **⏹ Stop** – ukončit čtení,
- **◀ / ▶** – přecházet mezi stránkami,
- měnit **rychlost předčítání**,
- zapnout **automatické pokračování na další stránku**.

Při automatickém režimu skript po dočtení stránky získá OCR následující stránky a pokračuje v předčítání.

## Přístup k chráněným dokumentům

Skript neprovádí vlastní přihlášení a neobsahuje žádné uživatelské jméno ani heslo.

Uživatel se přihlásí standardním způsobem prostřednictvím NDK, případně přes svou partnerskou knihovnu. Skript následně pracuje v existující relaci prohlížeče a používá pouze obsah, který NDK danému uživateli zpřístupňuje.

Dostupnost OCR proto závisí na konkrétním dokumentu a přístupových právech uživatele.

## Ověřené prostředí

Vývoj a první testování proběhlo na dokumentu NDK:

**Pohádky brdských hor**

Bylo ověřeno:

- získání `TEXT_OCR`,
- předčítání českého OCR,
- předzpracování zalomených řádků,
- spojování slov rozdělených na konci řádku,
- rozdělení dlouhého textu na TTS bloky,
- plynulé hlasové čtení,
- práce se stránkami dokumentu.

## Omezení

Kvalita předčítání závisí především na:

- kvalitě původního OCR,
- dostupnosti `TEXT_OCR` u konkrétního dokumentu,
- kvalitě českého TTS hlasu v operačním systému,
- možnostech použitého prohlížeče.

Chyby OCR (například špatně rozpoznaná písmena nebo interpunkce) skript obecně neopravuje.

## Stav projektu

**Verze 0.5 (V5)**

Skript je již prakticky použitelný pro průběžné předčítání digitalizovaných dokumentů NDK. Další vývoj může zahrnovat například lepší volbu hlasu, další korekce typických chyb OCR nebo ukládání uživatelského nastavení.
