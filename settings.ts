/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { disableStyle, enableStyle } from "@api/Styles";
import { OptionType } from "@utils/types";

import hideHeroStyle from "./hideHero.css?managed";
import { t } from "./i18n";

export { hideHeroStyle };

/*
 * Описания намеренно сделаны геттерами. Настройки создаются при загрузке
 * плагина, а стор локали к этому моменту ещё не готов: обычная строка
 * навсегда застыла бы на английском. Геттер читается в момент показа.
 */
export const settings = definePluginSettings({
    checkForUpdates: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.checkUpdates"); },
        default: true
    },
    lastUpdateCheck: {
        type: OptionType.NUMBER,
        description: "",
        default: 0,
        hidden: true
    },
    autoAcceptQuests: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.autoAccept"); },
        default: false
    },
    achievementBypass: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.achievements"); },
        default: false
    },
    claimRewards: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.claim"); },
        default: false
    },
    filterQuestList: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.filter"); },
        default: true
    },
    showAvailable: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.showAvailable"); },
        default: true
    },
    showInProgress: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.showInProgress"); },
        default: true
    },
    showClaimable: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.showClaimable"); },
        default: true
    },
    showClaimed: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.showClaimed"); },
        default: false
    },
    showExpired: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.showExpired"); },
        default: false
    },
    onlyOrbs: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.onlyOrbs"); },
        default: false
    },
    hideSponsoredBanner: {
        type: OptionType.BOOLEAN,
        get description() { return t("s.hideBanner"); },
        default: true,
        onChange(value: boolean) {
            if (value) enableStyle(hideHeroStyle);
            else disableStyle(hideHeroStyle);
        }
    }
});
