/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";

import { startQuests, stopQuests, useRunState } from "./runner";

/** Та же кнопка панели аккаунта, что использует штатный GameActivityToggle */
const PanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const MASK_ID = "vc-questCompleter-off";

function QuestIcon() {
    const { isRunning } = useRunState();
    const color = isRunning ? "var(--status-positive, #23a55a)" : "currentColor";

    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <g mask={isRunning ? undefined : `url(#${MASK_ID})`}>
                <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
                <path d="m8 12 3 3 5-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {!isRunning && <>
                <path fill="var(--status-danger)" d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4Z" />
                <mask id={MASK_ID}>
                    <rect fill="white" x="0" y="0" width="24" height="24" />
                    <path fill="black" d="M23.27 4.73 19.27 .73 -.27 20.27 3.73 24.27Z" />
                </mask>
            </>}
        </svg>
    );
}

export function QuestButton(props: { nameplate?: unknown; }) {
    const { isRunning, statusText } = useRunState();

    return (
        <PanelButton
            tooltipText={isRunning ? `Остановить квесты (${statusText})` : "Выполнить квесты"}
            icon={QuestIcon}
            role="switch"
            ariaChecked={isRunning}
            plated={props?.nameplate != null}
            onClick={isRunning ? stopQuests : startQuests}
        />
    );
}
