// ==UserScript==
// @name         NDK - předčítání OCR v5
// @namespace    https://ndk.cz/
// @version      0.5
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
    // UUID dokumentu a stránky
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
    // Načtení OCR stránky
    // ============================================================

    async function getOCR(uuid) {

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(uuid) +
            "/streams/TEXT_OCR";

        console.log("NDK OCR:", url);

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
    // Vyčištění OCR
    // ============================================================

    function cleanOCR(text) {

        text = text.replace(/\r\n/g, "\n");
        text = text.replace(/\r/g, "\n");

        // Slovo rozdělené na konci řádku:
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

                // konec věty -> ponechat hranici
                if (/[.!?]["'»”)]?$/.test(result)) {
                    result += "\n";
                } else {
                    // pouze typografické zalomení
                    result += " ";
                }
            }

            result += line;
        }

        // více mezer
        result = result.replace(/[ \t]+/g, " ");

        // mezery před interpunkcí
        result = result.replace(/\s+([,.!?;:])/g, "$1");

        // prázdné řádky
        result = result.replace(/\n{2,}/g, "\n");

        // samostatné číslo stránky na konci
        result = result.replace(/\s+\d{1,4}\s*$/, "");

        return result.trim();
    }


    // ============================================================
    // Rozdělení do vět
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
    // Vytvoření kratších TTS bloků
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
    // Načtení seznamu stránek knihy
    // ============================================================

    async function loadPages() {

        const rootUuid = getRootUuid();

        if (!rootUuid) {
            throw new Error("Nelze zjistit UUID dokumentu.");
        }

        /*
         * Kramerius API:
         * děti objektu = stránky monografie
         */

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(rootUuid) +
            "/children";

        console.log("NDK CHILDREN:", url);

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

        console.log("CHILDREN:", data);

        /*
         * Různé verze Krameria mohou vracet děti
         * v mírně odlišné struktuře.
         */

        let items = [];

        if (Array.isArray(data)) {
            items = data;

        } else if (Array.isArray(data.children)) {
            items = data.children;

        } else if (Array.isArray(data.items)) {
            items = data.items;

        } else if (data.response && Array.isArray(data.response.docs)) {
            items = data.response.docs;
        }

        pages = items
            .map(item => {

                return {
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
                };
            })
            .filter(item => item.pid);

        console.log("STRÁNKY:", pages);

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

        console.log(
            "Aktuální strana:",
            currentPageIndex,
            currentPageUuid
        );
    }


    // ============================================================
    // Aktualizace URL NDK
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
    // Načtení konkrétní stránky pro čtení
    // ============================================================

    async function preparePage(uuid) {

        setStatus("Načítám OCR…");

        const raw = await getOCR(uuid);

        console.log("RAW OCR:", raw);

        const cleaned = cleanOCR(raw);

        console.log("CLEAN OCR:", cleaned);

        chunks = createChunks(cleaned);

        currentChunk = 0;

        if (!chunks.length) {
            throw new Error(
                "OCR text stránky je prázdný."
            );
        }

        currentPageUuid = uuid;

        currentPageIndex =
            pages.findIndex(p => p.pid === uuid);

        updatePageInfo();
    }


    // ============================================================
    // Čtení jednoho bloku
    // ============================================================

    function speakChunk() {

        if (stopped) {
            return;
        }

        // konec stránky
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

                readButton.textContent = "▶ Číst";

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

            updatePageInfo();

            setStatus(
                "Čtu blok " +
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
    // Start
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

            readButton.textContent = "⏹ Stop";
            pauseButton.textContent = "⏸";

            speakChunk();

        } catch (err) {

            console.error(err);

            stopped = true;

            readButton.textContent =
                "▶ Číst";

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
            "⏸";

        setStatus("Zastaveno");
    }


    // ============================================================
    // PAUZA
    // ============================================================

    function togglePause() {

        if (!speechSynthesis.speaking) {
            return;
        }

        if (paused) {

            speechSynthesis.resume();

            paused = false;

            pauseButton.textContent =
                "⏸";

            setStatus("Čtu");

        } else {

            speechSynthesis.pause();

            paused = true;

            pauseButton.textContent =
                "▶";

            setStatus("Pauza");
        }
    }


    // ============================================================
    // Předchozí stránka
    // ============================================================

    async function previousPage() {

        if (!pages.length) {
            await loadPages();
        }

        if (currentPageIndex <= 0) {
            return;
        }

        speechSynthesis.cancel();

        const wasReading = !stopped;

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

            speakChunk();
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

                setStatus(
                    "Konec dokumentu"
                );

                readButton.textContent =
                    "▶ Číst";

                return;
            }

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

            if (
                fromAuto ||
                !stopped
            ) {

                stopped = false;

                speakChunk();
            }

        } catch (err) {

            console.error(err);

            stopped = true;

            readButton.textContent =
                "▶ Číst";

            setStatus(
                "Chyba stránky"
            );
        }
    }


    // ============================================================
    // Informace o stránce
    // ============================================================

    function updatePageInfo() {

        if (
            currentPageIndex >= 0 &&
            pages.length
        ) {

            const page =
                pages[currentPageIndex];

            const title =
                page.title
                    ? " · " + page.title
                    : "";

            pageInfo.textContent =
                "Strana " +
                (currentPageIndex + 1) +
                "/" +
                pages.length +
                title;

        } else {

            pageInfo.textContent =
                "Strana";
        }
    }


    // ============================================================
    // GUI
    // ============================================================

    const panel =
        document.createElement("div");

    panel.style.position = "fixed";
    panel.style.right = "15px";
    panel.style.bottom = "20px";
    panel.style.zIndex = "999999";
    panel.style.background =
        "rgba(30,30,30,0.94)";
    panel.style.color = "white";
    panel.style.padding = "10px";
    panel.style.borderRadius = "9px";
    panel.style.boxShadow =
        "0 2px 10px rgba(0,0,0,0.45)";
    panel.style.fontFamily =
        "sans-serif";
    panel.style.minWidth =
        "230px";


    // ------------------------------------------------------------
    // Stránka
    // ------------------------------------------------------------

    const pageInfo =
        document.createElement("div");

    pageInfo.style.fontSize =
        "12px";

    pageInfo.style.marginBottom =
        "6px";

    pageInfo.textContent =
        "Strana";


    // ------------------------------------------------------------
    // Hlavní ovládání
    // ------------------------------------------------------------

    const controls =
        document.createElement("div");


    const previousButton =
        document.createElement("button");

    previousButton.textContent =
        "◀";

    previousButton.title =
        "Předchozí stránka";


    const readButton =
        document.createElement("button");

    readButton.textContent =
        "▶ Číst";


    const pauseButton =
        document.createElement("button");

    pauseButton.textContent =
        "⏸";

    pauseButton.title =
        "Pauza / pokračovat";


    const nextButton =
        document.createElement("button");

    nextButton.textContent =
        "▶";

    nextButton.title =
        "Další stránka";


    for (
        const b of [
            previousButton,
            readButton,
            pauseButton,
            nextButton
        ]
    ) {

        b.style.fontSize =
            "16px";

        b.style.padding =
            "6px 9px";

        b.style.marginRight =
            "4px";
    }


    // ------------------------------------------------------------
    // Rychlost
    // ------------------------------------------------------------

    const speedSelect =
        document.createElement("select");

    speedSelect.style.marginLeft =
        "3px";

    speedSelect.style.padding =
        "6px";

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

        option.value = value;
        option.textContent = label;

        if (value === "1.0") {
            option.selected = true;
        }

        speedSelect.appendChild(
            option
        );
    }


    // ------------------------------------------------------------
    // Automatické pokračování
    // ------------------------------------------------------------

    const autoLine =
        document.createElement("label");

    autoLine.style.display =
        "block";

    autoLine.style.marginTop =
        "7px";

    autoLine.style.fontSize =
        "12px";


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
            " automaticky další stránka"
        )
    );


    // ------------------------------------------------------------
    // Status
    // ------------------------------------------------------------

    const status =
        document.createElement("div");

    status.style.fontSize =
        "11px";

    status.style.marginTop =
        "5px";

    status.style.opacity =
        "0.8";


    function setStatus(text) {
        status.textContent = text;
    }

    setStatus("Připraveno");


    // ------------------------------------------------------------
    // Události
    // ------------------------------------------------------------

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


    // ------------------------------------------------------------
    // Sestavení panelu
    // ------------------------------------------------------------

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

    controls.appendChild(
        speedSelect
    );

    panel.appendChild(
        pageInfo
    );

    panel.appendChild(
        controls
    );

    panel.appendChild(
        autoLine
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
