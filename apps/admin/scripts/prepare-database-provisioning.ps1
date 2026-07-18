$ErrorActionPreference = 'Stop'

function Assert-ClipboardHistoryDisabled {
  $settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Clipboard' -ErrorAction SilentlyContinue
  if ($settings.EnableClipboardHistory -eq 1 -or $settings.EnableCloudClipboard -eq 1) {
    throw 'Disable Windows clipboard history and clipboard sync before handling database secrets.'
  }
}

function Restore-ProcessEnvironment([hashtable]$Previous) {
  foreach ($name in $Previous.Keys) {
    if ($null -eq $Previous[$name]) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item "Env:$name" $Previous[$name]
    }
  }
}

if ($env:CI -and $env:ALLOW_CI_DATABASE_PROVISIONING -ne '1') {
  throw 'Database provisioning must run from a controlled shell, not CI.'
}
Assert-ClipboardHistoryDisabled

$directOwnerUrl = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($directOwnerUrl)) {
  throw 'Copy the Neon owner direct connection URL to the clipboard first.'
}

$environmentNames = @(
  'PROVISIONING_DATABASE_URL',
  'PROVISIONING_SECRETS_BUNDLE',
  'CONFIRM_DATABASE_PROVISIONING',
  'CONFIRM_PROVISIONING_BUNDLE_OUTPUT'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$adminRoot = Split-Path $PSScriptRoot -Parent
$recoveryDirectory = Join-Path $env:LOCALAPPDATA 'PixBrik\provisioning'
$recoveryFile = Join-Path $recoveryDirectory ("initial-{0}.dpapi" -f [guid]::NewGuid().ToString('N'))
$secretJson = $null
$vercelBundle = $null

try {
  New-Item -ItemType Directory -Path $recoveryDirectory -Force | Out-Null
  Push-Location $adminRoot
  try {
    $env:CONFIRM_PROVISIONING_BUNDLE_OUTPUT = 'clipboard'
    $secretJson = & node '.\scripts\provision-database-roles.mjs' '--prepare'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($secretJson)) {
      throw 'Secret preparation failed before any database role was created.'
    }

    $secureBundle = ConvertTo-SecureString $secretJson -AsPlainText -Force
    ConvertFrom-SecureString $secureBundle | Set-Content -LiteralPath $recoveryFile -NoNewline -Encoding utf8
    if (-not (Test-Path -LiteralPath $recoveryFile)) {
      throw 'The encrypted recovery bundle could not be persisted before provisioning.'
    }

    $env:PROVISIONING_DATABASE_URL = $directOwnerUrl.Trim()
    $env:PROVISIONING_SECRETS_BUNDLE = $secretJson
    $env:CONFIRM_DATABASE_PROVISIONING = 'pixbrik-backoffice'
    $vercelBundle = & node '.\scripts\provision-database-roles.mjs' '--apply'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vercelBundle)) {
      throw "Role provisioning failed. Keep the encrypted recovery file: $recoveryFile"
    }
  } finally {
    Pop-Location
  }

  try {
    Set-Clipboard -Value ($vercelBundle -join "`n")
  } catch {
    throw "Roles were created but clipboard delivery failed. Recover with: $recoveryFile"
  }
  Write-Output 'PixBrik roles created. The clipboard now contains runtime variables only.'
  Write-Output "Encrypted one-time recovery file: $recoveryFile"
  Write-Output 'Import the clipboard into Vercel Production only, then run initialize-database-from-clipboard.ps1.'
} finally {
  Restore-ProcessEnvironment $previousEnvironment
  $directOwnerUrl = $null
  $secretJson = $null
  $vercelBundle = $null
}
