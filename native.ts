/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Запросы к *.discordsays.com из рендерера режет CSP и отсутствие CORS-заголовков,
 * поэтому они идут из главного процесса.
 *
 * Здесь намеренно только это. Ни токена аккаунта, ни решателей капчи, ни работы
 * с файлами: главный процесс выполняется с правами Node, и чем меньше в нём
 * лежит, тем лучше. Адрес и referrer проверяются перед каждым запросом, чтобы
 * сюда нельзя было подсунуть произвольный хост.
 */

interface AuthorizeArgs {
    appId: string;
    questId: string;
    referrer: string;
    code: string;
}

interface ProgressArgs {
    appId: string;
    questId: string;
    referrer: string;
    token: string;
    progress: number;
}

export interface NativeResponse {
    ok: boolean;
    status: number;
    body: any;
}

const SNOWFLAKE = /^\d{5,25}$/;

function assertArgs(appId: string, questId: string, referrer: string) {
    if (!SNOWFLAKE.test(appId)) throw new Error("Некорректный applicationId");
    if (!SNOWFLAKE.test(questId)) throw new Error("Некорректный questId");
    if (!referrer.startsWith(`https://${appId}.discordsays.com/`)) throw new Error("Некорректный referrer");
}

async function post(url: string, headers: Record<string, string>, body: string): Promise<NativeResponse> {
    const res = await fetch(url, { method: "POST", headers, body });
    const text = await res.text();

    let parsed: any = text;
    try {
        parsed = JSON.parse(text);
    } catch {
        // не json, оставляем текстом
    }

    return { ok: res.ok, status: res.status, body: parsed };
}

export async function discordsaysAuthorize(_: unknown, { appId, questId, referrer, code }: AuthorizeArgs) {
    assertArgs(appId, questId, referrer);

    return post(
        `https://${appId}.discordsays.com/.proxy/acf/authorize`,
        {
            "Content-Type": "application/json",
            "X-Auth-Token": "",
            "X-Discord-Quest-ID": questId,
            Referer: referrer
        },
        JSON.stringify({ code })
    );
}

export async function discordsaysProgress(_: unknown, { appId, questId, referrer, token, progress }: ProgressArgs) {
    assertArgs(appId, questId, referrer);
    if (!Number.isFinite(progress) || progress < 0) throw new Error("Некорректный прогресс");

    return post(
        `https://${appId}.discordsays.com/.proxy/acf/quest/progress`,
        {
            "Content-Type": "application/json",
            "X-Auth-Token": token,
            "X-Discord-Quest-ID": questId,
            Referer: referrer
        },
        JSON.stringify({ progress: Math.floor(progress) })
    );
}
