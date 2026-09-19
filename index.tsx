/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";

import { shouldHideQuest, shouldHideSponsoredBanner } from "./filter";
import { QuestButton } from "./QuestButton";
import { stopQuests } from "./runner";
import { hideHeroStyle, settings } from "./settings";

export default definePlugin({
    name: "QuestCompleter",
    description: "Кнопка рядом с микрофоном: выполняет незавершённые квесты Discord. Плюс фильтр списка квестов и скрытие рекламного баннера.",
    authors: [{ name: "flexeykin", id: 0n }],
    settings,

    patches: [
        {
            // Хук, собирающий массив квестов и для секций, и для плоского списка.
            // Условие "all"=== оставляет вкладку Claimed Quests нетронутой,
            // иначе она стала бы вечно пустой.
            find: "removeExpiredQuests&&",
            replacement: {
                match: /("all"===(\i)&&\i\.removeExpiredQuests[^;]*;null==(\i)\|\|\i\|\|)(?=\i\.push\(\3\))/,
                replace: "$1(\"all\"===$2&&$self.shouldHideQuest($3))||"
            }
        },
        {
            // Стор рекламы: null здесь штатно означает "баннера нет", поэтому
            // вместе с баннером исчезает и ряд карточек под ним.
            find: "getQuestHomeHero(){",
            replacement: {
                match: /getQuestHomeHero\(\)\{/,
                replace: "$&if($self.shouldHideSponsoredBanner())return null;"
            }
        },
        {
            // Сам компонент баннера. Патч стора выше убирает только рекламу,
            // а у этого места есть ещё и дефолтное содержимое про орбы.
            find: "\"quest-home-hero-banner\"",
            replacement: {
                match: /(?=let\{adContentId:\i,topContent:\i,[^}]*\}=\i,)/,
                replace: "if($self.shouldHideSponsoredBanner())return null;"
            }
        },
        {
            // То же место, что у GameActivityToggle. Окно поиска шире, чтобы
            // патч прошёл, даже если тот плагин вставил свою кнопку раньше.
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,120}?accountContainerRef)/,
                replace: "children:[$self.QuestCompleterButton(arguments[0]),"
            }
        }
    ],

    start() {
        if (settings.store.hideSponsoredBanner) enableStyle(hideHeroStyle);
    },

    stop() {
        stopQuests();
        disableStyle(hideHeroStyle);
    },

    shouldHideQuest,
    shouldHideSponsoredBanner,

    QuestCompleterButton: ErrorBoundary.wrap(QuestButton, { noop: true })
});
