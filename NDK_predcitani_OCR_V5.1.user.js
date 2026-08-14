// ==UserScript==
// @name         NDK - předčítání OCR v5.1
// @namespace    https://ndk.cz/
// @version      0.5.1
// @description  Plynulé předčítání OCR stránek NDK s automatickým pokračováním
// @match        https://ndk.cz/view/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let chunks = [];
    let currentChunk = 0;

    let stopped = true;
    let paused = false;

    let currentPageUuid = null;
    let currentPageIndex = -1;
    let pages = [];

    // ============================================================
    // UUID dokumentu a aktuální stránky
    // ============================================================

    function getRootUuid() {
        const m = location.pathname.match(/\/view\/(uuid:[^/?]+)/);
        return m ? m[1] : null;
    }

    function getPageUuidFromUrl() {
        const params = new URLSearchParams(location.search);
        return params.get('page');
    }


    // ============================================================
    // OCR aktuální stránky
    // ============================================================

    async function getOCR(uuid) {

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(uuid) +
            "/streams/TEXT_OCR";

        const response = await fetch(url, {
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error(
                "OCR stránky se nepodařilo načíst. HTTP " +
                response.status
            );
        }

        return await response.text();
    }


    // ============================================================
    // Metadata stránky
    // ============================================================

    async function getPageMetadata(uuid) {

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(uuid);

        const response = await fetch(url, {
            credentials: "include"
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    }


    // ============================================================
    // Vyčištění OCR
    // ============================================================

    function cleanOCR(text) {

        text = text.replace(/\r\n/g, "\n");
        text = text.replace(/\r/g, "\n");

        // Spojení slov rozdělených na konci řádku:
        // "ne-\nmůže" -> "nemůže"
        text = text.replace(
            /([A-Za-zÀ-ž])-\s*\n\s*([A-Za-zÀ-ž])/g,
            "$1$2"
        );

        const lines = text.split("\n");

        let result = "";

        for (let line of lines) {

            line = line.trim();

            if (!line) {
                continue;
            }

            line = line.replace(/\s+/g, " ");

            if (result.length > 0) {

                // Pokud předchozí text končí větou,
                // ponechat hranici věty.
                if (/[.!?]["'»”)]?$/.test(result)) {
                    result += "\n";
                } else {
                    // Jinak jde pouze o zalomení tištěného řádku.
                    result += " ";
                }
            }

            result += line;
        }

        // Více mezer -> jedna
        result = result.replace(/[ \t]+/g, " ");

        // Odstranění mezery před interpunkcí
        result = result.replace(/\s+([,.!?;:])/g, "$1");

        // Více prázdných řádků
        result = result.replace(/\n{2,}/g, "\n");

        // Samostatné číslo stránky na konci OCR
        result = result.replace(/\s+\d{1,4}\s*$/, "");

        return result.trim();
    }


    // ============================================================
    // Rozdělení na věty
    // ============================================================

    function splitSentences(text) {

        const sentences = text.match(
            /[^.!?]+[.!?]+["'»”)]*|[^.!?]+$/g
        );

        if (!sentences) {
            return [text];
        }

        return sentences
            .map(s => s.trim())
            .filter(Boolean);
    }


    // ============================================================
    // Kratší bloky pro speechSynthesis
    // ============================================================

    function createChunks(text, maxLength = 700) {

        const sentences = splitSentences(text);
        const result = [];

        let chunk = "";

        for (const sentence of sentences) {

            if (
                chunk &&
                chunk.length + sentence.length + 1 > maxLength
            ) {
                result.push(chunk.trim());
                chunk = "";
            }

            if (chunk) {
                chunk += " ";
            }

            chunk += sentence;
        }

        if (chunk.trim()) {
            result.push(chunk.trim());
        }

        return result;
    }


    // ============================================================
    // Načtení seznamu stránek dokumentu
    // ============================================================

    async function loadPages() {

        const rootUuid = getRootUuid();

        if (!rootUuid) {
            throw new Error("Nelze zjistit UUID dokumentu.");
        }

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(rootUuid) +
            "/children";

        const response = await fetch(url, {
            credentials: "include"
        });

        if (!response.ok) {
            throw new Error(
                "Nelze načíst seznam stran. HTTP " +
                response.status
            );
        }

        const data = await response.json();

        let items = [];

        if (Array.isArray(data)) {

            items = data;

        } else if (Array.isArray(data.children)) {

            items = data.children;

        } else if (Array.isArray(data.items)) {

            items = data.items;

        } else if (
            data.response &&
            Array.isArray(data.response.docs)
        ) {

            items = data.response.docs;
        }

        pages = items
            .map(item => ({
                pid:
                    item.pid ||
                    item.PID ||
                    item.uuid ||
                    item.id,

                title:
                    item.title ||
                    item.pageNumber ||
                    item.pagenumber ||
                    ""
            }))
            .filter(item => item.pid);

        if (!pages.length) {
            throw new Error(
                "API nevrátilo žádné stránky dokumentu."
            );
        }

        currentPageUuid = getPageUuidFromUrl();

        currentPageIndex =
            pages.findIndex(
                p => p.pid === currentPageUuid
            );
    }


    // ============================================================
    // Aktualizace URL
    // ============================================================

    function updateUrl(uuid) {

        const url = new URL(location.href);

        url.searchParams.set("page", uuid);

        history.replaceState(
            null,
            "",
            url.toString()
        );
    }


    // ============================================================
    // Zobrazení informace o stránce
    // ============================================================

    function setPageInfo(metadata) {

        let printedPage = "";

        if (
            metadata &&
            metadata.details &&
            metadata.details.pagenumber
        ) {
            printedPage =
                String(metadata.details.pagenumber).trim();
        }

        const scanInfo =
            currentPageIndex >= 0 && pages.length
                ? "sken " +
                  (currentPageIndex + 1) +
                  "/" +
                  pages.length
                : "";

        if (printedPage && scanInfo) {

            pageInfo.textContent =
                "Strana " +
                printedPage +
                " · " +
                scanInfo;

        } else if (printedPage) {

            pageInfo.textContent =
                "Strana " +
                printedPage;

        } else if (scanInfo) {

            pageInfo.textContent =
                scanInfo;

        } else {

            pageInfo.textContent =
                "Strana";
        }
    }


    // ============================================================
    // Příprava konkrétní stránky
    // ============================================================

    async function preparePage(uuid) {

        setStatus("Načítám OCR…");

        const [raw, metadata] = await Promise.all([
            getOCR(uuid),
            getPageMetadata(uuid)
        ]);

        const cleaned = cleanOCR(raw);

        chunks = createChunks(cleaned);

        currentChunk = 0;

        if (!chunks.length) {
            throw new Error(
                "OCR text stránky je prázdný."
            );
        }

        currentPageUuid = uuid;

        currentPageIndex =
            pages.findIndex(
                p => p.pid === uuid
            );

        setPageInfo(metadata);
    }


    // ============================================================
    // Čtení jednoho bloku
    // ============================================================

    function speakChunk() {

        if (stopped) {
            return;
        }

        // Konec aktuální stránky
        if (currentChunk >= chunks.length) {

            if (
                autoNextCheckbox.checked &&
                currentPageIndex >= 0 &&
                currentPageIndex < pages.length - 1
            ) {
                nextPage(true);

            } else {

                stopped = true;
                paused = false;

                speechSynthesis.cancel();

                readButton.textContent =
                    "▶ Číst";

                pauseButton.textContent =
                    "⏸ Pauza";

                setStatus("Hotovo");
            }

            return;
        }

        const utterance =
            new SpeechSynthesisUtterance(
                chunks[currentChunk]
            );

        utterance.lang = "cs-CZ";
        utterance.rate =
            parseFloat(speedSelect.value);

        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onstart = function () {

            setStatus(
                "Čtu " +
                (currentChunk + 1) +
                "/" +
                chunks.length
            );
        };

        utterance.onend = function () {

            if (stopped) {
                return;
            }

            currentChunk++;

            speakChunk();
        };

        utterance.onerror = function (event) {

            if (
                event.error !== "canceled" &&
                event.error !== "interrupted"
            ) {
                console.error(
                    "TTS chyba:",
                    event
                );

                setStatus("Chyba TTS");
            }
        };

        speechSynthesis.speak(utterance);
    }


    // ============================================================
    // Start čtení
    // ============================================================

    async function startReading() {

        try {

            speechSynthesis.cancel();

            stopped = false;
            paused = false;

            if (!pages.length) {
                await loadPages();
            }

            currentPageUuid =
                getPageUuidFromUrl();

            if (!currentPageUuid) {
                throw new Error(
                    "V URL není UUID aktuální stránky."
                );
            }

            await preparePage(
                currentPageUuid
            );

            readButton.textContent =
                "⏹ Stop";

            pauseButton.textContent =
                "⏸ Pauza";

            speakChunk();

        } catch (err) {

            console.error(err);

            stopped = true;

            readButton.textContent =
                "▶ Číst";

            pauseButton.textContent =
                "⏸ Pauza";

            setStatus("Chyba");

            alert(
                "NDK předčítání:\n\n" +
                err.message
            );
        }
    }


    // ============================================================
    // STOP
    // ============================================================

    function stopReading() {

        stopped = true;
        paused = false;

        speechSynthesis.cancel();

        readButton.textContent =
            "▶ Číst";

        pauseButton.textContent =
            "⏸ Pauza";

        setStatus("Zastaveno");
    }


    // ============================================================
    // Pauza / pokračovat
    // ============================================================

    function togglePause() {

        if (!speechSynthesis.speaking) {
            return;
        }

        if (paused) {

            speechSynthesis.resume();

            paused = false;

            pauseButton.textContent =
                "⏸ Pauza";

            setStatus(
                "Čtu " +
                (currentChunk + 1) +
                "/" +
                chunks.length
            );

        } else {

            speechSynthesis.pause();

            paused = true;

            pauseButton.textContent =
                "▶ Pokračovat";

            setStatus("Pauza");
        }
    }


    // ============================================================
    // Předchozí stránka
    // ============================================================

    async function previousPage() {

        try {

            if (!pages.length) {
                await loadPages();
            }

            if (currentPageIndex <= 0) {
                return;
            }

            const wasReading = !stopped;

            speechSynthesis.cancel();

            currentPageIndex--;

            const page =
                pages[currentPageIndex];

            currentPageUuid =
                page.pid;

            updateUrl(
                currentPageUuid
            );

            await preparePage(
                currentPageUuid
            );

            if (wasReading) {

                stopped = false;
                paused = false;

                speakChunk();
            }

        } catch (err) {

            console.error(err);
            setStatus("Chyba stránky");
        }
    }


    // ============================================================
    // Další stránka
    // ============================================================

    async function nextPage(fromAuto = false) {

        try {

            if (!pages.length) {
                await loadPages();
            }

            if (
                currentPageIndex >=
                pages.length - 1
            ) {

                stopped = true;

                speechSynthesis.cancel();

                readButton.textContent =
                    "▶ Číst";

                pauseButton.textContent =
                    "⏸ Pauza";

                setStatus(
                    "Konec dokumentu"
                );

                return;
            }

            const wasReading =
                fromAuto || !stopped;

            speechSynthesis.cancel();

            currentPageIndex++;

            const page =
                pages[currentPageIndex];

            currentPageUuid =
                page.pid;

            updateUrl(
                currentPageUuid
            );

            await preparePage(
                currentPageUuid
            );

            if (wasReading) {

                stopped = false;
                paused = false;

                speakChunk();
            }

        } catch (err) {

            console.error(err);

            stopped = true;

            readButton.textContent =
                "▶ Číst";

            pauseButton.textContent =
                "⏸ Pauza";

            setStatus(
                "Chyba stránky"
            );
        }
    }


    // ============================================================
    // GUI
    // ============================================================

    const panel =
        document.createElement("div");

    panel.style.position =
        "fixed";

    panel.style.right =
        "10px";

    panel.style.bottom =
        "15px";

    panel.style.zIndex =
        "999999";

    panel.style.background =
        "rgba(30,30,30,0.94)";

    panel.style.color =
        "white";

    panel.style.padding =
        "9px";

    panel.style.borderRadius =
        "9px";

    panel.style.boxShadow =
        "0 2px 10px rgba(0,0,0,0.45)";

    panel.style.fontFamily =
        "sans-serif";

    panel.style.maxWidth =
        "95vw";


    // ============================================================
    // Informace o stránce
    // ============================================================

    const pageInfo =
        document.createElement("div");

    pageInfo.style.fontSize =
        "12px";

    pageInfo.style.marginBottom =
        "6px";

    pageInfo.style.textAlign =
        "center";

    pageInfo.textContent =
        "Strana";


    // ============================================================
    // První řádek ovládání
    // ============================================================

    const controls =
        document.createElement("div");

    controls.style.display =
        "flex";

    controls.style.alignItems =
        "center";

    controls.style.gap =
        "4px";


    const previousButton =
        document.createElement("button");

    previousButton.textContent =
        "⏮";

    previousButton.title =
        "Předchozí stránka";


    const readButton =
        document.createElement("button");

    readButton.textContent =
        "▶ Číst";


    const pauseButton =
        document.createElement("button");

    pauseButton.textContent =
        "⏸ Pauza";

    pauseButton.title =
        "Pauza / pokračovat";


    const nextButton =
        document.createElement("button");

    nextButton.textContent =
        "⏭";

    nextButton.title =
        "Další stránka";


    for (
        const button of [
            previousButton,
            readButton,
            pauseButton,
            nextButton
        ]
    ) {

        button.style.fontSize =
            "14px";

        button.style.padding =
            "6px 8px";

        button.style.whiteSpace =
            "nowrap";
    }


    // ============================================================
    // Druhý řádek
    // ============================================================

    const settingsLine =
        document.createElement("div");

    settingsLine.style.display =
        "flex";

    settingsLine.style.alignItems =
        "center";

    settingsLine.style.justifyContent =
        "space-between";

    settingsLine.style.gap =
        "8px";

    settingsLine.style.marginTop =
        "7px";


    // ------------------------------------------------------------
    // Rychlost
    // ------------------------------------------------------------

    const speedSelect =
        document.createElement("select");

    speedSelect.style.padding =
        "4px";

    const speeds = [
        ["0.8", "0,8×"],
        ["0.9", "0,9×"],
        ["1.0", "1×"],
        ["1.1", "1,1×"],
        ["1.2", "1,2×"],
        ["1.3", "1,3×"],
        ["1.5", "1,5×"]
    ];

    for (
        const [value, label]
        of speeds
    ) {

        const option =
            document.createElement(
                "option"
            );

        option.value =
            value;

        option.textContent =
            label;

        if (value === "1.0") {
            option.selected = true;
        }

        speedSelect.appendChild(
            option
        );
    }


    // ------------------------------------------------------------
    // Automatická další stránka
    // ------------------------------------------------------------

    const autoLine =
        document.createElement("label");

    autoLine.style.fontSize =
        "12px";

    autoLine.style.whiteSpace =
        "nowrap";


    const autoNextCheckbox =
        document.createElement(
            "input"
        );

    autoNextCheckbox.type =
        "checkbox";

    autoNextCheckbox.checked =
        true;

    autoLine.appendChild(
        autoNextCheckbox
    );

    autoLine.appendChild(
        document.createTextNode(
            " automaticky dál"
        )
    );


    settingsLine.appendChild(
        speedSelect
    );

    settingsLine.appendChild(
        autoLine
    );


    // ============================================================
    // Stav
    // ============================================================

    const status =
        document.createElement("div");

    status.style.fontSize =
        "11px";

    status.style.marginTop =
        "5px";

    status.style.opacity =
        "0.8";

    status.style.textAlign =
        "center";


    function setStatus(text) {
        status.textContent = text;
    }

    setStatus("Připraveno");


    // ============================================================
    // Události
    // ============================================================

    readButton.addEventListener(
        "click",
        function () {

            if (!stopped) {
                stopReading();
            } else {
                startReading();
            }
        }
    );


    pauseButton.addEventListener(
        "click",
        togglePause
    );


    previousButton.addEventListener(
        "click",
        previousPage
    );


    nextButton.addEventListener(
        "click",
        function () {
            nextPage(false);
        }
    );


    // ============================================================
    // Sestavení panelu
    // ============================================================

    controls.appendChild(
        previousButton
    );

    controls.appendChild(
        readButton
    );

    controls.appendChild(
        pauseButton
    );

    controls.appendChild(
        nextButton
    );

    panel.appendChild(
        pageInfo
    );

    panel.appendChild(
        controls
    );

    panel.appendChild(
        settingsLine
    );

    panel.appendChild(
        status
    );

    document.body.appendChild(
        panel
    );


    // ============================================================
    // Inicializace
    // ============================================================

    currentPageUuid =
        getPageUuidFromUrl();

})();
