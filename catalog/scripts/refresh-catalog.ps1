param(
    [Parameter(Mandatory = $true)]
    [string] $PartsFeed,

    [string] $CommunityFeed,

    [string] $SourceVersion = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'),

    [string] $CommunityVersion = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'),

    [string] $Database,

    [string] $Export
)

$ErrorActionPreference = 'Stop'

$catalogRoot = Split-Path -Parent $PSScriptRoot
$buildDirectory = Join-Path $catalogRoot 'build'
$pythonCommand = $env:FOTOBRIK_PYTHON

if (-not $pythonCommand) {
    foreach ($candidate in @('python', 'python3', 'py')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $command) {
            continue
        }

        & $command.Source --version *> $null
        if ($LASTEXITCODE -eq 0) {
            $pythonCommand = $command.Source
            break
        }
    }
}

if (-not $pythonCommand) {
    throw 'Python 3.11+ was not found. Put it on PATH or set FOTOBRIK_PYTHON to the executable path.'
}

if (-not $Database) {
    $Database = Join-Path $buildDirectory 'catalog.sqlite3'
}

if (-not $Export) {
    $Export = Join-Path $buildDirectory 'elements.jsonl'
}

if (-not (Test-Path -LiteralPath $PartsFeed -PathType Container)) {
    throw "Parts feed directory does not exist: $PartsFeed"
}

if ($CommunityFeed -and -not (Test-Path -LiteralPath $CommunityFeed -PathType Container)) {
    throw "Community feed directory does not exist: $CommunityFeed"
}

New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

Push-Location $catalogRoot
try {
    $updateArguments = @(
        '-m', 'fotobrik_catalog', 'update',
        '--db', $Database,
        '--rebrickable', $PartsFeed,
        '--source-version', $SourceVersion
    )

    if ($CommunityFeed) {
        $updateArguments += @(
            '--community', $CommunityFeed,
            '--community-version', $CommunityVersion
        )
    }

    & $pythonCommand @updateArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Catalog update failed; no export was published.'
    }

    & $pythonCommand -m fotobrik_catalog check --db $Database
    if ($LASTEXITCODE -ne 0) {
        throw 'Catalog integrity check failed; no export was published.'
    }

    & $pythonCommand -m fotobrik_catalog export --db $Database --output $Export --format jsonl
    if ($LASTEXITCODE -ne 0) {
        throw 'Catalog export failed.'
    }
}
finally {
    Pop-Location
}

Write-Host "Catalog ready: $Database"
Write-Host "Element export ready: $Export"
