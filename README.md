# NDK – předčítání OCR textu

Userscript pro hlasité předčítání digitalizovaných dokumentů z **Národní digitální knihovny (NDK)**.

Skript využívá OCR text, který je již uložen u naskenovaných stránek v systému Kramerius, upraví jej pro přirozenější čtení a následně jej předává systémovému převodu textu na řeč (TTS).

Projekt vznikl především pro pohodlné poslouchání knih z NDK na mobilním telefonu, například při cestování.

---

## K čemu skript slouží

Řada dokumentů v NDK je dostupná jako naskenované stránky. U mnoha z nich však NDK obsahuje také OCR přepis, díky kterému je možné v dokumentu textově vyhledávat.

Skript tento existující OCR text využije pro hlasité předčítání.

Výhody:

- není nutné provádět vlastní OCR,
- není nutné stahovat obrázky jednotlivých stran,
- využívá se přímo `TEXT_OCR` uložený v systému Kramerius,
- lze průběžně předčítat celé knihy stránku po stránce,
- funguje i u dokumentů zpřístupněných po přihlášení, pokud má uživatel k dokumentu oprávněný přístup,
- přihlašovací údaje skript nezná ani neukládá,
- je použitelný na PC i na mobilním telefonu.

---

# Aktuální verze

**V5.5**

Hlavní funkce současné verze:

- hlasité čtení OCR,
- automatické pokračování na další stránku,
- předchozí / následující stránka,
- pauza a pokračování,
- změna rychlosti čtení,
- automatické přeskakování stran bez OCR,
- přednačítání následujících stran do cache,
- Screen Wake Lock proti uspání telefonu,
- kompaktní ovládací panel vhodný pro mobil.

---

# Požadavky

## PC

Je potřeba:

1. webový prohlížeč podporující userscripty,
2. rozšíření **Tampermonkey**,
3. userscript `ndk-predcitani.user.js`.

## Android

Odzkoušená koncepce:

1. **Firefox pro Android**,
2. rozšíření **Tampermonkey**,
3. stejný userscript `ndk-predcitani.user.js`.

Samotné předčítání používá TTS dostupné v zařízení.

---

# Instalace

1. Nainstalovat Tampermonkey.
2. V Tampermonkey vytvořit nový userscript.
3. Výchozí obsah nahradit obsahem souboru:

       ndk-predcitani.user.js

4. Skript uložit.
5. Otevřít dokument na:

       https://ndk.cz/

6. V případě chráněného dokumentu se standardně přihlásit do NDK.
7. Po otevření stránky dokumentu se zobrazí malý ovládací panel.

Doporučená přípona userscriptu je:

    .user.js

například:

    ndk-predcitani.user.js

---

# Přístup k OCR

Skript získá UUID právě otevřené stránky z URL NDK.

Například:

    uuid:100d6360-5c41-11e4-97e9-5ef3fc9bb22f

OCR text stránky se získává přes API Krameria:

    /search/api/v5.0/item/<UUID>/streams/TEXT_OCR

Metadata stránky se získávají přes:

    /search/api/v5.0/item/<UUID>

Seznam stran dokumentu přes:

    /search/api/v5.0/item/<UUID_DOKUMENTU>/children

Skript tedy neprovádí vlastní optické rozpoznávání textu. Používá již existující OCR vytvořené při digitalizaci dokumentu.

---

# Přihlášení a chráněné dokumenty

Skript neřeší vlastní autentizaci.

Uživatel se přihlásí běžným způsobem přímo na NDK, například prostřednictvím účtu partnerské knihovny.

Skript následně pracuje v existující přihlášené relaci prohlížeče.

Neobsahuje:

- uživatelské jméno,
- heslo,
- údaje partnerské knihovny,
- vlastní mechanismus obcházení přístupových práv.

Dostupnost OCR závisí na tom, co NDK konkrétnímu přihlášenému uživateli zpřístupňuje.

---

# Úprava OCR před předčítáním

OCR text není připraven primárně pro hlasový výstup. Zachovává například zalomení řádků podle původní tištěné stránky.

Přímé předčítání takového textu způsobovalo nepřirozené pauzy.

Skript proto OCR před čtením upravuje.

## Spojování řádků

Pokud konec řádku není zároveň koncem věty, zalomení se nahradí mezerou.

