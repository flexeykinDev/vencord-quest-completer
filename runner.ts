/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { ChannelStore, FluxDispatcher, GuildChannelStore, RestAPI, showToast, useEffect } from "@webpack/common";

import { settings } from "./settings";
import { getQuestsStore, getRunningGameStore, getStreamingStore, RunningGame } from "./stores";
import { getExpiresAt, getSupportedTask, getTaskConfig, Quest, TaskName } from "./types";

const logger = new Logger("QuestCompleter");

/**
 * Toasts у Vencord ищется мангленным поиском и отваливается при обновлениях
 * Discord, утаскивая за собой showToast. Всплывашка не стоит того, чтобы из-за
 * неё падал запуск квестов, поэтому все сообщения идут через эту обёртку.
 */
function notify(message: string, type: "message" | "success" | "failure" = "message") {
    logger.info(message);

    try {
        showToast(message, type);
    } catch (err) {
        logger.warn("Всплывашка не показалась, Discord сменил внутренности", err);
    }
}

/** Отмена, а не сбой: отличается от настоящих ошибок при разборе в catch */
class Aborted extends Error { }

// ---------------------------------------------------------------- состояние

interface RunState {
    isRunning: boolean;
    statusText: string;
}

let state: RunState = { isRunning: false, statusText: "" };
let controller: AbortController | null = null;

const listeners = new Set<() => void>();

function setState(next: RunState) {
    state = next;
    listeners.forEach(notify => notify());
}

/** Подписка на состояние запуска для перерисовки кнопки */
export function useRunState(): RunState {
    const forceUpdate = useForceUpdater();

    useEffect(() => {
        listeners.add(forceUpdate);
        return () => void listeners.delete(forceUpdate);
    }, [forceUpdate]);

    return state;
}

export function stopQuests() {
    controller?.abort();
}

// ---------------------------------------------------------------- ожидания

function sleep(ms: number, jitterRange: number, signal: AbortSignal) {
    const jitter = Math.floor(Math.random() * jitterRange) - jitterRange / 2;
    const delay = Math.max(1000, ms + jitter);

    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Aborted());

        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, delay);

        function onAbort() {
            clearTimeout(timer);
            reject(new Aborted());
        }

        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/** Ждёт, пока heartbeat-события Discord не догонят нужный прогресс */
function waitForHeartbeatProgress(quest: Quest, task: TaskName, secondsNeeded: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Aborted());

        function cleanup() {
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            signal.removeEventListener("abort", onAbort);
        }

        function onHeartbeat(data: any) {
            const progress: number | undefined = quest.config.configVersion === 1
                ? data.userStatus?.streamProgressSeconds
                : data.userStatus?.progress?.[task]?.value;

            if (progress == null) return;

            const done = Math.floor(progress);
            setState({ isRunning: true, statusText: `${done}/${secondsNeeded}` });
            logger.info(`Прогресс: ${done}/${secondsNeeded}`);

            if (done >= secondsNeeded) {
                cleanup();
                resolve();
            }
        }

        function onAbort() {
            cleanup();
            reject(new Aborted());
        }

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

// ---------------------------------------------------------------- задания

/** На сколько секунд прогрессу позволено обгонять реальное время */
const MAX_SECONDS_AHEAD = 10;

/**
 * Якорь отсчёта: момент принятия квеста. Так прогресс не уходит вперёд реального
 * времени, даже если квест принят давно и уже набрал часть секунд. Если
 * enrolledAt почему-то нет, считаем, что квест приняли initialProgress секунд
 * назад: набранное сохраняется, а дальше всё равно идёт в реальном темпе.
 */
function getProgressAnchor(quest: Quest, initialProgress: number) {
    const raw = quest.userStatus?.enrolledAt;
    const enrolledAt = raw != null ? new Date(raw).getTime() : Number.NaN;

    return Number.isNaN(enrolledAt) ? Date.now() - initialProgress * 1000 : enrolledAt;
}

