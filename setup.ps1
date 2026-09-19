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

$ConfigFile = Join-Path $env:APPDATA "QuestCompleter\vencord-path.txt"

function Get-SavedVencordPath {
    if (-not (Test-Path $ConfigFile)) { return $null }
    try {
        $saved = (Get-Content $ConfigFile -Raw -Encoding UTF8).Trim()
        if (Test-VencordRoot $saved) { return $saved }
    } catch { }
    return $null
}

function Save-VencordPath ($path) {
    try {
        New-Item -ItemType Directory -Force (Split-Path $ConfigFile) | Out-Null
        Set-Content $ConfigFile $path -Encoding UTF8
    } catch {
        Write-Note "Путь не удалось запомнить, в следующий раз поищу заново."
    }
}

<#
    Пропатченный Discord хранит абсолютный путь к сборке Vencord у себя внутри:
    установщик подменяет resources\app.asar своей заглушкой с одной строкой
    require("...\dist\patcher.js"). Это самый надёжный способ найти папку, он не
    зависит от того, куда её положили. Путь записан с экранированными слешами,
    отсюда \\{1,2} в шаблоне.
#>
function Find-VencordFromDiscord {
    $pathPattern = '([A-Za-z]:(?:\\{1,2}|/)[^"\r\n\x00]*?)(?:\\{1,2}|/)dist(?:\\{1,2}|/)patcher\.js'

    $roots = @("Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment") |
        ForEach-Object { Join-Path $env:LOCALAPPDATA $_ }

    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }

        # app.asar это нынешний вариант, app\index.js остался от старых установок
        $candidates = @()
        $candidates += Get-ChildItem (Join-Path $root "app-*\resources\app.asar") -ErrorAction SilentlyContinue
        $candidates += Get-ChildItem (Join-Path $root "app-*\resources\app\index.js") -ErrorAction SilentlyContinue

        foreach ($file in $candidates) {
            try {
                $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
            } catch { continue }

            if ($text -match $pathPattern) {
                $candidate = $matches[1] -replace '\\\\', '\'
                if (Test-VencordRoot $candidate) { return $candidate }
            }
        }
    }

    return $null
}

function Find-VencordInCommonFolders {
    $names = @("Vencord", "Vencord-Custom-Plugin", "vencord")
    $bases = @(
        $HOME,
        (Join-Path $HOME "Documents"),
        (Join-Path $HOME "Desktop"),
        (Join-Path $HOME "Downloads"),
        (Join-Path $HOME "source\repos")
    )

    foreach ($base in $bases) {
        foreach ($name in $names) {
            $candidate = Join-Path $base $name
            if (Test-VencordRoot $candidate) { return $candidate }
        }
    }

    return $null
}

function Select-FolderDialog ($description) {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = $description
        $dialog.ShowNewFolderButton = $false

        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return $dialog.SelectedPath
        }
    } catch {
        Write-Note "Окно выбора папки не открылось, введи путь вручную."
        $entered = Read-Host "    Путь"
        if (-not [string]::IsNullOrWhiteSpace($entered)) { return $entered }
    }

    return $null
}

function Install-Vencord {
    $cloneTo = Join-Path $HOME "Vencord"

    Write-Note "Vencord будет скачан в: $cloneTo"
    if (Test-Path $cloneTo) {
        Stop-WithError "Папка '$cloneTo' уже существует, но Vencord в ней не найден. Удали её или запусти скрипт с -VencordPath."
    }

    if (-not (Confirm-Yes "Скачать Vencord сюда?")) {
        $picked = Select-FolderDialog "Выбери папку, в которую скачать Vencord"
        if (-not $picked) { return $null }
        $cloneTo = Join-Path $picked "Vencord"
        if (Test-Path $cloneTo) { Stop-WithError "Папка '$cloneTo' уже существует." }
    }

    Write-Step "Скачиваю Vencord"
    git clone $VencordUrl $cloneTo
    if ($LASTEXITCODE -ne 0) { Stop-WithError "Не удалось скачать Vencord." }

    return (Resolve-Path $cloneTo).Path
}

