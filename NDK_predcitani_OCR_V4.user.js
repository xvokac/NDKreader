// ==UserScript==
// @name         NDK - předčítání OCR v4
// @namespace    https://ndk.cz/
// @version      0.4
// @description  Předčítání OCR textu z NDK
// @match        https://ndk.cz/view/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let chunks = [];
    let currentChunk = 0;
    let stopped = true;
    let paused = false;

    // ============================================================
    // UUID aktuální stránky
    // ============================================================

    function getPageUuid() {
        const params = new URLSearchParams(window.location.search);
        return params.get('page');
    }


    // ============================================================
    // Načtení OCR
    // ============================================================

    async function getOCR() {

        const uuid = getPageUuid();

        if (!uuid) {
            throw new Error("V URL nebylo nalezeno UUID stránky.");
        }

        const url =
            "https://ndk.cz/search/api/v5.0/item/" +
            encodeURIComponent(uuid) +
            "/streams/TEXT_OCR";

        console.log("NDK OCR URL:", url);

        const response = await fetch(url, {
            credentials: "include"
        });

        console.log("OCR HTTP:", response.status);

        if (!response.ok) {
            throw new Error(
                "OCR se nepodařilo načíst. HTTP " +
                response.status
            );
        }

        return await response.text();
    }


    // ============================================================
    // Vyčištění OCR
    // ============================================================

    function cleanOCR(text) {

        // sjednocení konců řádků
        text = text.replace(/\r\n/g, "\n");
        text = text.replace(/\r/g, "\n");

        // --------------------------------------------------------
        // 1. Spojení slov rozdělených na konci řádku
        //
        // "ne-\nmůže" -> "nemůže"
        // --------------------------------------------------------

        text = text.replace(
            /([A-Za-zÀ-ž])-\s*\n\s*([A-Za-zÀ-ž])/g,
            "$1$2"
        );


        // --------------------------------------------------------
        // 2. Zpracování jednotlivých řádků
        // --------------------------------------------------------

        let lines = text.split("\n");

        let result = "";

        for (let line of lines) {

            line = line.trim();

            if (!line) {
                continue;
            }

            // více mezer -> jedna
            line = line.replace(/\s+/g, " ");

            if (result.length > 0) {

                // Pokud předchozí text končí koncem věty,
                // ponecháme hranici věty.
                if (/[.!?]["'»”)]?$/.test(result)) {
                    result += "\n";
                } else {
                    // jinak byl konec řádku pouze typografický
                    result += " ";
                }
            }

            result += line;
        }


        // --------------------------------------------------------
        // 3. Další kosmetické opravy OCR
        // --------------------------------------------------------

        // více mezer -> jedna
        result = result.replace(/[ \t]+/g, " ");

        // mezery před interpunkcí
        result = result.replace(/\s+([,.!?;:])/g, "$1");

        // příliš mnoho prázdných řádků
        result = result.replace(/\n{2,}/g, "\n");


        // --------------------------------------------------------
        // 4. Samostatné číslo stránky na konci
        //
        // "... děti byly dvě. Toník a Mařenka.\n5"
        // --------------------------------------------------------

        result = result.replace(/\s+\d{1,4}\s*$/, "");


        return result.trim();
    }


    // ============================================================
    // Rozdělení na věty
    // ============================================================

    function splitSentences(text) {

        // Hranice věty po . ! ?
        // Za ní musí následovat mezera nebo nový řádek.

        const sentences = text.match(
            /[^.!?]+[.!?]+["'»”)]*|[^.!?]+$/g
        );

        if (!sentences) {
            return [text];
        }

        return sentences
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }


    // ============================================================
    // Vytvoření bloků pro speechSynthesis
    // ============================================================

    function createChunks(text, maxLength = 700) {

        const sentences = splitSentences(text);

        const result = [];

        let chunk = "";

        for (const sentence of sentences) {

            if (
                chunk.length > 0 &&
                chunk.length + sentence.length + 1 > maxLength
            ) {
                result.push(chunk.trim());
                chunk = "";
            }

            if (chunk.length > 0) {
                chunk += " ";
            }

            chunk += sentence;
        }

        if (chunk.trim().length > 0) {
            result.push(chunk.trim());
        }

        return result;
    }


    // ============================================================
    // Přečtení jednoho bloku
    // ============================================================

    function speakChunk() {

        if (stopped) {
            return;
        }

        if (currentChunk >= chunks.length) {

            stopped = true;
            paused = false;

            setStatus("Hotovo");
            readButton.textContent = "▶ Číst";

            return;
        }

        const utterance =
            new SpeechSynthesisUtterance(chunks[currentChunk]);

        utterance.lang = "cs-CZ";
        utterance.rate = parseFloat(speedSelect.value);
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

            if (!stopped) {
                currentChunk++;
                speakChunk();
            }
        };


        utterance.onerror = function (event) {

            // cancel při stisku STOP není skutečná chyba
            if (
                event.error !== "canceled" &&
                event.error !== "interrupted"
            ) {
                console.error("TTS chyba:", event);
                setStatus("Chyba TTS");
            }
        };


        speechSynthesis.speak(utterance);
    }


    // ============================================================
    // Zahájení čtení
    // ============================================================

    async function startReading() {

        try {

            stopReading(false);

            setStatus("Načítám OCR…");

            const rawText = await getOCR();

            console.log("PŮVODNÍ OCR:");
            console.log(rawText);

            const cleanText = cleanOCR(rawText);

            console.log("VYČIŠTĚNÝ TEXT:");
            console.log(cleanText);

            chunks = createChunks(cleanText);

            console.log(
                "Počet TTS bloků:",
                chunks.length
            );

            console.log("TTS bloky:", chunks);

            if (chunks.length === 0) {
                throw new Error("OCR text stránky je prázdný.");
            }

            currentChunk = 0;
            stopped = false;
            paused = false;

            readButton.textContent = "⏹ Stop";

            speakChunk();

        } catch (err) {

            console.error(err);

            alert(
                "NDK předčítání:\n\n" +
                err.message
            );

            setStatus("Chyba");

            readButton.textContent = "▶ Číst";
        }
    }


    // ============================================================
    // STOP
    // ============================================================

    function stopReading(updateStatus = true) {

        stopped = true;
        paused = false;

        speechSynthesis.cancel();

        if (updateStatus) {
            setStatus("Zastaveno");
        }

        if (readButton) {
            readButton.textContent = "▶ Číst";
        }
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

            pauseButton.textContent = "⏸";

            setStatus(
                "Čtu " +
                (currentChunk + 1) +
                "/" +
                chunks.length
            );

        } else {

            speechSynthesis.pause();

            paused = true;

            pauseButton.textContent = "▶";

            setStatus("Pauza");
        }
    }


    // ============================================================
    // GUI
    // ============================================================

    const panel = document.createElement("div");

    panel.style.position = "fixed";
    panel.style.right = "15px";
    panel.style.bottom = "20px";
    panel.style.zIndex = "999999";
    panel.style.background = "rgba(30,30,30,0.92)";
    panel.style.color = "white";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow =
        "0 2px 8px rgba(0,0,0,0.4)";
    panel.style.fontFamily = "sans-serif";


    // ------------------------------------------------------------
    // hlavní tlačítko
    // ------------------------------------------------------------

    const readButton = document.createElement("button");

    readButton.textContent = "▶ Číst";
    readButton.style.fontSize = "16px";
    readButton.style.padding = "7px 10px";

    readButton.addEventListener("click", function () {

        if (!stopped) {
            stopReading();
        } else {
            startReading();
        }
    });


    // ------------------------------------------------------------
    // pauza
    // ------------------------------------------------------------

    const pauseButton = document.createElement("button");

    pauseButton.textContent = "⏸";
    pauseButton.title = "Pauza / pokračovat";

    pauseButton.style.fontSize = "16px";
    pauseButton.style.padding = "7px 10px";
    pauseButton.style.marginLeft = "5px";

    pauseButton.addEventListener(
        "click",
        togglePause
    );


    // ------------------------------------------------------------
    // rychlost
    // ------------------------------------------------------------

    const speedSelect = document.createElement("select");

    speedSelect.style.fontSize = "15px";
    speedSelect.style.marginLeft = "6px";
    speedSelect.style.padding = "6px";

    const speeds = [
        ["0.8", "0,8×"],
        ["0.9", "0,9×"],
        ["1.0", "1×"],
        ["1.1", "1,1×"],
        ["1.2", "1,2×"],
        ["1.3", "1,3×"],
        ["1.5", "1,5×"]
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


    // ------------------------------------------------------------
    // stav
    // ------------------------------------------------------------

    const status = document.createElement("div");

    status.style.fontSize = "11px";
    status.style.marginTop = "5px";
    status.style.opacity = "0.8";

    function setStatus(text) {
        status.textContent = text;
    }

    setStatus("Připraveno");


    // ------------------------------------------------------------
    // sestavení panelu
    // ------------------------------------------------------------

    panel.appendChild(readButton);
    panel.appendChild(pauseButton);
    panel.appendChild(speedSelect);
    panel.appendChild(status);

    document.body.appendChild(panel);

})();
