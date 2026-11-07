/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Генератор картинок для README. На каждый язык своя пара файлов.
// Запуск: node generate.mjs <куда-класть>

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2];
if (!OUT) {
    console.error("нужен путь к папке assets");
    process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const C = {
    bg: "#09090b",
    panel: "#0f0f12",
    panel2: "#131317",
    line: "#2a2a31",
    lineHi: "#3a3a44",
    text: "#ececf1",
    muted: "#85858f",
    dim: "#55555e",
    accent: "#4ddb8a",
    accentDeep: "#2f9c63",
    dotOff: "rgba(255,255,255,.07)"
};

const LANGS = {
    en: {
        subtitle: "Discord quests in one button. No ads, no clutter.",
        pills: ["running", "filter", "no banner"],
        steps: [
            { n: "01", title: "Install", body: "One line in PowerShell.\nNo Node or Git needed up front." },
            { n: "02", title: "Enable", body: "Settings, Vencord, Plugins.\nThe button lands next to the mic." },
            { n: "03", title: "Click", body: "Accepts quests, runs them,\nstops on its own." }
        ]
    },
    ru: {
        subtitle: "Квесты Discord в одну кнопку. Без рекламы и лишних карточек.",
        pills: ["выполнение", "фильтр", "без баннера"],
        steps: [
            { n: "01", title: "Поставить", body: "Одна строка в PowerShell.\nНи Node, ни Git заранее не нужны." },
            { n: "02", title: "Включить", body: "Настройки, Vencord, Plugins.\nКнопка встанет рядом с микрофоном." },
            { n: "03", title: "Нажать", body: "Принимает квесты, выполняет,\nсам останавливается." }
        ]
    },
    uk: {
        subtitle: "Квести Discord в одну кнопку. Без реклами та зайвих карток.",
        pills: ["виконання", "фільтр", "без банера"],
        steps: [
            { n: "01", title: "Встановити", body: "Один рядок у PowerShell.\nНі Node, ні Git заздалегідь не потрібні." },
            { n: "02", title: "Увімкнути", body: "Налаштування, Vencord, Plugins.\nКнопка стане поруч із мікрофоном." },
            { n: "03", title: "Натиснути", body: "Приймає квести, виконує,\nсам зупиняється." }
        ]
    }
};

const FONT = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"]
};

const FONT_STACK = "Inter, 'Segoe UI', system-ui, sans-serif";

/** Ступенчатый «пиксельный» контур: углы срезаны лесенкой в два шага */
function notch(x, y, w, h, s = 3) {
    const p = [
        [0, 2 * s], [s, 2 * s], [s, s], [2 * s, s], [2 * s, 0],
        [w - 2 * s, 0], [w - 2 * s, s], [w - s, s], [w - s, 2 * s], [w, 2 * s],
        [w, h - 2 * s], [w - s, h - 2 * s], [w - s, h - s], [w - 2 * s, h - s], [w - 2 * s, h],
        [2 * s, h], [2 * s, h - s], [s, h - s], [s, h - 2 * s], [0, h - 2 * s]
    ];
    return p.map(([dx, dy]) => `${x + dx},${y + dy}`).join(" ");
}

/** Панель: внешний полигон это рамка, внутренний с отступом в 1px это заливка */
function panel(x, y, w, h, { fill = C.panel, stroke = C.line, s = 3 } = {}) {
    return `<polygon points="${notch(x, y, w, h, s)}" fill="${stroke}" />
    <polygon points="${notch(x + 1, y + 1, w - 2, h - 2, s)}" fill="${fill}" />`;
}

/** Цифры точками 5x7 */
function dots(text, x, y, { d = 3, g = 1, on = C.text, off = C.dotOff } = {}) {
    const step = d + g;
    const glyphW = 5 * step - g;
    const out = [];
    let cx = x;

    for (const ch of String(text)) {
        const rows = FONT[ch] ?? FONT["-"];
        rows.forEach((row, ry) => {
            [...row].forEach((bit, rx) => {
                out.push(`<rect x="${cx + rx * step}" y="${y + ry * step}" width="${d}" height="${d}" fill="${bit === "1" ? on : off}" />`);
            });
        });
        cx += glyphW + step;
    }

    return { svg: out.join("\n    "), width: cx - x - step };
}

function marker(x, y, size = 6, fill = C.accent) {
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}" />`;
}