Například:

    Jakub Tvaroh nebyl takový uhlíř, co běhá s plnou putnou
    uhlí do sklepa a zase nahoru k vozu.

se převede na:

    Jakub Tvaroh nebyl takový uhlíř, co běhá s plnou putnou uhlí do sklepa a zase nahoru k vozu.

Konec řádku za `.`, `!` nebo `?` je naopak zachován jako hranice věty.

---

## Spojování dělených slov

OCR často zachovává dělení slov z tištěné sazby.

Například:

    nikdy ne-
    může doprat

se upraví na:

    nikdy nemůže doprat

---

## Další úpravy

Skript také:

- redukuje vícenásobné mezery,
- odstraňuje mezery před interpunkcí,
- odstraňuje nadbytečná zalomení,
- pokouší se odstranit samostatné číslo stránky na konci OCR.

---

# Rozdělení textu pro TTS

Vyčištěný text se nerozesílá TTS jako jeden dlouhý řetězec.

Nejprve se rozdělí na celé věty a následně na kratší bloky.

Aktuálně je cílová maximální velikost přibližně:

    350 znaků

Blok se pokud možno nikdy nerozděluje uprostřed věty.

To zvyšuje stabilitu `speechSynthesis`, zejména na mobilním zařízení.

---

# Pauza

Původně byla použita funkce:

    speechSynthesis.pause()

Ta se ale na různých prohlížečích a především na mobilních zařízeních nechovala spolehlivě.

Aktuální verze proto při stisku **Pauza**:

1. ukončí aktuální TTS blok,
2. zapamatuje jeho pozici,
3. při pokračování tento blok přečte znovu.

Uživatel se tedy obvykle vrátí přibližně o jednu až dvě věty.

V praxi je tento způsob výrazně spolehlivější a malé zopakování textu při pokračování není rušivé.

---

# Automatické pokračování

Pokud je zapnuta volba:

    Auto

skript po dočtení aktuální stránky automaticky připraví následující stránku a pokračuje ve čtení.

Pořadí stran získává přímo ze struktury dokumentu v Krameriovi.

---

# Stránky bez OCR

Některé naskenované stránky nemají `TEXT_OCR`.

Typicky jde například o:

- celostránkové ilustrace,
- obálky,
- prázdné stránky,
- některé obrazové přílohy.

Taková stránka již není považována za chybu.

Při automatickém čtení ji skript přeskočí a pokračuje na nejbližší následující stránce s OCR.

Při ručním přechodu může panel zobrazit:

    bez OCR

Tato funkce je důležitá zejména u bohatě ilustrovaných knih.

---

# Cache následujících stran

Skript průběžně přednačítá OCR a metadata následujících stran.

Výchozí hodnota:

    20 stran

Panel může zobrazovat například:

    C 20/20

To znamená, že dvacet následujících stran je již připraveno v paměti.

Výhody:

- rychlejší přechod mezi stránkami,
- menší závislost na okamžité odezvě serveru,
- plynulejší dlouhodobé předčítání.

Cache se udržuje pouze v paměti aktuální stránky prohlížeče.

---

# Uspávání telefonu – Wake Lock

Při prvních mobilních testech se ukázalo, že Android po zhasnutí displeje po určité době uspí nejen síťové požadavky, ale také JavaScript a následně hlasový výstup.

Pouhé přednačtení OCR proto nestačilo.

Aktuální verze používá **Screen Wake Lock API**.

Pokud je zapnuto:

    Wake

skript se během čtení pokouší zabránit automatickému uspání displeje.

Tím zůstává aktivní:

- JavaScript,
- TTS,
- přechod mezi bloky,
- přechod mezi stránkami.

Při zastavení čtení se Wake Lock uvolní.

Prakticky lze jas displeje stáhnout na minimum.

---

# Ovládací panel

Mobilní rozhraní je úmyslně velmi kompaktní.

Přibližně:

    ⏮  ▶  ⏸  ⏭  1×

    ☑ Auto  ☑ Wake  Str. 18  C 20/20

Význam:

- `⏮` – předchozí čitelná stránka,
- `▶` – začít číst nebo `■` – stop během čtení,
- `⏸` – pauza nebo `▶` po pauze pokračovat,
- `⏭` – následující čitelná stránka,
- `1×` – rychlost TTS,
- `Auto` – automaticky pokračovat na další stránku,
- `Wake` – zabránit uspání telefonu,
- `Str.` – číslo stránky podle metadat NDK,
- `C` – stav cache.

