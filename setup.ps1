<#
.SYNOPSIS
    Установка, обновление и удаление плагина QuestCompleter для Vencord.

.DESCRIPTION
    Без параметров показывает меню. Всё, чего не хватает для сборки, скрипт
    предлагает доставить через winget, спрашивая про каждый инструмент отдельно.

.PARAMETER Action
    Install, Update, Uninstall или Manual. Без него показывается меню.

.PARAMETER VencordPath
    Папка с исходниками Vencord. Без неё скрипт ищет сам.

.PARAMETER SkipInject
    Не трогать установку Discord (не запускать inject или uninject).

.EXAMPLE
    .\setup.ps1

.EXAMPLE
    .\setup.ps1 -Action Install -VencordPath "D:\dev\Vencord"

.EXAMPLE
    .\setup.ps1 -Action Uninstall
#>
[CmdletBinding()]
param(
    [ValidateSet("Install", "Update", "Uninstall", "Manual")]
    [string] $Action,

    [string] $VencordPath,
    [switch] $SkipInject
)

$ErrorActionPreference = "Stop"

$PluginName = "QuestCompleter"
$RepoSlug   = "flexeykinDev/vencord-quest-completer"
$RepoUrl    = "https://github.com/$RepoSlug.git"
$VencordUrl = "https://github.com/Vendicated/Vencord"

# ---------------------------------------------------------------- вывод

function Write-Step  ($text) { Write-Host ""; Write-Host "  > $text" -ForegroundColor Cyan }
function Write-Ok    ($text) { Write-Host "    $text" -ForegroundColor Green }
function Write-Note  ($text) { Write-Host "    $text" -ForegroundColor DarkGray }
function Write-Warn2 ($text) { Write-Host "    $text" -ForegroundColor Yellow }

function Write-Banner {
    Write-Host ""
    Write-Host "  ####################################################" -ForegroundColor DarkCyan
    Write-Host "  #                                                  #" -ForegroundColor DarkCyan
    Write-Host "  #            QUEST COMPLETER for Vencord           #" -ForegroundColor Cyan
    Write-Host "  #                                                  #" -ForegroundColor DarkCyan
    Write-Host "  ####################################################" -ForegroundColor DarkCyan
    Write-Host ""
}

function Stop-WithError ($text) {
    Write-Host ""
    Write-Host "  ОШИБКА: $text" -ForegroundColor Red
    Write-Host ""
    exit 1
}

function Confirm-Yes ($question) {
    $answer = Read-Host "    $question [y/N]"
    return ($answer -eq "y" -or $answer -eq "Y" -or $answer -eq "д" -or $answer -eq "Д")
}