async function runWatchVideo(quest: Quest, secondsNeeded: number, initialProgress: number, signal: AbortSignal) {
    const anchor = getProgressAnchor(quest, initialProgress);
    let completed = false;
    let secondsDone = initialProgress;

    while (true) {
        await sleep(7000, 4000, signal);

        const maxAllowed = Math.floor((Date.now() - anchor) / 1000) + MAX_SECONDS_AHEAD;
        const next = Math.min(secondsNeeded, secondsDone + 7, maxAllowed);

        if (next > secondsDone) {
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: next }
            });

            completed = res.body.completed_at != null;
            secondsDone = next;
            setState({ isRunning: true, statusText: `${secondsDone}/${secondsNeeded}` });
            logger.info(`Видео: ${secondsDone}/${secondsNeeded}`);
        }

        if (secondsDone >= secondsNeeded || completed) break;
    }

    if (!completed) {
        await RestAPI.post({
            url: `/quests/${quest.id}/video-progress`,
            body: { timestamp: secondsNeeded }
        });
    }
}

async function runPlayOnDesktop(quest: Quest, applicationId: string, pid: number, secondsNeeded: number, signal: AbortSignal) {
    const res = await RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` });
    const appData = res.body[0];

    const exeName: string = appData.executables?.find((x: any) => x.os === "win32")?.name?.replace(">", "")
        ?? appData.name.replace(/[/\\:*?"<>|]/g, "");

    const fakeGame: RunningGame = {
        cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
        exeName,
        exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
        hidden: false,
        isLauncher: false,
        id: applicationId,
        name: appData.name,
        pid,
        pidPath: [pid],
        processName: appData.name,
        start: Date.now()
    };

    const store = getRunningGameStore();
    const realGames = store.getRunningGames();
    const fakeGames = [fakeGame];

    const realGetRunningGames = store.getRunningGames;
    const realGetGameForPID = store.getGameForPID;

    try {
        store.getRunningGames = () => fakeGames;
        store.getGameForPID = p => fakeGames.find(game => game.pid === p);
        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames } as any);

        await waitForHeartbeatProgress(quest, "PLAY_ON_DESKTOP", secondsNeeded, signal);
    } finally {
        store.getRunningGames = realGetRunningGames;
        store.getGameForPID = realGetGameForPID;
        FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] } as any);
    }
}

async function runStreamOnDesktop(quest: Quest, applicationId: string, pid: number, secondsNeeded: number, signal: AbortSignal) {
    const store = getStreamingStore();
    const realGetMetadata = store.getStreamerActiveStreamMetadata;

    try {
        store.getStreamerActiveStreamMetadata = () => ({ id: applicationId, pid, sourceName: null });
        await waitForHeartbeatProgress(quest, "STREAM_ON_DESKTOP", secondsNeeded, signal);
    } finally {
        store.getStreamerActiveStreamMetadata = realGetMetadata;
    }
}

async function runPlayActivity(quest: Quest, secondsNeeded: number, signal: AbortSignal) {
    const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
        ?? (Object.values(GuildChannelStore.getAllGuilds()) as any[])
            .find(guild => guild != null && guild.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;

    if (channelId == null) {
        throw new Error("Для квеста-активности нужен хотя бы один личный чат или сервер с голосовым каналом");
    }

    const streamKey = `call:${channelId}:1`;

    while (true) {
        const res = await RestAPI.post({
            url: `/quests/${quest.id}/heartbeat`,
            body: { stream_key: streamKey, terminal: false }
        });

        const progress: number = res.body.progress.PLAY_ACTIVITY.value;
        setState({ isRunning: true, statusText: `${Math.floor(progress)}/${secondsNeeded}` });
        logger.info(`Активность: ${Math.floor(progress)}/${secondsNeeded}`);

        if (progress >= secondsNeeded) {
            await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: true }
            });
            break;
        }

        await sleep(20000, 10000, signal);
    }
}

// ---------------------------------------------------------------- принятие квестов

function retryAfterMs(body: any) {
    return ((Number(body?.retry_after) || 5) + 1) * 1000;
}

/** Принимает квест. 429 тут обычное дело, Discord сам говорит, сколько ждать */
async function enrollQuest(quest: Quest, signal: AbortSignal): Promise<boolean> {
    const { questName } = quest.config.messages;
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/enroll`,
                body: {
                    location: 11,
                    is_targeted: false,
                    metadata_raw: null,
                    metadata_sealed: null,
                    traffic_metadata_raw: null
                }
            });

            if (res?.status === 429) {
                if (attempt === MAX_ATTEMPTS) break;
                await sleep(retryAfterMs(res.body), 0, signal);
                continue;
            }

            logger.info(`Принят квест: ${questName}`);
            return true;
        } catch (err: any) {
            if (err instanceof Aborted) throw err;

            const status = err?.status ?? err?.res?.status ?? 0;
            const body = err?.body ?? err?.res?.body ?? {};

            if (status === 429 && attempt < MAX_ATTEMPTS) {
                await sleep(retryAfterMs(body), 0, signal);
                continue;
            }

            logger.error(`Не смог принять "${questName}" (статус ${status})`, body?.message ?? err);
            return false;
        }
    }

    logger.warn(`Сдался с принятием "${questName}": Discord держит лимит`);
    return false;
}

