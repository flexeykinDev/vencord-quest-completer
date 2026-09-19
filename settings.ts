/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { OptionType } from "@utils/types";

import hideHeroStyle from "./hideHero.css?managed";

export { hideHeroStyle };

export const settings = definePluginSettings({
    filterQuestList: {
        type: OptionType.BOOLEAN,
        description: "Фильтровать список квестов на странице Quests",
        default: true
    },
    showAvailable: {
        type: OptionType.BOOLEAN,
        description: "Показывать квесты, которые можно принять",
        default: true
    },
    showInProgress: {
        type: OptionType.BOOLEAN,
        description: "Показывать квесты в процессе",
        default: true
    },
    showClaimable: {
        type: OptionType.BOOLEAN,
        description: "Показывать выполненные, у которых не забрана награда",
        default: true
    },
    showClaimed: {
        type: OptionType.BOOLEAN,
        description: "Показывать завершённые (награда уже получена)",
        default: false
    },
    showExpired: {
        type: OptionType.BOOLEAN,
        description: "Показывать истёкшие",
        default: false
    },
    onlyOrbs: {
        type: OptionType.BOOLEAN,
        description: "Только квесты с наградой в орбах",
        default: false
    },
    hideSponsoredBanner: {
        type: OptionType.BOOLEAN,
        description: "Скрывать баннер сверху страницы Quests и ряд карточек под ним",
        default: true,
        onChange(value: boolean) {
            if (value) enableStyle(hideHeroStyle);
            else disableStyle(hideHeroStyle);
        }
    }
});
