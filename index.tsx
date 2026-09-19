/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
*/

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { find, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, GuildChannelStore, RestAPI, showToast, Toasts, useEffect } from "@webpack/common";

const logger = new Logger("QuestCompleter");

// та же кнопка, что использует GameActivityToggle (рядом с микрофоном)
const Button = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

// Стора квестов нет в реестре Flux по имени, поэтому ищем по методам —
// так же, как это делает исходный консольный скрипт.
// Берём настоящий объект, а не ленивый прокси: методы сторов мы временно подменяем.
const storeCache = new Map<string, any>();

function getStore(name: string, filter: (m: any) => boolean) {
    if (!storeCache.has(name)) {
        const found = find(m => {
            try {
                return filter(m);
            } catch {
                return false;
            }
        }, { isIndirect: true });

        if (found == null) throw new Error(`Не нашёл ${name} — вероятно, Discord обновился`);

        logger.info(`Найден ${name}`);
        storeCache.set(name, found);
    }

    return storeCache.get(name);
}

const getQuestsStore = () => getStore("QuestsStore", m => m.getQuest != null && m.quests != null);
const getRunningGameStore = () => getStore("RunningGameStore", m => m.getRunningGames != null && m.getGameForPID != null);
const getStreamingStore = () => getStore("ApplicationStreamingStore", m => m.getStreamerActiveStreamMetadata != null);

const SUPPORTED_TASKS = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"];

class Aborted extends Error { }

// ---------- состояние + подписка для перерисовки кнопки ----------

let isRunning = false;
let statusText = "";
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function setState(running: boolean, status: string) {
    isRunning = running;
    statusText = status;
    listeners.forEach(l => l());
}

function useQuestState() {
    const forceUpdate = useForceUpdater();
    useEffect(() => {
        listeners.add(forceUpdate);
        return () => void listeners.delete(forceUpdate);
    }, [forceUpdate]);
    return { isRunning, statusText };
}