function getAcceptableQuests(): Quest[] {
    const now = Date.now();

    return [...getQuestsStore().quests.values()].filter(quest => {
        const expiresAt = getExpiresAt(quest);

        return quest.userStatus?.enrolledAt == null
            && expiresAt != null && expiresAt > now
            && getSupportedTask(quest) != null;
    });
}

async function acceptAvailableQuests(signal: AbortSignal) {
    const quests = getAcceptableQuests();
    if (quests.length === 0) return;

    setState({ isRunning: true, statusText: "принимаю квесты" });
    notify(`Принимаю квесты: ${quests.length}`);

    for (const quest of quests) {
        await enrollQuest(quest, signal);
        await sleep(2000, 1500, signal);
    }

    // стор обновляется ответом Discord, даём ему дойти до нас
    await sleep(3000, 1000, signal);
}

// ---------------------------------------------------------------- оркестрация

function getPendingQuests(): Quest[] {
    const now = Date.now();

    return [...getQuestsStore().quests.values()].filter(quest => {
        const expiresAt = getExpiresAt(quest);

        return quest.userStatus?.enrolledAt != null
            && quest.userStatus?.completedAt == null
            && expiresAt != null && expiresAt > now
            && getSupportedTask(quest) != null;
    });
}

async function completeQuest(quest: Quest, signal: AbortSignal) {
    const task = getSupportedTask(quest)!;
    const taskData = getTaskConfig(quest)!.tasks[task]!;

    const { questName } = quest.config.messages;
    const secondsNeeded = taskData.target;
    const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
    const pid = Math.floor(Math.random() * 30000) + 1000;

    logger.info(`Начинаю квест: ${questName} (${task})`);

    switch (task) {
        case "WATCH_VIDEO":
        case "WATCH_VIDEO_ON_MOBILE":
            await runWatchVideo(quest, secondsNeeded, quest.userStatus?.progress?.[task]?.value ?? 0, signal);
            break;

        case "PLAY_ON_DESKTOP":
            if (!IS_DISCORD_DESKTOP) throw new Error("Этот квест работает только в десктопном приложении");
            await runPlayOnDesktop(quest, applicationId!, pid, secondsNeeded, signal);
            break;

        case "STREAM_ON_DESKTOP":
            if (!IS_DISCORD_DESKTOP) throw new Error("Этот квест работает только в десктопном приложении");
            await runStreamOnDesktop(quest, applicationId!, pid, secondsNeeded, signal);
            break;

        case "PLAY_ACTIVITY":
            await runPlayActivity(quest, secondsNeeded, signal);
            break;
    }

    logger.info(`Квест ${questName} выполнен`);
}

export async function startQuests() {
    if (state.isRunning) return;

    controller = new AbortController();
    const { signal } = controller;

    try {
        if (settings.store.autoAcceptQuests) {
            await acceptAvailableQuests(signal);
        }

        const quests = getPendingQuests();

        if (quests.length === 0) {
            notify("Нет незавершённых квестов");
            return;
        }

        notify(`Запускаю квесты: ${quests.length}`);

        for (let i = 0; i < quests.length; i++) {
            setState({ isRunning: true, statusText: `квест ${i + 1} из ${quests.length}` });
            await completeQuest(quests[i], signal);

            if (i < quests.length - 1) {
                logger.info("Пауза перед следующим квестом...");
                setState({ isRunning: true, statusText: "пауза" });
                await sleep(30000, 30000, signal);
            }
        }

        notify("Все квесты выполнены", "success");
    } catch (err) {
        if (err instanceof Aborted) {
            notify("Остановлено");
        } else {
            logger.error(err);
            notify(err instanceof Error ? err.message : "Ошибка, смотри консоль", "failure");
        }
    } finally {
        controller = null;
        setState({ isRunning: false, statusText: "" });
    }
}
