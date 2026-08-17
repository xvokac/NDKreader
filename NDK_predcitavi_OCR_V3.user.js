// ==UserScript==
// @name         NDK - předčítání OCR v3
// @namespace    https://ndk.cz/
// @version      0.3
// @description  Přečte OCR text právě otevřené stránky NDK
// @match        https://ndk.cz/view/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let utterance = null;

    function getPageUuid() {
        const params = new URLSearchParams(window.location.search);
        return params.get('page');
    }

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

    async function readPage() {
        const button = document.getElementById("ndk-read-button");

        try {
            button.textContent = "Načítám…";

            const text = await getOCR();

            if (!text || text.trim().length === 0) {
                throw new Error("OCR text stránky je prázdný.");
            }

            console.log("OCR:", text);

            speechSynthesis.cancel();

            utterance = new SpeechSynthesisUtterance(text);

            utterance.lang = "cs-CZ";
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            utterance.volume = 1.0;

            utterance.onstart = function () {
                button.textContent = "⏹ Stop";
            };

            utterance.onend = function () {
                button.textContent = "▶ Číst";
            };

            utterance.onerror = function (event) {
                console.error("TTS chyba:", event);
                button.textContent = "▶ Číst";
            };

            speechSynthesis.speak(utterance);

        } catch (err) {
            console.error(err);
            alert("NDK předčítání:\n\n" + err.message);
            button.textContent = "▶ Číst";
        }
    }

    function stopReading() {
        speechSynthesis.cancel();

        const button = document.getElementById("ndk-read-button");

        if (button) {
            button.textContent = "▶ Číst";
        }
    }

    const panel = document.createElement("div");

    panel.style.position = "fixed";
    panel.style.right = "15px";
    panel.style.bottom = "20px";
    panel.style.zIndex = "999999";
    panel.style.background = "rgba(30,30,30,0.92)";
    panel.style.padding = "10px";
    panel.style.borderRadius = "8px";

    const button = document.createElement("button");

    button.id = "ndk-read-button";
    button.textContent = "▶ Číst";
    button.style.fontSize = "16px";
    button.style.padding = "8px 12px";

    button.addEventListener("click", function () {
        if (speechSynthesis.speaking) {
            stopReading();
        } else {
            readPage();
        }
    });

    panel.appendChild(button);
    document.body.appendChild(panel);

})();