function Resolve-VencordPath ([switch] $AllowClone) {
    Write-Step "Ищу папку с исходниками Vencord"

    # 1. Путь из параметра
    if ($script:VencordPath) {
        if (-not (Test-VencordRoot $script:VencordPath)) {
            Stop-WithError "В '$($script:VencordPath)' нет исходников Vencord."
        }
        $found = (Resolve-Path $script:VencordPath).Path
        Write-Ok "Vencord: $found"
        Save-VencordPath $found
        return $found
    }

    # 2. Скрипт лежит внутри уже установленного плагина.
    # $PSScriptRoot пуст, если скрипт запустили не из файла, отсюда проверка.
    $maybeRoot = $null
    if ($PSScriptRoot) {
        $maybeRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..") -ErrorAction SilentlyContinue
    }
    if ($maybeRoot -and (Test-VencordRoot $maybeRoot.Path)) {
        Write-Note "Скрипт запущен изнутри установленного плагина."
        Write-Ok "Vencord: $($maybeRoot.Path)"
        Save-VencordPath $maybeRoot.Path
        return $maybeRoot.Path
    }

    # 3. Запомненный путь с прошлого раза
    $saved = Get-SavedVencordPath
    if ($saved) {
        Write-Note "Взял путь, запомненный при прошлой установке."
        Write-Ok "Vencord: $saved"
        return $saved
    }

    # 4. Путь, прописанный в самом пропатченном Discord
    $fromDiscord = Find-VencordFromDiscord
    if ($fromDiscord) {
        Write-Note "Нашёл по записи в установленном Discord."
        Write-Ok "Vencord: $fromDiscord"
        Save-VencordPath $fromDiscord
        return $fromDiscord
    }

    # 5. Обычные места
    $common = Find-VencordInCommonFolders
    if ($common) {
        Write-Note "Нашёл в обычном месте."
        Write-Ok "Vencord: $common"
        Save-VencordPath $common
        return $common
    }

    # 6. Спрашиваем
    Write-Warn2 "Vencord на компьютере не найден."
    Write-Host ""

    if ($AllowClone) {
        Write-Host "    1  Скачать Vencord (так и надо, если ставишь впервые)" -ForegroundColor Gray
        Write-Host "    2  Указать папку вручную, если Vencord уже есть" -ForegroundColor Gray
        Write-Host "    0  Отмена" -ForegroundColor Gray
        Write-Host ""

        $choice = Read-Host "    Выбор"
        if ($choice -eq "1" -or [string]::IsNullOrWhiteSpace($choice)) {
            $cloned = Install-Vencord
            if ($cloned) { Save-VencordPath $cloned }
            return $cloned
        }
        if ($choice -ne "2") { return $null }
    }

    $picked = Select-FolderDialog "Выбери папку с исходниками Vencord"
    if (-not $picked) { return $null }

    if (-not (Test-VencordRoot $picked)) {
        Stop-WithError "В '$picked' нет исходников Vencord. Нужна папка, внутри которой лежат package.json и src."
    }

    $found = (Resolve-Path $picked).Path
    Write-Ok "Vencord: $found"
    Save-VencordPath $found
    return $found
}

function Get-PluginDir ($vencordPath) {
    return (Join-Path $vencordPath "src\userplugins\$PluginName")
}

# ---------------------------------------------------------------- действия

function Invoke-Install {
    Write-Host "  Установка плагина $PluginName" -ForegroundColor White

    Assert-BuildTools
    $vencord = Resolve-VencordPath -AllowClone
    if (-not $vencord) { Write-Note "Отменено."; return }

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

        git clone $RepoUrl $pluginDir
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
    $vencord = Resolve-VencordPath -AllowClone
    if (-not $vencord) { Write-Note "Отменено."; return }

    $pluginDir = Get-PluginDir $vencord

    if (-not (Test-Path $pluginDir) -or -not (Test-Path (Join-Path $pluginDir ".git"))) {
        Write-Warn2 "Плагин ещё не установлен в эту папку Vencord."
        if (-not (Confirm-Yes "Установить его сейчас?")) { Write-Note "Отменено."; return }

        $script:VencordPath = $vencord
        Invoke-Install
        return
    }

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
    if (-not $vencord) { Write-Note "Отменено."; return }

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
        Remove-Item $ConfigFile -Force -ErrorAction SilentlyContinue
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
