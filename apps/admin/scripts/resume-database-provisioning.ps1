param(
  [Parameter(Mandatory = $true)]
  [string]$RecoveryFile,
  [switch]$ApplyRoles
)

$ErrorActionPreference = 'Stop'

$settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Clipboard' -ErrorAction SilentlyContinue
if ($settings.EnableClipboardHistory -eq 1 -or $settings.EnableCloudClipboard -eq 1) {
  throw 'Disable Windows clipboard history and clipboard sync before handling database secrets.'
}
if (-not (Test-Path -LiteralPath $RecoveryFile)) {
  throw 'The encrypted provisioning recovery file does not exist.'
}
$directOwnerUrl = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($directOwnerUrl)) {
  throw 'Copy the Neon owner direct connection URL to the clipboard first.'
}

$names = @(
  'PROVISIONING_DATABASE_URL',
  'PROVISIONING_SECRETS_BUNDLE',
  'CONFIRM_DATABASE_PROVISIONING',
  'CONFIRM_PROVISIONING_BUNDLE_OUTPUT'
)
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
  $encrypted = Get-Content -LiteralPath $RecoveryFile -Raw
  $secure = ConvertTo-SecureString $encrypted
  $secretJson = [Net.NetworkCredential]::new('', $secure).Password
  $env:PROVISIONING_DATABASE_URL = $directOwnerUrl.Trim()
  $env:PROVISIONING_SECRETS_BUNDLE = $secretJson
  $env:CONFIRM_PROVISIONING_BUNDLE_OUTPUT = 'clipboard'
  $mode = '--render'
  if ($ApplyRoles) {
    $env:CONFIRM_DATABASE_PROVISIONING = 'pixbrik-backoffice'
    $mode = '--apply'
  }

  $adminRoot = Split-Path $PSScriptRoot -Parent
  Push-Location $adminRoot
  try {
    $vercelBundle = & node '.\scripts\provision-database-roles.mjs' $mode
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($vercelBundle)) {
      throw 'The provisioning bundle could not be recovered.'
    }
  } finally {
    Pop-Location
  }
  Set-Clipboard -Value ($vercelBundle -join "`n")
  Write-Output 'The clipboard now contains the recovered Vercel runtime variables only.'
} finally {
  foreach ($name in $names) {
    if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $previous[$name] }
  }
  $directOwnerUrl = $null
  $secretJson = $null
  $vercelBundle = $null
}
