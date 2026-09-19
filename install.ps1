<#
.SYNOPSIS
    Устанавливает плагин QuestCompleter в Vencord.

.DESCRIPTION
    Auto   — делает всё сам: проверяет инструменты, находит или клонирует Vencord,
             кладёт плагин в src/userplugins, собирает и патчит Discord.
    Manual — ничего не делает, просто печатает пошаговую инструкцию с командами.

.PARAMETER VencordPath
    Путь к папке с исходниками Vencord. Если не указан, скрипт попробует найти её сам.

.PARAMETER Manual
    Показать инструкцию вместо установки.

.PARAMETER SkipInject
    Не запускать "pnpm inject" (если Vencord уже вживлён в Discord).

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -VencordPath "D:\dev\Vencord"

.EXAMPLE
    .\install.ps1 -Manual
#>
[CmdletBinding()]
param(
    [string] $VencordPath,
    [switch] $Manual,
    [switch] $SkipInject
)

$ErrorActionPreference = "Stop"

$PluginName = "QuestCompleter"
$RepoSlug   = "flexeykinDev/vencord-quest-completer"
$RepoUrl    = "https://github.com/$RepoSlug.git"
$VencordUrl = "https://github.com/Vendicated/Vencord"

# ---------------------------------------------------------------- вывод

