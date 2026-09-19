/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { find } from "@webpack";

import { Quest } from "./types";

const logger = new Logger("QuestCompleter");

export interface QuestsStore {
    quests: Map<string, Quest>;
    getQuest(id: string): Quest | undefined;
}

export interface RunningGame {
    id: string;
    pid: number;
    name: string;
    [key: string]: unknown;
}

export interface RunningGameStore {
    getRunningGames(): RunningGame[];
    getGameForPID(pid: number): RunningGame | undefined;
}

export interface StreamingStore {
    getStreamerActiveStreamMetadata(): { id: string; pid: number; sourceName: string | null; } | null;
}

const cache = new Map<string, unknown>();

/**
 * Стора квестов нет в реестре Flux под ожидаемым именем, поэтому ищем по набору
 * методов, как это делает исходный консольный скрипт.
 *
 * Возвращаем настоящий объект, а не ленивый прокси: часть методов мы временно
 * подменяем, а писать в прокси — лишний источник странностей.
 */
function getStore<T>(name: string, filter: (module: any) => boolean): T {
    const cached = cache.get(name);
    if (cached != null) return cached as T;

    const found = find(module => {
        try {
            return filter(module);
        } catch {
            return false;
        }
    }, { isIndirect: true });

    if (found == null) throw new Error(`Не нашёл ${name} — вероятно, Discord обновился`);

    logger.info(`Найден ${name}`);
    cache.set(name, found);

    return found as T;
}

export const getQuestsStore = () =>
    getStore<QuestsStore>("QuestsStore", m => m.getQuest != null && m.quests != null);

export const getRunningGameStore = () =>
    getStore<RunningGameStore>("RunningGameStore", m => m.getRunningGames != null && m.getGameForPID != null);

export const getStreamingStore = () =>
    getStore<StreamingStore>("ApplicationStreamingStore", m => m.getStreamerActiveStreamMetadata != null);
