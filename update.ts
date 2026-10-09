/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";

import { settings } from "./settings";

const logger = new Logger("QuestCompleter");

/** Держать в курсе с тегом релиза на GitHub */
export const VERSION = "1.1.0";

const REPO = "flexeykinDev/vencord-quest-completer";
const LATEST_RELEASE = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 20_000;

/** "v1.2.3" -> [1, 2, 3]. Мусор превращается в [0], он проиграет любому сравнению */
function parseVersion(raw: string): number[] {
    const cleaned = raw.trim().replace(/^v/i, "");
    const parts = cleaned.split(".").map(part => Number.parseInt(part, 10));

    return parts.every(Number.isFinite) && parts.length > 0 ? parts : [0];
}

function isNewer(remote: string, local: string) {
    const a = parseVersion(remote);
    const b = parseVersion(local);

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff > 0;
    }

    return false;
}

async function fetchLatestTag(): Promise<string | null> {
    const res = await fetch(LATEST_RELEASE, {
        headers: { Accept: "application/vnd.github+json" }
    });

    if (!res.ok) throw new Error(`GitHub ответил ${res.status}`);

    const { tag_name: tag } = await res.json();
    return typeof tag === "string" ? tag : null;
}

/**
 * Обновиться самостоятельно плагин не может: пересборка Vencord живёт на диске,
 * а не в рендерере. Поэтому только замечаем новую версию и говорим о ней один
 * раз, не чаще раза в шесть часов. Любая ошибка проверки остаётся в логе:
 * недоступный GitHub не повод беспокоить человека.
 */
export async function checkForUpdates() {
    if (!settings.store.checkForUpdates) return;

    const since = Date.now() - (settings.store.lastUpdateCheck ?? 0);
    if (since < CHECK_EVERY_MS) return;

    try {
        const tag = await fetchLatestTag();
        settings.store.lastUpdateCheck = Date.now();

        if (tag == null) return;

        if (!isNewer(tag, VERSION)) {
            logger.info(`Версия ${VERSION} актуальна`);
            return;
        }

        logger.info(`Доступна версия ${tag}, установлена ${VERSION}`);

        showNotification({
            title: "QuestCompleter: вышло обновление",
            body: `Установлена ${VERSION}, доступна ${tag}. Нажми, чтобы открыть страницу релиза, или запусти установщик и выбери «Обновить».`,
            onClick: () => VencordNative.native.openExternal(RELEASES_PAGE)
        }).catch(err => logger.warn("Уведомление не показалось", err));
    } catch (err) {
        logger.info("Не смог проверить обновления", err);
    }
}

/** Старт клиента и так загружен, проверка подождёт */
export function scheduleUpdateCheck() {
    setTimeout(() => void checkForUpdates(), STARTUP_DELAY_MS);
}