/** Зерно и редкие пылинки, чтобы фон не был стерильным */
function grain(w, h, seed = 1) {
    let r = seed;
    const rand = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;

    const dust = [];
    for (let i = 0; i < 26; i++) {
        const dx = Math.floor(rand() * (w - 8)) + 4;
        const dy = Math.floor(rand() * (h - 8)) + 4;
        dust.push(`<rect x="${dx}" y="${dy}" width="2" height="2" fill="${rand() < 0.33 ? C.accentDeep : "#2c2c33"}" opacity="${rand() < 0.5 ? 0.5 : 0.8}" />`);
    }

    return `<g>${dust.join("")}</g>
    <rect width="${w}" height="${h}" filter="url(#grain)" opacity="0.1" style="mix-blend-mode:overlay" />`;
}

const defs = `<defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0" />
    </filter>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.accent}" stop-opacity="0.9" />
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0" />
    </linearGradient>
  </defs>`;

/** Ширина пилюли на глаз: шрифт 12px, кириллица и латиница тут близки */
function pillWidth(label) {
    return Math.round(label.length * 7.2) + 28;
}

function banner(lang, version) {
    const W = 880, H = 200;
    const { subtitle, pills } = LANGS[lang];
    const versionDots = dots(version, 700, 150, { d: 3, g: 1, on: C.accent });

    let pillX = 120;
    const pillSvg = pills.map(label => {
        const w = pillWidth(label);
        const svg = `${panel(pillX, 156, w, 26, { fill: C.panel2, stroke: C.lineHi, s: 2 })}
  <text x="${pillX + w / 2}" y="173" text-anchor="middle" font-family="${FONT_STACK}" font-size="12" fill="${C.dim}">${label}</text>`;
        pillX += w + 10;
        return svg;
    }).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="QuestCompleter">
  ${defs}
  <rect width="${W}" height="${H}" fill="${C.bg}" />
  ${grain(W, H, 7)}

  ${panel(12, 12, W - 24, H - 24, { fill: C.panel })}

  <rect x="13" y="30" width="3" height="140" fill="url(#fade)" />

  <g transform="translate(44, 52)" fill="none" stroke="${C.accent}" stroke-width="4">
    <circle cx="28" cy="28" r="25" />
    <path d="M16 29 l9 9 l15 -19" stroke-linecap="square" stroke-linejoin="miter" />
  </g>

  ${marker(118, 58)}
  <text x="134" y="66" font-family="${FONT_STACK}" font-size="13" font-weight="700" fill="${C.accent}" letter-spacing="3.4">VENCORD USERPLUGIN</text>

  <text x="118" y="110" font-family="${FONT_STACK}" font-size="42" font-weight="700" fill="${C.text}" letter-spacing="-0.6">QuestCompleter</text>
  <text x="120" y="138" font-family="${FONT_STACK}" font-size="16" fill="${C.muted}">${subtitle}</text>

  ${pillSvg}

  <text x="${700 + versionDots.width}" y="140" text-anchor="end" font-family="${FONT_STACK}" font-size="10" fill="${C.dim}" letter-spacing="3">VERSION</text>
  ${versionDots.svg}
</svg>
`;
}

function steps(lang) {
    const W = 880, H = 208;
    const cardW = 272, cardH = 168, gap = 20;

    const cards = LANGS[lang].steps.map((item, i) => {
        const x = 12 + i * (cardW + gap);
        const num = dots(item.n, x + 20, 42, { d: 4, g: 1, on: C.accent });
        const lines = item.body.split("\n").map((line, li) =>
            `<text x="${x + 20}" y="${134 + li * 19}" font-family="${FONT_STACK}" font-size="13" fill="${C.muted}">${line}</text>`
        ).join("\n  ");

        return `${panel(x, 20, cardW, cardH, { fill: C.panel })}
  ${num.svg}
  ${marker(x + 20, 86, 5)}
  <text x="${x + 33}" y="91" font-family="${FONT_STACK}" font-size="17" font-weight="700" fill="${C.text}">${item.title}</text>
  ${lines}`;
    }).join("\n  ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="QuestCompleter setup steps">
  ${defs}
  <rect width="${W}" height="${H}" fill="${C.bg}" />
  ${grain(W, H, 23)}
  ${cards}
</svg>
`;
}

const VERSION = "1.2.0";

for (const lang of Object.keys(LANGS)) {
    writeFileSync(join(OUT, `banner.${lang}.svg`), banner(lang, VERSION));
    writeFileSync(join(OUT, `steps.${lang}.svg`), steps(lang));
}

console.log(`готово: ${Object.keys(LANGS).length * 2} файла`);
