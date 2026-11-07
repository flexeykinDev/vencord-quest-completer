/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LocaleStore } from "@webpack/common";

/*
 * Плагин говорит на языке клиента. Английский основной, он же запасной:
 * если строки на нужном языке нет, возьмётся английская, а не пустота.
 *
 * Язык определяется лениво. Стор локали появляется позже, чем грузится плагин,
 * поэтому до его готовности ответ не запоминается: иначе первый же ранний
 * вызов навсегда зафиксировал бы английский.
 */

const en = {
    "s.checkUpdates": "Check GitHub for plugin updates, at most once every six hours",
    "s.autoAccept": "Accept every available quest first, then run them",
    "s.achievements": "Achievement quests. WARNING: this grants the game's app access to your account over OAuth. Access is revoked right after the quest, but the risk is higher than plain progress spoofing",
    "s.claim": "Try to claim the reward after a quest completes. Discord sometimes asks for a captcha, and then you claim it yourself in one click",
    "s.filter": "Filter the quest list on the Quests page",
    "s.showAvailable": "Show quests you can accept",
    "s.showInProgress": "Show quests in progress",
    "s.showClaimable": "Show completed quests with an unclaimed reward",
    "s.showClaimed": "Show finished quests (reward already claimed)",
    "s.showExpired": "Show expired quests",
    "s.onlyOrbs": "Only quests that pay in Orbs",
    "s.hideBanner": "Hide the banner at the top of the Quests page and the card row under it",

    "m.autoAccept": "Accept quests first",
    "m.achievements": "Achievement quests",
    "m.refresh": "Refresh quest list",
    "m.refreshed": "Asked Discord for a fresh quest list",
    "m.refreshFailed": "Could not refresh the list",

    "b.start": "Run quests",
    "b.stop": "Stop quests ({status})",
    "b.estimate": "about {minutes} min left",

    "r.nothing": "No quests left to run",
    "r.accepting": "Accepting quests: {count}",
    "r.start": "Running {count} quests",
    "r.startOrbs": "Running {count} quests, {orbs} Orbs",
    "r.allDone": "All quests done",
    "r.partial": "Done. Failed: {failed} of {total}",
    "r.stopped": "Stopped",
    "r.skip": "Skipping \"{name}\": {reason}",
    "r.statusAccept": "accepting",
    "r.statusQuest": "quest {index} of {total}",
    "r.statusPause": "pause",
    "r.claimed": "Reward claimed: {name}",
    "r.claimManual": "Reward for \"{name}\" needs to be claimed by hand",

    "e.storeMissing": "Could not find {name}. Discord has probably changed",
    "e.achievementsOff": "Achievement quest skipped: the bypass is off in settings",
    "e.desktopOnly": "This quest only works in the desktop app",
    "e.noChannel": "An activity quest needs at least one DM or a server with a voice channel",
    "e.authFailed": "The activity did not authorize us ({status}): {body}",
    "e.noCode": "Discord returned no authorization code",
    "e.noTicket": "Discord issued no proxy ticket",
    "e.progressRejected": "Progress rejected ({status}): {body}",
    "e.generic": "Something went wrong, see the console",

    "u.available": "You have {current}, version {latest} is out. Click to open the release page, or run the installer and pick Update"
} as const;

type Key = keyof typeof en;

const ru: Record<Key, string> = {
    "s.checkUpdates": "Проверять обновления плагина на GitHub, не чаще раза в шесть часов",
    "s.autoAccept": "Сначала принимать все доступные квесты, потом выполнять",
    "s.achievements": "Квесты на достижения. ВНИМАНИЕ: выдаёт приложению игры доступ к аккаунту через OAuth. Доступ отзывается сразу после квеста, но риск выше, чем у обычной подделки прогресса",
    "s.claim": "Пробовать забрать награду после выполнения. Discord иногда просит капчу, тогда заберёшь сам одним кликом",
    "s.filter": "Фильтровать список квестов на странице Quests",
    "s.showAvailable": "Показывать квесты, которые можно принять",
    "s.showInProgress": "Показывать квесты в процессе",
    "s.showClaimable": "Показывать выполненные, у которых не забрана награда",
    "s.showClaimed": "Показывать завершённые (награда уже получена)",
    "s.showExpired": "Показывать истёкшие",
    "s.onlyOrbs": "Только квесты с наградой в орбах",
    "s.hideBanner": "Скрывать баннер сверху страницы Quests и ряд карточек под ним",

    "m.autoAccept": "Сначала принимать квесты",
    "m.achievements": "Квесты на достижения",
    "m.refresh": "Обновить список квестов",
    "m.refreshed": "Запросил у Discord свежий список квестов",
    "m.refreshFailed": "Не получилось обновить список",

    "b.start": "Выполнить квесты",
    "b.stop": "Остановить квесты ({status})",
    "b.estimate": "осталось примерно {minutes} мин",

    "r.nothing": "Нет незавершённых квестов",
    "r.accepting": "Принимаю квесты: {count}",
    "r.start": "Запускаю квесты: {count}",
    "r.startOrbs": "Запускаю квесты: {count}, орбов: {orbs}",
    "r.allDone": "Все квесты выполнены",
    "r.partial": "Готово. Не получилось: {failed} из {total}",
    "r.stopped": "Остановлено",
    "r.skip": "Пропускаю «{name}»: {reason}",
    "r.statusAccept": "принимаю квесты",
    "r.statusQuest": "квест {index} из {total}",
    "r.statusPause": "пауза",
    "r.claimed": "Награда забрана: {name}",
    "r.claimManual": "Награду за «{name}» нужно забрать вручную",

    "e.storeMissing": "Не нашёл {name}, вероятно Discord обновился",
    "e.achievementsOff": "Квест на достижение пропущен: обход выключен в настройках",
    "e.desktopOnly": "Этот квест работает только в десктопном приложении",
    "e.noChannel": "Для квеста-активности нужен хотя бы один личный чат или сервер с голосовым каналом",
    "e.authFailed": "Активность не авторизовала нас ({status}): {body}",
    "e.noCode": "Discord не вернул код авторизации",
    "e.noTicket": "Discord не выдал proxy-ticket",
    "e.progressRejected": "Прогресс не принят ({status}): {body}",
    "e.generic": "Что-то пошло не так, смотри консоль",

    "u.available": "Установлена {current}, вышла {latest}. Нажми, чтобы открыть страницу релиза, или запусти установщик и выбери «Обновить»"
};