// ---------- утилиты ----------

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
function waitForHeartbeatProgress(quest: any, taskName: string, secondsNeeded: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return reject(new Aborted());

        function cleanup() {
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            signal.removeEventListener("abort", onAbort);
        }

        function onHeartbeat(data: any) {
            const progress = quest.config.configVersion === 1
                ? data.userStatus?.streamProgressSeconds
                : Math.floor(data.userStatus?.progress?.[taskName]?.value ?? 0);

            if (progress == null) return;

            setState(true, `${progress}/${secondsNeeded}`);
            logger.info(`Прогресс: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
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

function getPendingQuests() {
    const QuestsStore = getQuestsStore();

    return [...(QuestsStore.quests?.values() ?? [])].filter((quest: any) =>
        quest.userStatus?.enrolledAt &&
        !quest.userStatus?.completedAt &&
        new Date(quest.config.expiresAt).getTime() > Date.now() &&
        SUPPORTED_TASKS.some(task => Object.keys((quest.config.taskConfig ?? quest.config.taskConfigV2).tasks).includes(task))
    ) as any[];
}

// ---------- обработка одного квеста ----------

async function completeQuest(quest: any, signal: AbortSignal) {
    const pid = Math.floor(Math.random() * 30000) + 1000;
    const questName = quest.config.messages.questName;
    const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
    const taskName = SUPPORTED_TASKS.find(task => taskConfig.tasks[task] != null)!;
    const taskData = taskConfig.tasks[taskName];
    const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
    const secondsNeeded = taskData.target;
    let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

    logger.info(`Начинаю квест: ${questName} (${taskName})`);

    if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
        const startTime = Date.now();
        const initialProgress = secondsDone;
        let completed = false;

        while (true) {
            await sleep(7000, 4000, signal);

            const elapsedReal = Math.floor((Date.now() - startTime) / 1000);
            const currentTimestamp = Math.min(secondsNeeded, initialProgress + elapsedReal);

            const res = await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: currentTimestamp }
            });

            completed = res.body.completed_at != null;
            secondsDone = currentTimestamp;
            setState(true, `${secondsDone}/${secondsNeeded}`);
            logger.info(`Видео: ${secondsDone}/${secondsNeeded}`);

            if (secondsDone >= secondsNeeded || completed) break;
        }

        if (!completed) {
            await RestAPI.post({
                url: `/quests/${quest.id}/video-progress`,
                body: { timestamp: secondsNeeded }
            });
        }
    } else if (taskName === "PLAY_ON_DESKTOP") {
        if (!IS_DISCORD_DESKTOP) throw new Error("PLAY_ON_DESKTOP работает только в десктопном приложении");

        const res = await RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` });
        const appData = res.body[0];
        const exeName = appData.executables?.find((x: any) => x.os === "win32")?.name?.replace(">", "")
            ?? appData.name.replace(/[/\\:*?"<>|]/g, "");

        const fakeGame = {
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

        const RunningGameStore = getRunningGameStore();
        const realGames = RunningGameStore.getRunningGames();
        const fakeGames = [fakeGame];
        const realGetRunningGames = RunningGameStore.getRunningGames;
        const realGetGameForPID = RunningGameStore.getGameForPID;

        try {
            RunningGameStore.getRunningGames = () => fakeGames;
            RunningGameStore.getGameForPID = (p: number) => fakeGames.find(x => x.pid === p);
            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames } as any);

            await waitForHeartbeatProgress(quest, taskName, secondsNeeded, signal);
        } finally {
            RunningGameStore.getRunningGames = realGetRunningGames;
            RunningGameStore.getGameForPID = realGetGameForPID;
            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] } as any);
        }
    } else if (taskName === "STREAM_ON_DESKTOP") {
        if (!IS_DISCORD_DESKTOP) throw new Error("STREAM_ON_DESKTOP работает только в десктопном приложении");

        const ApplicationStreamingStore = getStreamingStore();
        const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        try {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({ id: applicationId, pid, sourceName: null });
            await waitForHeartbeatProgress(quest, taskName, secondsNeeded, signal);
        } finally {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
        }
    } else if (taskName === "PLAY_ACTIVITY") {
        const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id
            ?? (Object.values(GuildChannelStore.getAllGuilds()) as any[]).find(x => x != null && x.VOCAL.length > 0)?.VOCAL[0]?.channel?.id;

        if (channelId == null) throw new Error("Для квеста-активности нужен хотя бы один личный чат или сервер с голосовым каналом");

        const streamKey = `call:${channelId}:1`;

        while (true) {
            const res = await RestAPI.post({
                url: `/quests/${quest.id}/heartbeat`,
                body: { stream_key: streamKey, terminal: false }
            });

            const progress = res.body.progress.PLAY_ACTIVITY.value;
            setState(true, `${Math.floor(progress)}/${secondsNeeded}`);
            logger.info(`Активность: ${progress}/${secondsNeeded}`);

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

    logger.info(`Квест ${questName} выполнен`);
}

async function runAllQuests() {
    controller = new AbortController();
    const { signal } = controller;

    try {
        const quests = getPendingQuests();

        if (quests.length === 0) {
            showToast("Нет незавершённых квестов", Toasts.Type.MESSAGE);
            return;
        }

        setState(true, `0/${quests.length}`);
        showToast(`Запускаю квесты: ${quests.length}`, Toasts.Type.MESSAGE);

        for (let i = 0; i < quests.length; i++) {
            setState(true, `квест ${i + 1} из ${quests.length}`);
            await completeQuest(quests[i], signal);

            if (i < quests.length - 1) {
                logger.info("Пауза перед следующим квестом...");
                setState(true, "пауза");
                await sleep(30000, 30000, signal);
            }
        }

        showToast("Все квесты выполнены", Toasts.Type.SUCCESS);
    } catch (err) {
        if (err instanceof Aborted) {
            showToast("Остановлено", Toasts.Type.MESSAGE);
        } else {
            logger.error(err);
            showToast(err instanceof Error ? err.message : "Ошибка, смотри консоль", Toasts.Type.FAILURE);
        }
    } finally {
        controller = null;
        setState(false, "");
    }
}

// ---------- иконка и кнопка ----------

function Icon() {
    const { isRunning } = useQuestState();
    const color = isRunning ? "var(--status-positive, #23a55a)" : "currentColor";

    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <g mask={!isRunning ? "url(#vc-questCompleterMask)" : void 0}>
                <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
                <path d="m8 12 3 3 5-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            {!isRunning && <>
                <path fill="var(--status-danger)" d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z" />
                <mask id="vc-questCompleterMask">
                    <rect fill="white" x="0" y="0" width="24" height="24" />
                    <path fill="black" d="M23.27 4.73 19.27 .73 -.27 20.27 3.73 24.27Z" />
                </mask>
            </>}
        </svg>
    );
}

function QuestCompleterButton(props: { nameplate?: any; }) {
    const { isRunning, statusText } = useQuestState();

    return (
        <Button
            tooltipText={isRunning ? `Остановить квесты (${statusText})` : "Выполнить квесты"}
            icon={Icon}
            role="switch"
            ariaChecked={isRunning}
            plated={props?.nameplate != null}
            onClick={() => isRunning ? controller?.abort() : runAllQuests()}
        />
    );
}

export default definePlugin({
    name: "QuestCompleter",
    description: "Кнопка рядом с микрофоном: выполняет незавершённые квесты Discord. Нажатие ещё раз останавливает.",
    authors: [{ name: "flexeykin", id: 0n }],

    patches: [
        {
            // то же место, что у GameActivityToggle; окно поиска шире,
            // чтобы патч прошёл, даже если тот плагин вставил свою кнопку раньше
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,120}?accountContainerRef)/,
                replace: "children:[$self.QuestCompleterButton(arguments[0]),"
            }
        }
    ],

    stop() {
        controller?.abort();
    },

    QuestCompleterButton: ErrorBoundary.wrap(QuestCompleterButton, { noop: true })
});