function Test-Tool ($name) {
    return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Invoke-In ($dir, $exe, $argList) {
    Push-Location $dir
    try {
        & $exe @argList
        if ($LASTEXITCODE -ne 0) {
            Stop-WithError "Команда '$exe $($argList -join ' ')' завершилась с кодом $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Stop-DiscordIfRunning {
    if (-not (Get-Process -Name "Discord" -ErrorAction SilentlyContinue)) { return }

    Write-Warn2 "Discord запущен, а установщику Vencord лучше работать при закрытом."
    if (Confirm-Yes "Закрыть Discord?") {
        Stop-Process -Name "Discord" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

# ---------------------------------------------------------------- зависимости

function Update-PathFromRegistry {
    # winget добавляет инструменты в PATH, но текущее окно об этом ещё не знает
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Install-Prerequisite {
    param(
        [string] $Command,
        [string] $WingetId,
        [string] $Label,
        [string] $Site
    )

    Write-Warn2 "$Label не найден."

    if (-not (Test-Tool "winget")) {
        Stop-WithError "Нет ни $Label, ни winget. Поставь вручную: $Site"
    }

    if (-not (Confirm-Yes "Установить $Label автоматически через winget?")) {
        Stop-WithError "Без $Label ничего не выйдет. Поставить можно отсюда: $Site"
    }

    Write-Note "Ставлю $Label, это займёт пару минут..."
    winget install --id $WingetId --source winget --accept-package-agreements --accept-source-agreements --silent

    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "winget не справился с установкой $Label. Поставь вручную: $Site"
    }

    Update-PathFromRegistry

    if (-not (Test-Tool $Command)) {
        Stop-WithError "$Label установлен, но это окно его ещё не видит. Закрой PowerShell, открой заново и запусти скрипт ещё раз."
    }

    Write-Ok "$Label установлен"
}

function Assert-BuildTools {
    Write-Step "Проверяю инструменты"

    if (Test-Tool "git") {
        Write-Ok "git есть"
    } else {
        Install-Prerequisite -Command "git" -WingetId "Git.Git" -Label "Git" -Site "https://git-scm.com/download/win"
    }

    if (-not (Test-Tool "node")) {
        Install-Prerequisite -Command "node" -WingetId "OpenJS.NodeJS.LTS" -Label "Node.js" -Site "https://nodejs.org"
    }

    $nodeMajor = [int](((node -v) -replace "^v", "") -split "\.")[0]
    if ($nodeMajor -lt 20) {
        Write-Warn2 "Нужен Node.js 20 или новее, а сейчас $(node -v)."
        Install-Prerequisite -Command "node" -WingetId "OpenJS.NodeJS.LTS" -Label "Node.js LTS" -Site "https://nodejs.org"
    }
    Write-Ok "Node.js $(node -v)"

    if (-not (Test-Tool "pnpm")) {
        Write-Warn2 "pnpm не найден."
        if (-not (Confirm-Yes "Установить его через 'npm i -g pnpm'?")) {
            Stop-WithError "Без pnpm собрать Vencord не получится."
        }
        npm i -g pnpm
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось установить pnpm." }
        Update-PathFromRegistry
    }
    Write-Ok "pnpm $(pnpm -v)"
}

# ---------------------------------------------------------------- поиск Vencord

function Test-VencordRoot ($path) {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }

    $pkg = Join-Path $path "package.json"
    if (-not (Test-Path $pkg)) { return $false }

    try {
        return ((Get-Content $pkg -Raw | ConvertFrom-Json).name -eq "vencord")
    } catch {
        return $false
    }
}

function Resolve-VencordPath ([switch] $AllowClone) {
    Write-Step "Ищу папку с исходниками Vencord"

    $path = $script:VencordPath

    if (-not $path) {
        # Скрипт может лежать внутри уже установленного плагина:
        # <vencord>\src\userplugins\QuestCompleter\setup.ps1
        $maybeRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..") -ErrorAction SilentlyContinue
        if ($maybeRoot -and (Test-VencordRoot $maybeRoot.Path)) {
            $path = $maybeRoot.Path
            Write-Note "Скрипт запущен изнутри установленного плагина."
        }
    }

    if (Test-VencordRoot $path) {
        $resolved = (Resolve-Path $path).Path
        Write-Ok "Vencord: $resolved"
        return $resolved
    }

    if ($path) { Write-Warn2 "В '$path' исходников Vencord нет." }
    else { Write-Warn2 "Vencord не найден автоматически." }

    Write-Host ""
    if ($AllowClone) {
        Write-Note "Укажи путь к папке Vencord либо нажми Enter, чтобы скачать её заново."
    } else {
        Write-Note "Укажи путь к папке Vencord."
    }

    $entered = Read-Host "    Путь"

    if (-not [string]::IsNullOrWhiteSpace($entered)) {
        if (-not (Test-VencordRoot $entered)) {
            Stop-WithError "В '$entered' нет исходников Vencord (package.json с именем vencord)."
        }
        $resolved = (Resolve-Path $entered).Path
        Write-Ok "Vencord: $resolved"
        return $resolved
    }

    if (-not $AllowClone) { Stop-WithError "Без папки Vencord продолжать нечего." }

    $cloneTo = Read-Host "    Куда скачать Vencord (Enter = $HOME\Vencord)"
    if ([string]::IsNullOrWhiteSpace($cloneTo)) { $cloneTo = Join-Path $HOME "Vencord" }
    if (Test-Path $cloneTo) { Stop-WithError "Папка '$cloneTo' уже существует. Удали её или укажи другую." }

    Write-Step "Скачиваю Vencord"
    git clone $VencordUrl $cloneTo
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось склонировать Vencord." }

    $resolved = (Resolve-Path $cloneTo).Path
    Write-Ok "Vencord: $resolved"
    return $resolved
}

function Get-PluginDir ($vencordPath) {
    return (Join-Path $vencordPath "src\userplugins\$PluginName")
}

# ---------------------------------------------------------------- действия

function Invoke-Install {
    Write-Host "  Установка плагина $PluginName" -ForegroundColor White

    Assert-BuildTools
    $vencord = Resolve-VencordPath -AllowClone
    $pluginDir = Get-PluginDir $vencord

    Write-Step "Ставлю плагин в src\userplugins\$PluginName"

    if ($PSScriptRoot -eq $pluginDir) {
        Write-Note "Плагин уже на месте, скрипт запущен прямо из него."
        if (Test-Path (Join-Path $pluginDir ".git")) {
            git -C $pluginDir pull --ff-only
            if ($LASTEXITCODE -ne 0) { Write-Warn2 "Обновиться не вышло, продолжаю с тем, что есть." }
        }
    } elseif (Test-Path $pluginDir) {
        if (Test-Path (Join-Path $pluginDir ".git")) {
            Write-Note "Плагин уже установлен, обновляю..."
            git -C $pluginDir pull --ff-only
            if ($LASTEXITCODE -ne 0) { Write-Warn2 "Обновиться не вышло, продолжаю с тем, что есть." }
        } else {
            Write-Warn2 "Папка '$pluginDir' уже есть и это не git-репозиторий."
            if (-not (Confirm-Yes "Переименовать её в $PluginName.bak и поставить заново?")) {
                Stop-WithError "Отменено."
            }
            $backup = "$pluginDir.bak"
            if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
            Rename-Item $pluginDir $backup
            Write-Note "Старая версия сохранена в $backup"
        }
    }

    if (-not (Test-Path $pluginDir)) {
        New-Item -ItemType Directory -Force (Split-Path $pluginDir) | Out-Null

        if (Test-Tool "gh") {
            gh repo clone $RepoSlug $pluginDir
        } else {
            Write-Note "gh не найден, беру обычным git. Репозиторий приватный, могут спросить логин."
            git clone $RepoUrl $pluginDir
        }

        if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось скачать плагин." }
    }

    Write-Ok "Плагин на месте"

    Write-Step "Ставлю зависимости Vencord"
    Invoke-In $vencord "pnpm" @("i")

    Write-Step "Собираю Vencord вместе с плагином"
    Invoke-In $vencord "pnpm" @("build")
    Write-Ok "Сборка готова"

    if ($SkipInject) {
        Write-Step "Подключение к Discord пропущено (-SkipInject)"
    } else {
        Write-Step "Подключаю Vencord к Discord"
        Stop-DiscordIfRunning
        Invoke-In $vencord "pnpm" @("inject")
        Write-Ok "Подключено"
    }

    Write-Host ""
    Write-Host "  Готово." -ForegroundColor Green
    Write-Host @"

    Осталось три шага в самом Discord:

      1. Запусти Discord и нажми Ctrl+R
      2. Настройки -> Vencord -> Plugins -> включи $PluginName
      3. Ещё раз Ctrl+R

    Кнопка появится в панели аккаунта слева внизу, рядом с микрофоном.

"@ -ForegroundColor Gray
}

function Invoke-Update {
    Write-Host "  Обновление плагина $PluginName" -ForegroundColor White

    Assert-BuildTools
    $vencord = Resolve-VencordPath
    $pluginDir = Get-PluginDir $vencord

    if (-not (Test-Path $pluginDir)) { Stop-WithError "Плагин не установлен: '$pluginDir' не существует." }
    if (-not (Test-Path (Join-Path $pluginDir ".git"))) { Stop-WithError "'$pluginDir' не git-репозиторий, обновить нечем. Переустанови." }

    Write-Step "Забираю свежую версию плагина"
    git -C $pluginDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Stop-WithError "git pull не удался." }

    Write-Step "Пересобираю Vencord"
    Invoke-In $vencord "pnpm" @("i")
    Invoke-In $vencord "pnpm" @("build")

    Write-Host ""
    Write-Host "  Готово. Нажми Ctrl+R в Discord." -ForegroundColor Green
    Write-Host ""
}

function Invoke-Uninstall {
    Write-Host "  Удаление" -ForegroundColor White
    Write-Host @"

    Что убрать?

      1  Только плагин. Vencord и остальные плагины остаются
      2  Плагин и Vencord из Discord. Discord вернётся в исходный вид
      3  Всё, включая папку с исходниками Vencord и инструменты сборки
      0  Отмена

"@ -ForegroundColor Gray

    $choice = Read-Host "    Выбор"
    if ($choice -eq "0" -or [string]::IsNullOrWhiteSpace($choice)) { Write-Note "Отменено."; return }
    if ($choice -notin @("1", "2", "3")) { Stop-WithError "Не понял выбор '$choice'." }

    $vencord = Resolve-VencordPath
    $pluginDir = Get-PluginDir $vencord

    # --- сам плагин
    if (Test-Path $pluginDir) {
        Write-Step "Удаляю папку плагина"
        Remove-Item $pluginDir -Recurse -Force
        Write-Ok "Удалена"
    } else {
        Write-Note "Папки плагина и не было."
    }

    if ($choice -eq "1") {
        Write-Step "Пересобираю Vencord уже без плагина"
        Invoke-In $vencord "pnpm" @("build")

        Write-Host ""
        Write-Host "  Готово. Нажми Ctrl+R в Discord." -ForegroundColor Green
        Write-Host ""
        return
    }

    # --- Vencord из Discord
    if (-not $SkipInject) {
        Write-Step "Отключаю Vencord от Discord"
        Stop-DiscordIfRunning
        Invoke-In $vencord "pnpm" @("uninject")
        Write-Ok "Discord вернулся в исходный вид"
    }

    if ($choice -eq "2") {
        Write-Host ""
        Write-Host "  Готово. Папка с исходниками Vencord осталась: $vencord" -ForegroundColor Green
        Write-Host ""
        return
    }

    # --- папка Vencord
    Write-Step "Удаляю папку с исходниками Vencord"
    Write-Warn2 "Будет удалено целиком: $vencord"

    if (Confirm-Yes "Точно удалить эту папку?") {
        Set-Location $HOME
        Remove-Item $vencord -Recurse -Force
        Write-Ok "Удалена"
    } else {
        Write-Note "Папка оставлена."
    }

    # --- инструменты сборки
    Write-Host ""
    Write-Note "Node.js и Git остались в системе. Они нужны, если захочешь поставить Vencord снова."
    Write-Note "Полезны и сами по себе, места занимают немного, так что обычно их оставляют."

    if (Confirm-Yes "Всё равно удалить Node.js и Git через winget?") {
        if (Test-Tool "winget") {
            winget uninstall --id OpenJS.NodeJS.LTS --silent
            winget uninstall --id Git.Git --silent
            Write-Ok "Удалены"
        } else {
            Write-Warn2 "winget не найден, удали через Параметры -> Приложения."
        }
    }

    Write-Host ""
    Write-Host "  Готово." -ForegroundColor Green
    Write-Host ""
}

function Invoke-Manual {
    Write-Host @"
  Установка вручную

    1. Поставь Node.js 20+ и Git. winget встроен в Windows 11:

         winget install OpenJS.NodeJS.LTS
         winget install Git.Git

       После этого закрой и открой PowerShell заново, иначе команды
       node и git ещё не будут видны. Затем:

         npm i -g pnpm

    2. Скачай Vencord и поставь зависимости:

         git clone $VencordUrl
         cd Vencord
         pnpm i

    3. Положи плагин в папку пользовательских плагинов. Её нет после
       клонирования, потому что она в .gitignore самого Vencord:

         gh repo clone $RepoSlug src\userplugins\$PluginName

       Без gh, обычным git:

         git clone $RepoUrl src\userplugins\$PluginName

    4. Собери и подключи к Discord (Discord перед этим закрой):

         pnpm build
         pnpm inject

    5. Запусти Discord, Ctrl+R, Настройки -> Vencord -> Plugins,
       включи $PluginName, ещё раз Ctrl+R.

  Обновление

         git -C src\userplugins\$PluginName pull
         pnpm build

  Удаление

         Remove-Item src\userplugins\$PluginName -Recurse -Force
         pnpm build

       Чтобы убрать и сам Vencord из Discord:

         pnpm uninject

"@ -ForegroundColor Gray
}

# ---------------------------------------------------------------- меню

function Show-Menu {
    Write-Host @"
    1  Установить
    2  Обновить
    3  Удалить
    4  Показать инструкцию для ручной установки
    0  Выход

"@ -ForegroundColor Gray

    $choice = Read-Host "    Выбор"

    switch ($choice) {
        "1" { return "Install" }
        "2" { return "Update" }
        "3" { return "Uninstall" }
        "4" { return "Manual" }
        default { return $null }
    }
}

Write-Banner

if (-not $Action) {
    $Action = Show-Menu
    if (-not $Action) { Write-Note "Выход."; Write-Host ""; exit 0 }
}

switch ($Action) {
    "Install"   { Invoke-Install }
    "Update"    { Invoke-Update }
    "Uninstall" { Invoke-Uninstall }
    "Manual"    { Invoke-Manual }
}