const uk: Record<Key, string> = {
    "s.checkUpdates": "Перевіряти оновлення плагіна на GitHub, не частіше ніж раз на шість годин",
    "s.autoAccept": "Спершу приймати всі доступні квести, потім виконувати",
    "s.achievements": "Квести на досягнення. УВАГА: надає застосунку гри доступ до акаунта через OAuth. Доступ відкликається одразу після квеста, але ризик вищий, ніж у звичайної підробки прогресу",
    "s.claim": "Пробувати забрати нагороду після виконання. Discord інколи просить капчу, тоді забереш сам одним кліком",
    "s.filter": "Фільтрувати список квестів на сторінці Quests",
    "s.showAvailable": "Показувати квести, які можна прийняти",
    "s.showInProgress": "Показувати квести в процесі",
    "s.showClaimable": "Показувати виконані, у яких не забрано нагороду",
    "s.showClaimed": "Показувати завершені (нагороду вже отримано)",
    "s.showExpired": "Показувати застарілі",
    "s.onlyOrbs": "Лише квести з нагородою в орбах",
    "s.hideBanner": "Ховати банер угорі сторінки Quests і ряд карток під ним",

    "m.autoAccept": "Спершу приймати квести",
    "m.achievements": "Квести на досягнення",
    "m.refresh": "Оновити список квестів",
    "m.refreshed": "Запитав у Discord свіжий список квестів",
    "m.refreshFailed": "Не вдалося оновити список",

    "b.start": "Виконати квести",
    "b.stop": "Зупинити квести ({status})",
    "b.estimate": "лишилось приблизно {minutes} хв",

    "r.nothing": "Немає незавершених квестів",
    "r.accepting": "Приймаю квести: {count}",
    "r.start": "Запускаю квести: {count}",
    "r.startOrbs": "Запускаю квести: {count}, орбів: {orbs}",
    "r.allDone": "Усі квести виконано",
    "r.partial": "Готово. Не вийшло: {failed} з {total}",
    "r.stopped": "Зупинено",
    "r.skip": "Пропускаю «{name}»: {reason}",
    "r.statusAccept": "приймаю квести",
    "r.statusQuest": "квест {index} з {total}",
    "r.statusPause": "пауза",
    "r.claimed": "Нагороду забрано: {name}",
    "r.claimManual": "Нагороду за «{name}» треба забрати вручну",

    "e.storeMissing": "Не знайшов {name}, імовірно Discord оновився",
    "e.achievementsOff": "Квест на досягнення пропущено: обхід вимкнено в налаштуваннях",
    "e.desktopOnly": "Цей квест працює лише в десктопному застосунку",
    "e.noChannel": "Для квеста-активності потрібен хоча б один особистий чат або сервер з голосовим каналом",
    "e.authFailed": "Активність не авторизувала нас ({status}): {body}",
    "e.noCode": "Discord не повернув код авторизації",
    "e.noTicket": "Discord не видав proxy-ticket",
    "e.progressRejected": "Прогрес не прийнято ({status}): {body}",
    "e.generic": "Щось пішло не так, дивись консоль",

    "u.available": "Встановлено {current}, вийшла {latest}. Натисни, щоб відкрити сторінку релізу, або запусти інсталятор і обери «Оновити»"
};

const TABLES = { en, ru, uk };

let cached: keyof typeof TABLES | null = null;

function currentLang() {
    if (cached != null) return cached;

    const locale = LocaleStore?.locale;
    if (locale == null) return "en";

    const code = locale.slice(0, 2).toLowerCase();
    cached = code === "ru" ? "ru" : code === "uk" ? "uk" : "en";

    return cached;
}

export function t(key: Key, params?: Record<string, string | number>) {
    let text: string = TABLES[currentLang()][key] ?? en[key] ?? key;

    if (params != null) {
        for (const [name, value] of Object.entries(params)) {
            text = text.split(`{${name}}`).join(String(value));
        }
    }

    return text;
}
