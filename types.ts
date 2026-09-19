/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SUPPORTED_TASKS = [
    "WATCH_VIDEO",
    "PLAY_ON_DESKTOP",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "WATCH_VIDEO_ON_MOBILE"
] as const;

export type TaskName = typeof SUPPORTED_TASKS[number];

export interface QuestTask {
    target: number;
    applications?: Array<{ id: string; }>;
}

export interface QuestTaskConfig {
    tasks: Partial<Record<TaskName, QuestTask>>;
}

export interface QuestUserStatus {
    enrolledAt?: string | null;
    completedAt?: string | null;
    claimedAt?: string | null;
    orbQuantityClaimed?: number | null;
    streamProgressSeconds?: number;
    progress?: Partial<Record<TaskName, { value: number; }>>;
}

export interface QuestConfig {
    expiresAt: string;
    configVersion?: number;
    messages: { questName: string; };
    application?: { id: string; };
    taskConfig?: QuestTaskConfig;
    taskConfigV2?: QuestTaskConfig;
    rewardsConfig?: Record<string, unknown>;
}

export interface Quest {
    id: string;
    /** Дублируется на верхнем уровне не во всех версиях клиента */
    expiresAt?: string;
    userStatus?: QuestUserStatus | null;
    config: QuestConfig;
}

/** Задания бывают в taskConfig или taskConfigV2 в зависимости от возраста квеста */
export function getTaskConfig(quest: Quest): QuestTaskConfig | undefined {
    return quest.config.taskConfig ?? quest.config.taskConfigV2;
}

export function getSupportedTask(quest: Quest): TaskName | undefined {
    const tasks = getTaskConfig(quest)?.tasks;
    if (tasks == null) return undefined;

    return SUPPORTED_TASKS.find(task => tasks[task] != null);
}

export function getExpiresAt(quest: Quest): number | null {
    const raw = quest.config?.expiresAt ?? quest.expiresAt;
    if (raw == null) return null;

    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? null : time;
}
