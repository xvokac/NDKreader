// ==UserScript==
// @name         NDK - předčítání OCR v5.5
// @namespace    https://ndk.cz/
// @version      0.5.5
// @description  Předčítání OCR NDK s cache, Wake Lock a přeskakováním stran bez OCR
// @match        https://ndk.cz/view/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const PREFETCH_COUNT = 20;
    const PREFETCH_WORKERS = 3;
    const CHUNK_LENGTH = 350;

    let chunks = [];
    let currentChunk = 0;

    let stopped = true;
    let paused = false;

    let currentPageUuid = null;
    let currentPageIndex = -1;
    let pages = [];

    let speechGeneration = 0;
    let wakeLock = null;

    const pageCache = new Map();
    const loadingPages = new Map();


    // ============================================================
    // UUID
    // ============================================================

    function getRootUuid() {
        const m = location.pathname.match(/\/view\/(uuid:[^/?]+)/);
        return m ? m[1] : null;
    }

    function getPageUuidFromUrl() {
        return new URLSearchParams(location.search).get("page");
    }


    // ============================================================
    // WAKE LOCK
    // ============================================================

    async function requestWakeLock() {

        if (!keepAwakeCheckbox.checked) {
            updateWakeInfo();
            return;
        }

        if (!("wakeLock" in navigator)) {
            wakeInfo.textContent = "Wake ✕";
            return;
        }

        if (document.visibilityState !== "visible") {
            return;
        }

        if (wakeLock) {
            updateWakeInfo();
            return;
        }

        try {

            wakeLock = await navigator.wakeLock.request("screen");

            wakeLock.addEventListener("release", () => {
                wakeLock = null;
                updateWakeInfo();
            });

        } catch (err) {

            console.warn("Wake Lock:", err);
            wakeLock = null;
        }

        updateWakeInfo();
    }


    async function releaseWakeLock() {

        if (wakeLock) {

            try {
                await wakeLock.release();
            } catch (_) {}

            wakeLock = null;
        }

        updateWakeInfo();
    }


    function updateWakeInfo() {

        if (!("wakeLock" in navigator)) {
            wakeInfo.textContent = "Wake ✕";
            return;
        }

        if (!keepAwakeCheckbox.checked) {
            wakeInfo.textContent = "Wake off";
            return;
        }

        wakeInfo.textContent =
            wakeLock ? "Wake ✓" : "Wake …";
    }


    // ============================================================
    // NETWORK
    // ============================================================

    async function fetchOCR(uuid) {

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(uuid) +
            "/streams/TEXT_OCR";

        const response = await fetch(url, {
            credentials: "include"
        });

        /*
         * Stránka bez OCR není chyba.
         * Typicky ilustrace, obálka apod.
         */
        if (!response.ok) {

            if (
                response.status === 404 ||
                response.status === 403 ||
                response.status === 204
            ) {
                return null;
            }

            throw new Error(
                "OCR HTTP " + response.status
            );
        }

        const text = await response.text();

        if (!text || !text.trim()) {
            return null;
        }

        return text;
    }


    async function fetchMetadata(uuid) {

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
    // CACHE
    // ============================================================

    async function loadPageToCache(uuid) {

        if (pageCache.has(uuid)) {
            return pageCache.get(uuid);
        }

        if (loadingPages.has(uuid)) {
            return loadingPages.get(uuid);
        }

        const promise = (async () => {

            try {

                const [raw, metadata] =
                    await Promise.all([
                        fetchOCR(uuid),
                        fetchMetadata(uuid)
                    ]);

                const data = {
                    raw,
                    metadata,
                    hasOCR: !!(raw && raw.trim())
                };

                pageCache.set(uuid, data);

                updateCacheInfo();

                return data;

            } finally {

                loadingPages.delete(uuid);
            }

        })();

        loadingPages.set(uuid, promise);

        return promise;
    }


    // ============================================================
    // OCR CLEANUP
    // ============================================================

    function cleanOCR(text) {

        text = text
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");

        // ne-\nmůže -> nemůže
        text = text.replace(
            /([A-Za-zÀ-ž])-\s*\n\s*([A-Za-zÀ-ž])/g,
            "$1$2"
        );

        const lines = text.split("\n");

        let result = "";

        for (let line of lines) {

            line = line.trim();

            if (!line) continue;

            line = line.replace(/\s+/g, " ");

            if (result) {

                if (/[.!?]["'»”)]?$/.test(result)) {
                    result += "\n";
                } else {
                    result += " ";
                }
            }

            result += line;
        }

        result = result
            .replace(/[ \t]+/g, " ")
            .replace(/\s+([,.!?;:])/g, "$1")
            .replace(/\n{2,}/g, "\n")
            .replace(/\s+\d{1,4}\s*$/, "");

        return result.trim();
    }


    // ============================================================
    // SENTENCES / CHUNKS
    // ============================================================

    function splitSentences(text) {

        const sentences = text.match(
            /[^.!?]+[.!?]+["'»”)]*|[^.!?]+$/g
        );

        return sentences
            ? sentences.map(s => s.trim()).filter(Boolean)
            : [text];
    }


    function createChunks(text, maxLength = CHUNK_LENGTH) {

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

            if (chunk) chunk += " ";

            chunk += sentence;
        }

        if (chunk.trim()) {
            result.push(chunk.trim());
        }

        return result;
    }


    // ============================================================
    // PAGES
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
                "Seznam stran HTTP " + response.status
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
                    item.id
            }))
            .filter(item => item.pid);

        if (!pages.length) {
            throw new Error("Dokument nemá seznam stran.");
        }

        currentPageUuid = getPageUuidFromUrl();

        currentPageIndex =
            pages.findIndex(
                p => p.pid === currentPageUuid
            );
    }


    // ============================================================
    // URL
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
    // PAGE INFO
    // ============================================================

    function setPageInfo(metadata, hasOCR = true) {

        let printedPage = "";

        if (
            metadata &&
            metadata.details &&
            metadata.details.pagenumber
        ) {
            printedPage =
                String(metadata.details.pagenumber).trim();
        }

        let text =
            printedPage
                ? "Str. " + printedPage
                : "Sken " + (currentPageIndex + 1);

        if (!hasOCR) {
            text += " · bez OCR";
        }

        pageInfo.textContent = text;
    }


    // ============================================================
    // PREPARE PAGE
    // ============================================================

    async function preparePage(uuid) {

        setStatus("Načítám…");

        const data =
            await loadPageToCache(uuid);

        currentPageUuid = uuid;

        currentPageIndex =
            pages.findIndex(
                p => p.pid === uuid
            );

        setPageInfo(
            data.metadata,
            data.hasOCR
        );

        if (!data.hasOCR) {

            chunks = [];
            currentChunk = 0;

            prefetchAhead();

            return false;
        }

        const cleaned =
            cleanOCR(data.raw);

        chunks =
            createChunks(cleaned);

        currentChunk = 0;

        prefetchAhead();

        return chunks.length > 0;
    }


    // ============================================================
    // CACHE INFO / PREFETCH
    // ============================================================

    function countCachedAhead() {

        let count = 0;

        for (
            let i = currentPageIndex + 1;
            i < pages.length &&
            i <= currentPageIndex + PREFETCH_COUNT;
            i++
        ) {

            if (pageCache.has(pages[i].pid)) {
                count++;
            }
        }

        return count;
    }


    function updateCacheInfo() {

        const target =
            Math.min(
                PREFETCH_COUNT,
                Math.max(
                    0,
                    pages.length -
                    currentPageIndex -
                    1
                )
            );

        cacheInfo.textContent =
            "C " +
            countCachedAhead() +
            "/" +
            target;
    }


    async function prefetchAhead() {

        if (
            currentPageIndex < 0 ||
            !pages.length
        ) {
            return;
        }

        const uuids = [];

        const end = Math.min(
            pages.length,
            currentPageIndex + 1 + PREFETCH_COUNT
        );

        for (
            let i = currentPageIndex + 1;
            i < end;
            i++
        ) {

            const uuid = pages[i].pid;

            if (
                !pageCache.has(uuid) &&
                !loadingPages.has(uuid)
            ) {
                uuids.push(uuid);
            }
        }

        let pos = 0;

        async function worker() {

            while (pos < uuids.length) {

                const uuid =
                    uuids[pos++];

                try {
                    await loadPageToCache(uuid);
                } catch (err) {
                    console.warn(
                        "Prefetch:",
                        uuid,
                        err
                    );
                }
            }
        }

        const workers = [];

        for (
            let i = 0;
            i < Math.min(PREFETCH_WORKERS, uuids.length);
            i++
        ) {
            workers.push(worker());
        }

        await Promise.all(workers);

        updateCacheInfo();
    }


    // ============================================================
    // SPEECH
    // ============================================================

    function cancelSpeech() {

        speechGeneration++;

        speechSynthesis.cancel();
    }


    function speakChunk() {

        if (stopped || paused) {
            return;
        }

        // konec stránky
        if (currentChunk >= chunks.length) {

            if (autoNextCheckbox.checked) {
                nextReadablePage(true);
            } else {

                stopped = true;

                cancelSpeech();
                releaseWakeLock();

                readButton.textContent = "▶";
                pauseButton.textContent = "⏸";

                setStatus("Hotovo");
            }

            return;
        }

        const generation =
            speechGeneration;

        const utterance =
            new SpeechSynthesisUtterance(
                chunks[currentChunk]
            );

        utterance.lang = "cs-CZ";

        utterance.rate =
            parseFloat(speedSelect.value);

        utterance.pitch = 1;
        utterance.volume = 1;


        utterance.onstart = function () {

            if (
                generation !==
                speechGeneration
            ) return;

            setStatus(
                (currentChunk + 1) +
                "/" +
                chunks.length
            );
        };


        utterance.onend = function () {

            if (
                generation !==
                speechGeneration ||
                stopped ||
                paused
            ) return;

            currentChunk++;

            speakChunk();
        };


        utterance.onerror = function (event) {

            if (
                generation !==
                speechGeneration
            ) return;

            if (
                event.error !== "canceled" &&
                event.error !== "interrupted"
            ) {
                console.error(event);
                setStatus("TTS chyba");
            }
        };

        speechSynthesis.speak(utterance);
    }


    // ============================================================
    // START
    // ============================================================

    async function startReading() {

        try {

            cancelSpeech();

            stopped = false;
            paused = false;

            await requestWakeLock();

            if (!pages.length) {
                await loadPages();
            }

            currentPageUuid =
                getPageUuidFromUrl();

            let hasText =
                await preparePage(
                    currentPageUuid
                );

            /*
             * Pokud aktuální strana nemá OCR,
             * najdeme automaticky následující čitelnou.
             */
            if (!hasText) {

                const found =
                    await nextReadablePage(false);

                if (!found) {
                    throw new Error(
                        "Nebyla nalezena další stránka s OCR."
                    );
                }

                return;
            }

            readButton.textContent = "■";
            pauseButton.textContent = "⏸";

            speakChunk();

        } catch (err) {

            console.error(err);

            stopped = true;
            paused = false;

            releaseWakeLock();

            readButton.textContent = "▶";
            pauseButton.textContent = "⏸";

            setStatus("Chyba");

            alert(
                "NDK předčítání:\n\n" +
                err.message
            );
        }
    }


    // ============================================================
    // STOP / PAUSE
    // ============================================================

    async function stopReading() {

        stopped = true;
        paused = false;

        cancelSpeech();

        await releaseWakeLock();

        readButton.textContent = "▶";
        pauseButton.textContent = "⏸";

        setStatus("Stop");
    }


    function togglePause() {

        if (stopped) return;

        if (!paused) {

            paused = true;

            cancelSpeech();

            pauseButton.textContent = "▶";

            setStatus("Pauza");

        } else {

            paused = false;

            pauseButton.textContent = "⏸";

            requestWakeLock();

            speakChunk();
        }
    }


    // ============================================================
    // FIND NEXT/PREVIOUS READABLE PAGE
    // ============================================================

    async function findReadablePage(startIndex, direction) {

        let index = startIndex;

        while (
            index >= 0 &&
            index < pages.length
        ) {

            const uuid =
                pages[index].pid;

            const data =
                await loadPageToCache(uuid);

            if (data.hasOCR) {

                return {
                    index,
                    uuid
                };
            }

            index += direction;
        }

        return null;
    }


    async function nextReadablePage(autoMode = false) {

        if (!pages.length) {
            await loadPages();
        }

        const found =
            await findReadablePage(
                currentPageIndex + 1,
                +1
            );

        if (!found) {

            stopped = true;

            cancelSpeech();
            releaseWakeLock();

            readButton.textContent = "▶";
            pauseButton.textContent = "⏸";

            setStatus("Konec");

            return false;
        }

        await goToPage(
            found.index,
            autoMode
        );

        return true;
    }


    async function previousReadablePage() {

        if (!pages.length) {
            await loadPages();
        }

        const found =
            await findReadablePage(
                currentPageIndex - 1,
                -1
            );

        if (!found) return;

        await goToPage(
            found.index,
            false
        );
    }


    // ============================================================
    // GO TO PAGE
    // ============================================================

    async function goToPage(newIndex, forceReading = false) {

        const wasReading =
            forceReading || !stopped;

        const wasPaused =
            paused;

        cancelSpeech();

        currentPageIndex =
            newIndex;

        currentPageUuid =
            pages[newIndex].pid;

        updateUrl(
            currentPageUuid
        );

        const hasText =
            await preparePage(
                currentPageUuid
            );

        /*
         * Pokud ručně přejdeme na obrázek bez OCR,
         * pouze ho označíme.
         *
         * Při automatickém režimu pokračujeme dále.
         */
        if (!hasText) {

            if (wasReading && !wasPaused) {

                await nextReadablePage(true);

            } else {

                stopped = !wasReading;
                paused = wasPaused;

                setStatus("Bez OCR");
            }

            return;
        }


        if (!wasReading) {

            stopped = true;
            paused = false;

            readButton.textContent = "▶";
            pauseButton.textContent = "⏸";

            setStatus("Připraveno");

            return;
        }


        if (wasPaused) {

            stopped = false;
            paused = true;

            readButton.textContent = "■";
            pauseButton.textContent = "▶";

            setStatus("Pauza");

            return;
        }


        stopped = false;
        paused = false;

        await requestWakeLock();

        readButton.textContent = "■";
        pauseButton.textContent = "⏸";

        speakChunk();
    }


    // ============================================================
    // GUI
    // ============================================================

    const panel =
        document.createElement("div");

    Object.assign(panel.style, {
        position: "fixed",
        right: "4px",
        bottom: "8px",
        zIndex: "999999",
        background: "rgba(25,25,25,0.94)",
        color: "white",
        padding: "5px",
        borderRadius: "7px",
        boxShadow: "0 2px 8px rgba(0,0,0,.4)",
        fontFamily: "sans-serif",
        fontSize: "11px",
        maxWidth: "calc(100vw - 8px)"
    });


    // ------------------------------------------------------------
    // Řádek 1
    // ------------------------------------------------------------

    const row1 =
        document.createElement("div");

    Object.assign(row1.style, {
        display: "flex",
        gap: "3px",
        alignItems: "center"
    });


    const previousButton =
        document.createElement("button");

    previousButton.textContent = "⏮";


    const readButton =
        document.createElement("button");

    readButton.textContent = "▶";


    const pauseButton =
        document.createElement("button");

    pauseButton.textContent = "⏸";


    const nextButton =
        document.createElement("button");

    nextButton.textContent = "⏭";


    for (
        const button of [
            previousButton,
            readButton,
            pauseButton,
            nextButton
        ]
    ) {

        Object.assign(button.style, {
            fontSize: "15px",
            minWidth: "34px",
            height: "32px",
            padding: "2px 5px"
        });
    }


    const speedSelect =
        document.createElement("select");

    const speeds = [
        ["0.8", ".8×"],
        ["0.9", ".9×"],
        ["1.0", "1×"],
        ["1.1", "1.1×"],
        ["1.2", "1.2×"],
        ["1.3", "1.3×"],
        ["1.5", "1.5×"]
    ];

    for (const [value, label] of speeds) {

        const option =
            document.createElement("option");

        option.value = value;
        option.textContent = label;

        if (value === "1.0") {
            option.selected = true;
        }

        speedSelect.appendChild(option);
    }

    Object.assign(speedSelect.style, {
        height: "32px",
        fontSize: "12px"
    });


    row1.append(
        previousButton,
        readButton,
        pauseButton,
        nextButton,
        speedSelect
    );


    // ------------------------------------------------------------
    // Řádek 2
    // ------------------------------------------------------------

    const row2 =
        document.createElement("div");

    Object.assign(row2.style, {
        display: "flex",
        alignItems: "center",
        gap: "7px",
        marginTop: "3px",
        whiteSpace: "nowrap"
    });


    const autoLabel =
        document.createElement("label");

    const autoNextCheckbox =
        document.createElement("input");

    autoNextCheckbox.type = "checkbox";
    autoNextCheckbox.checked = true;

    autoLabel.append(
        autoNextCheckbox,
        document.createTextNode(" Auto")
    );


    const wakeLabel =
        document.createElement("label");

    const keepAwakeCheckbox =
        document.createElement("input");

    keepAwakeCheckbox.type = "checkbox";
    keepAwakeCheckbox.checked = true;

    wakeLabel.append(
        keepAwakeCheckbox,
        document.createTextNode(" Wake")
    );


    const pageInfo =
        document.createElement("span");

    pageInfo.textContent = "Str.";


    const cacheInfo =
        document.createElement("span");

    cacheInfo.textContent = "C 0/0";


    const wakeInfo =
        document.createElement("span");

    wakeInfo.textContent = "";


    row2.append(
        autoLabel,
        wakeLabel,
        pageInfo,
        cacheInfo
    );


    // ------------------------------------------------------------
    // Řádek 3 – jen krátký stav
    // ------------------------------------------------------------

    const status =
        document.createElement("div");

    Object.assign(status.style, {
        textAlign: "center",
        opacity: "0.75",
        marginTop: "2px",
        fontSize: "10px"
    });


    function setStatus(text) {
        status.textContent = text;
    }

    setStatus("Připraveno");


    // ============================================================
    // EVENTS
    // ============================================================

    readButton.addEventListener(
        "click",
        () => {
            if (stopped) {
                startReading();
            } else {
                stopReading();
            }
        }
    );


    pauseButton.addEventListener(
        "click",
        togglePause
    );


    previousButton.addEventListener(
        "click",
        previousReadablePage
    );


    nextButton.addEventListener(
        "click",
        () => nextReadablePage(false)
    );


    keepAwakeCheckbox.addEventListener(
        "change",
        async () => {

            if (
                keepAwakeCheckbox.checked &&
                !stopped
            ) {
                await requestWakeLock();

            } else {
                await releaseWakeLock();
            }

            updateWakeInfo();
        }
    );


    document.addEventListener(
        "visibilitychange",
        () => {

            if (
                document.visibilityState === "visible"
            ) {

                prefetchAhead();

                if (
                    !stopped &&
                    keepAwakeCheckbox.checked
                ) {
                    requestWakeLock();
                }
            }
        }
    );


    window.addEventListener(
        "focus",
        () => {

            prefetchAhead();

            if (
                !stopped &&
                keepAwakeCheckbox.checked
            ) {
                requestWakeLock();
            }
        }
    );


    // ============================================================
    // PANEL
    // ============================================================

    panel.append(
        row1,
        row2,
        status
    );

    document.body.appendChild(panel);

    currentPageUuid =
        getPageUuidFromUrl();

    updateWakeInfo();

})();
