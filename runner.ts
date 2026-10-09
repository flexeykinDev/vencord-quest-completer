/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { PluginNative } from "@utils/types";
import { ChannelStore, FluxDispatcher, GuildChannelStore, RestAPI, useEffect } from "@webpack/common";

import { settings } from "./settings";
import { getQuestsStore, getRunningGameStore, getStreamingStore, RunningGame } from "./stores";
import { getExpiresAt, getSupportedTask, getTaskConfig, Quest, TaskName } from "./types";

const logger = new Logger("QuestCompleter");

const Native = VencordNative.pluginHelpers.QuestCompleter as PluginNative<typeof import("./native")>;

const NOTIFICATION_COLORS = {
    message: undefined,
    success: "var(--status-positive)",
    failure: "var(--status-danger)"
} as const;

/**
 * Намеренно не showToast: тосты Discord ищутся мангленным поиском и уже дважды
 * ломались при его обновлениях, в последний раз роняя весь клиент через React.
 * Уведомления Vencord рисует своим компонентом, от внутренностей Discord они не
 * зависят. Логи дублируются в консоль, и ни один сбой показа не трогает квесты.
 */
function notify(message: string, type: "message" | "success" | "failure" = "message") {
    logger.info(message);

    try {
        showNotification({
            title: "QuestCompleter",
            body: message,
            color: NOTIFICATION_COLORS[type],
            noPersist: true
        }).catch(err => logger.warn("Уведомление не показалось", err));
    } catch (err) {
        logger.warn("Уведомление не показалось", err);
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

// ---------------------------------------------------------------- квесты на достижения

const ACHIEVEMENT_SCOPES = "identify applications.commands applications.entitlements";

async function listGrantIds(): Promise<Set<string>> {
    try {
        const res = await RestAPI.get({ url: "/oauth2/tokens" });
        return new Set<string>((res.body ?? []).map((grant: any) => grant.id));
    } catch {
        return new Set();
    }
}

/** Отзывает доступ, выданный по ходу обхода, чтобы приложение не осталось висеть на аккаунте */
async function revokeNewGrants(before: Set<string>) {
    try {
        const res = await RestAPI.get({ url: "/oauth2/tokens" });

        for (const grant of res.body ?? []) {
            if (before.has(grant.id)) continue;

            await RestAPI.del({ url: `/oauth2/tokens/${grant.id}` }).catch(() => { });
            logger.info("Отозван доступ приложения, выданный для квеста");
        }
    } catch (err) {
        logger.error("Не смог отозвать доступ приложения. Проверь Настройки, Авторизованные приложения", err);
    }
}

/**
 * Такие квесты не берут подделку heartbeat: Discord ждёт, что активность сама
 * подтвердит прогресс. Обход проходит настоящую авторизацию OAuth, то есть
 * выдаёт приложению игры доступ к аккаунту, и поэтому выключен по умолчанию.
 * Доступ отзывается в finally при любом исходе, включая остановку кнопкой.
 */
async function runAchievementInActivity(quest: Quest, applicationId: string, target: number, signal: AbortSignal) {
    if (!settings.store.achievementBypass) {
        throw new Error("Квест на достижение пропущен: обход выключен в настройках");
    }

    const grantsBefore = await listGrantIds();

    try {
        const authRes = await RestAPI.post({
            url: "/oauth2/authorize",
            query: {
                response_type: "code",
                client_id: applicationId,
                scope: ACHIEVEMENT_SCOPES
            },
            body: {
                permissions: "0",
                authorize: true,
                integration_type: 1,
                location_context: { guild_id: "10000", channel_id: "10000", channel_type: 10000 }
            }
        });

        const code = authRes.body?.location
            ? new URL(authRes.body.location).searchParams.get("code")
            : null;
        if (!code) throw new Error("Discord не вернул код авторизации");

        const ticketRes = await RestAPI.post({ url: `/applications/${applicationId}/proxy-tickets`, body: {} });
        const ticket = ticketRes.body?.ticket;
        if (!ticket) throw new Error("Discord не выдал proxy-ticket");

        const referrer = `https://${applicationId}.discordsays.com/?instance_id=example-cl-instance&platform=desktop&discord_proxy_ticket=${ticket}`;

        const auth = await Native.discordsaysAuthorize({ appId: applicationId, questId: quest.id, referrer, code });
        if (!auth.ok || !auth.body?.token) throw new Error(`Активность не авторизовала нас (статус ${auth.status})`);

        let done = 0;

        while (done < target) {
            if (signal.aborted) throw new Aborted();

            done = Math.min(target, done + 30 + Math.floor(Math.random() * 20));

            const res = await Native.discordsaysProgress({
                appId: applicationId,
                questId: quest.id,
                referrer,
                token: auth.body.token,
                progress: done
            });

            if (!res.ok) throw new Error(`Прогресс не принят (статус ${res.status})`);

            setState({ isRunning: true, statusText: `${done}/${target}` });
            logger.info(`Достижение: ${done}/${target}`);

            if (done < target) await sleep(18000, 4000, signal);
        }
    } finally {
        await revokeNewGrants(grantsBefore);
    }
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

        case "ACHIEVEMENT_IN_ACTIVITY":
            await runAchievementInActivity(quest, applicationId!, secondsNeeded, signal);
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