---

# Číslování stran

Je potřeba rozlišovat:

- číslo vytištěné / evidované stránky,
- pořadí skenu v digitalizovaném dokumentu.

Skript používá pokud možno skutečné číslo stránky uložené v:

    details.pagenumber

To odpovídá číslování zobrazovanému samotným NDK.

---

# Omezení

## Kvalita OCR

Skript OCR neopravuje jazykově.

Ve starších nebo hůře naskenovaných dokumentech se proto mohou objevit například:

- záměny písmen,
- špatná diakritika,
- chybná interpunkce,
- záměna českých znaků za podobné znaky jiných abeced,
- nesprávně spojená nebo rozdělená slova.

Výsledkem může být někdy komická nebo nesrozumitelná věta.

---

## Výslovnost TTS

Kvalita výslovnosti závisí na TTS enginu zařízení.

Problémy se mohou objevit zejména u:

- historických výrazů,
- cizích jmen,
- neobvyklých vlastních jmen,
- OCR chyb,
- zkratek.

Skript samotný hlasovou syntézu neprovádí, pouze předává text systémovému TTS.

---

## Stránky bez OCR

Pokud stránka OCR nemá, není možné ji předčíst.

V automatickém režimu je přeskočena.

---

# Praktické zkušenosti

Skript byl dlouhodobě testován na mobilním telefonu při čtení celých knih o rozsahu přibližně stovky stran.

V praxi se osvědčilo zejména:

- předzpracování zalomených OCR řádků,
- spojování slov rozdělených na konci řádku,
- krátké TTS bloky,
- robustní pauza pomocí `cancel`,
- automatické přeskakování ilustrací bez OCR,
- cache následujících stran,
- Wake Lock při mobilním použití.

Výsledkem je možnost pohodlně poslouchat digitalizované knihy z NDK například během cestování, aniž by bylo nutné ručně listovat jednotlivými skeny.

---

# Doporučená struktura GitHub repozitáře

    ndk-predcitani/
    ├── README.md
    └── ndk-predcitani.user.js

`README.md` obsahuje tuto dokumentaci.

`ndk-predcitani.user.js` obsahuje aktuální verzi userscriptu.

---

# Historie hlavních změn

## V0.3

První funkční načítání:

    TEXT_OCR

a základní předčítání jedné stránky.

## V0.4

Přidáno:

- čištění OCR,
- spojování zalomených řádků,
- spojování dělených slov,
- dělení textu na věty a TTS bloky.

## V0.5

Přidáno:

- automatické pokračování,
- seznam stran dokumentu,
- ruční listování.

## V0.5.1

Úprava mobilního rozhraní a správnější zobrazování čísel stran.

## V0.5.2

Robustnější pauza:

- místo `speechSynthesis.pause()` se používá `cancel()`,
- při pokračování se zopakuje aktuální krátký blok.

## V0.5.3

Přednačítání následujících stran a cache.

## V0.5.4

Přidán Screen Wake Lock proti uspání mobilního prohlížeče.

## V0.5.5

Přidáno:

- kompaktní mobilní rozhraní,
- zkrácené volby `Auto` a `Wake`,
- automatické rozpoznání stránek bez OCR,
- automatické přeskakování ilustrací a dalších stran bez textu.

---

# Stav projektu

**Aktuální verze: V5.5 / 0.5.5**

Projekt je v současném stavu prakticky použitelný pro dlouhodobé předčítání digitalizovaných knih z NDK na PC i na mobilním telefonu.

Další vývoj není pro základní používání nutný. Případná budoucí vylepšení mohou zahrnovat například:

- ukládání rychlosti a nastavení mezi relacemi,
- výběr konkrétního TTS hlasu,
- korekce některých typických OCR chyb,
- záložku / zapamatování poslední přečtené stránky,
- úprava textu OCR při přechodu na novou stránku (rozdělená slova, nedokončená věta).

---

## Poznámka

Projekt není součástí ani oficiálním nástrojem Národní digitální knihovny nebo systému Kramerius. Jde o samostatný userscript využívající rozhraní dostupné při běžném používání NDK.