function Write-Step  ($text) { Write-Host ""; Write-Host ">> $text" -ForegroundColor Cyan }
function Write-Ok    ($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Note  ($text) { Write-Host "   $text" -ForegroundColor DarkGray }
function Write-Warn2 ($text) { Write-Host "   $text" -ForegroundColor Yellow }

function Stop-WithError ($text) {
    Write-Host ""
    Write-Host "ОШИБКА: $text" -ForegroundColor Red
    exit 1
}

function Confirm-Yes ($question) {
    $answer = Read-Host "   $question [y/N]"
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

# ---------------------------------------------------------------- ручной режим

if ($Manual) {
    Write-Host ""
    Write-Host "=== Установка $PluginName вручную ===" -ForegroundColor Cyan
    Write-Host @"

  1. Поставь Node.js 20+ и git, затем pnpm:

         npm i -g pnpm

  2. Склонируй Vencord и установи зависимости:

         git clone $VencordUrl
         cd Vencord
         pnpm i

  3. Положи плагин в папку пользовательских плагинов
     (она в .gitignore, поэтому её надо создать самому):

         gh repo clone $RepoSlug src\userplugins\$PluginName

     Без gh, обычным git:

         git clone $RepoUrl src\userplugins\$PluginName

  4. Собери:

         pnpm build

  5. Вживи Vencord в Discord (Discord перед этим закрой):

         pnpm inject

  6. Запусти Discord, нажми Ctrl+R, зайди в
     Настройки -> Vencord -> Plugins и включи $PluginName.
     Ещё раз Ctrl+R — кнопка появится рядом с микрофоном.

  Обновление плагина позже:

         git -C src\userplugins\$PluginName pull
         pnpm build

"@ -ForegroundColor Gray
    exit 0
}

# ---------------------------------------------------------------- проверка инструментов

Write-Host ""
Write-Host "=== Установка плагина $PluginName в Vencord ===" -ForegroundColor Cyan

Write-Step "Проверяю инструменты"

if (-not (Test-Tool "git"))  { Stop-WithError "Не найден git. Поставь с https://git-scm.com/download/win и запусти скрипт заново." }
Write-Ok "git есть"

if (-not (Test-Tool "node")) { Stop-WithError "Не найден Node.js. Поставь LTS с https://nodejs.org и запусти скрипт заново." }

$nodeMajor = [int](((node -v) -replace "^v", "") -split "\.")[0]
if ($nodeMajor -lt 20) { Stop-WithError "Нужен Node.js 20 или новее, а сейчас $(node -v)." }
Write-Ok "Node.js $(node -v)"

if (-not (Test-Tool "pnpm")) {
    Write-Warn2 "pnpm не найден."
    if (-not (Confirm-Yes "Установить его через 'npm i -g pnpm'?")) {
        Stop-WithError "Без pnpm собрать Vencord не получится."
    }
    npm i -g pnpm
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось установить pnpm." }
}
Write-Ok "pnpm $(pnpm -v)"

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

Write-Step "Ищу папку с исходниками Vencord"

if (-not $VencordPath) {
    # Если скрипт уже лежит внутри Vencord (src\userplugins\QuestCompleter\install.ps1),
    # то корень — три уровня вверх.
    $maybeRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..") -ErrorAction SilentlyContinue
    if ($maybeRoot -and (Test-VencordRoot $maybeRoot.Path)) {
        $VencordPath = $maybeRoot.Path
        Write-Note "Скрипт запущен изнутри уже установленного плагина."
    }
}

if (-not (Test-VencordRoot $VencordPath)) {
    if ($VencordPath) { Write-Warn2 "В '$VencordPath' исходников Vencord нет." }
    else { Write-Warn2 "Vencord не найден автоматически." }

    Write-Host ""
    Write-Host "   Укажи путь к папке Vencord либо оставь пустым, чтобы склонировать заново." -ForegroundColor Gray
    $entered = Read-Host "   Путь"

    if ([string]::IsNullOrWhiteSpace($entered)) {
        $cloneTo = Read-Host "   Куда клонировать Vencord (Enter = $HOME\Vencord)"
        if ([string]::IsNullOrWhiteSpace($cloneTo)) { $cloneTo = Join-Path $HOME "Vencord" }

        if (Test-Path $cloneTo) { Stop-WithError "Папка '$cloneTo' уже существует. Удали её или укажи другую." }

        Write-Step "Клонирую Vencord"
        git clone $VencordUrl $cloneTo
        if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось склонировать Vencord." }

        $VencordPath = (Resolve-Path $cloneTo).Path
    } else {
        if (-not (Test-VencordRoot $entered)) { Stop-WithError "В '$entered' нет исходников Vencord (package.json с именем vencord)." }
        $VencordPath = (Resolve-Path $entered).Path
    }
}

Write-Ok "Vencord: $VencordPath"

# ---------------------------------------------------------------- сам плагин

$pluginDir = Join-Path $VencordPath "src\userplugins\$PluginName"
$scriptIsInsideTarget = ($PSScriptRoot -eq $pluginDir)

Write-Step "Ставлю плагин в src\userplugins\$PluginName"

if ($scriptIsInsideTarget) {
    Write-Note "Плагин уже на месте, скрипт запущен прямо из него."

    if (Test-Path (Join-Path $pluginDir ".git")) {
        Write-Note "Тяну обновления..."
        git -C $pluginDir pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Обновиться не вышло, продолжаю с тем, что есть." }
    }
} elseif (Test-Path $pluginDir) {
    if (Test-Path (Join-Path $pluginDir ".git")) {
        Write-Note "Плагин уже установлен, обновляю..."
        git -C $pluginDir pull --ff-only
        if ($LASTEXITCODE -ne 0) { Write-Warn2 "Обновиться не вышло, продолжаю с тем, что есть." }
    } else {
        Write-Warn2 "Папка '$pluginDir' уже существует и это не git-репозиторий."
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
        Write-Note "gh не найден, клонирую обычным git (репозиторий приватный, могут спросить логин)."
        git clone $RepoUrl $pluginDir
    }

    if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось склонировать плагин." }
}

Write-Ok "Плагин на месте"

# ---------------------------------------------------------------- сборка

Write-Step "Ставлю зависимости Vencord (pnpm i)"
Invoke-In $VencordPath "pnpm" @("i")
Write-Ok "Зависимости готовы"

Write-Step "Собираю Vencord вместе с плагином (pnpm build)"
Invoke-In $VencordPath "pnpm" @("build")
Write-Ok "Сборка готова"

# ---------------------------------------------------------------- инжект

if ($SkipInject) {
    Write-Step "Инжект пропущен (-SkipInject)"
} else {
    Write-Step "Вживляю Vencord в Discord (pnpm inject)"

    if (Get-Process -Name "Discord" -ErrorAction SilentlyContinue) {
        Write-Warn2 "Discord сейчас запущен. Установщику лучше работать при закрытом Discord."
        if (Confirm-Yes "Закрыть Discord?") {
            Stop-Process -Name "Discord" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    }

    Invoke-In $VencordPath "pnpm" @("inject")
    Write-Ok "Готово"
}

# ---------------------------------------------------------------- итог

Write-Host ""
Write-Host "=== Установлено ===" -ForegroundColor Green
Write-Host @"

  Осталось сделать руками:

    1. Запусти Discord и нажми Ctrl+R.
    2. Настройки -> Vencord -> Plugins -> включи $PluginName.
    3. Ещё раз Ctrl+R.

  Кнопка появится в панели аккаунта слева внизу, рядом с микрофоном.

  Обновить плагин потом:

      git -C "$pluginDir" pull
      cd "$VencordPath"; pnpm build

"@ -ForegroundColor Gray
