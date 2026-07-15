$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
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

Push-Location (Join-Path $projectRoot 'catalog')
try {
    & $pythonCommand -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) {
        throw 'Catalog verification failed.'
    }
}
finally {
    Pop-Location
}

Push-Location (Join-Path $projectRoot 'apps\mobile')
try {
    & npm run check
    if ($LASTEXITCODE -ne 0) {
        throw 'Mobile type or fixture checks failed.'
    }

    & npx expo-doctor
    if ($LASTEXITCODE -ne 0) {
        throw 'Expo project checks failed.'
    }
}
finally {
    Pop-Location
}

Write-Host 'Fotobrik catalog and mobile checks passed.'
