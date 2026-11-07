/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findComponentByCodeLazy } from "@webpack";
import { Menu, Popout, useRef } from "@webpack/common";

import { t } from "./i18n";
import { refreshQuests, startQuests, stopQuests, useRunState } from "./runner";
import { settings } from "./settings";

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

/** «квест 2 из 7, осталось примерно 14 мин» */
function buildTooltip(isRunning: boolean, statusText: string, etaAt: number | null) {
    if (!isRunning) return t("b.start");

    const parts = [statusText];

    if (etaAt != null) {
        const minutes = Math.max(1, Math.ceil((etaAt - Date.now()) / 60_000));
        parts.push(t("b.estimate", { minutes }));
    }

    return t("b.stop", { status: parts.filter(Boolean).join(", ") });
}

export function QuestButton(props: { nameplate?: unknown; }) {
    const { isRunning, statusText, etaAt } = useRunState();
    const { autoAcceptQuests, achievementBypass } = settings.use(["autoAcceptQuests", "achievementBypass"]);

    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const buttonProps = {
        tooltipText: buildTooltip(isRunning, statusText, etaAt),
        icon: QuestIcon,
        role: "switch",
        ariaChecked: isRunning,
        plated: props?.nameplate != null,
        onClick: isRunning ? stopQuests : startQuests
    };

    // Правый клик открывает то, за чем иначе пришлось бы идти в настройки
    return (
        <Popout
            position="top"
            align="left"
            targetElementRef={buttonRef}
            renderPopout={({ closePopout }) => (
                <Menu.Menu navId="vc-questCompleter-menu" onClose={closePopout} aria-label="QuestCompleter">
                    <Menu.MenuCheckboxItem
                        id="vc-qc-auto-accept"
                        label={t("m.autoAccept")}
                        checked={autoAcceptQuests}
                        action={() => settings.store.autoAcceptQuests = !settings.store.autoAcceptQuests}
                    />
                    <Menu.MenuCheckboxItem
                        id="vc-qc-achievements"
                        label={t("m.achievements")}
                        checked={achievementBypass}
                        action={() => settings.store.achievementBypass = !settings.store.achievementBypass}
                    />
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="vc-qc-refresh"
                        label={t("m.refresh")}
                        action={() => void refreshQuests()}
                    />
                </Menu.Menu>
            )}
        >
            {popoutProps => (
                <PanelButton
                    ref={buttonRef}
                    onContextMenu={popoutProps.onClick}
                    {...buttonProps}
                />
            )}
        </Popout>
    );
}
