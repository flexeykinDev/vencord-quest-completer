/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { settings } from "./settings";
import { getExpiresAt, Quest } from "./types";

const logger = new Logger("QuestCompleter");

export type QuestState = "available" | "inProgress" | "claimable" | "claimed" | "expired";

type VisibilitySetting = "showAvailable" | "showInProgress" | "showClaimable" | "showClaimed" | "showExpired";

const VISIBILITY_BY_STATE: Record<QuestState, VisibilitySetting> = {
    available: "showAvailable",
    inProgress: "showInProgress",
    claimable: "showClaimable",
    claimed: "showClaimed",
    expired: "showExpired"
};

/**
 * Порядок проверок повторяет классификатор самого Discord: истёкшим считается
 * только то, что уже нельзя ни выполнить, ни забрать.
 */
export function getQuestState(quest: Quest): QuestState {
    const status = quest.userStatus;
    const enrolled = status?.enrolledAt != null;
    const completed = status?.completedAt != null;
    const claimed = status?.claimedAt != null;

    if (claimed) return "claimed";
    if (completed) return "claimable";

    const expiresAt = getExpiresAt(quest);
    if (expiresAt != null && expiresAt <= Date.now()) return "expired";

    return enrolled ? "inProgress" : "available";
}

/**
 * Точная форма rewardsConfig зависит от версии клиента, поэтому ищем любое поле,
 * похожее на количество орбов, на двух уровнях вложенности.
 */
function hasOrbReward(quest: Quest): boolean {
    if (quest.userStatus?.orbQuantityClaimed != null) return true;

    const rewardsConfig = quest.config?.rewardsConfig;
    if (rewardsConfig == null) return false;

    if (mentionsOrbs(rewardsConfig)) return true;

    const { rewards } = rewardsConfig;
    return Array.isArray(rewards) && rewards.some(mentionsOrbs);
}

function mentionsOrbs(value: unknown): boolean {
    if (value == null || typeof value !== "object") return false;

    return Object.entries(value).some(([key, entry]) => /orb/i.test(key) && entry != null);
}

/**
 * Вызывается для каждого квеста при отрисовке списка, поэтому держим дешёвым
 * и никогда не даём выбросить исключение — иначе развалится вся страница.
 */
export function shouldHideQuest(quest: Quest | null | undefined): boolean {
    try {
        if (!settings.store.filterQuestList || quest == null) return false;

        if (!settings.store[VISIBILITY_BY_STATE[getQuestState(quest)]]) return true;

        return settings.store.onlyOrbs && !hasOrbReward(quest);
    } catch (err) {
        logger.error("Ошибка фильтра списка квестов", err);
        return false;
    }
}

export function shouldHideSponsoredBanner(): boolean {
    return settings.store.hideSponsoredBanner;
}
