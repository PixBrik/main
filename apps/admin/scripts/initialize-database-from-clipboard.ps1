param(
  [string]$RecoveryFile
)

$ErrorActionPreference = 'Stop'

function Restore-ProcessEnvironment([hashtable]$Previous) {
  foreach ($name in $Previous.Keys) {
    if ($null -eq $Previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    else { Set-Item "Env:$name" $Previous[$name] }
  }
}

function Decode-UserInfo([uri]$Uri) {
  $parts = $Uri.UserInfo.Split(':', 2)
  if ($parts.Count -ne 2) { throw 'A runtime database URL is missing credentials.' }
  return @(
    [uri]::UnescapeDataString($parts[0]),
    [uri]::UnescapeDataString($parts[1])
  )
}

function Assert-RandomSecret([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[A-Za-z0-9_-]{43}$') { throw "$Label is not a canonical 32-byte base64url secret." }
}

if ($env:CI -and $env:ALLOW_CI_DATABASE_INITIALIZATION -ne '1') {
  throw 'Database initialization must run from a controlled shell, not CI.'
}
$settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Clipboard' -ErrorAction SilentlyContinue
if ($settings.EnableClipboardHistory -eq 1 -or $settings.EnableCloudClipboard -eq 1) {
  throw 'Disable Windows clipboard history and clipboard sync before handling database secrets.'
}

if (-not $RecoveryFile) {
  $recoveryDirectory = Join-Path $env:LOCALAPPDATA 'PixBrik\provisioning'
  $candidates = @(Get-ChildItem -LiteralPath $recoveryDirectory -Filter 'initial-*.dpapi' -File -ErrorAction SilentlyContinue)
  if ($candidates.Count -ne 1) {
    throw 'Pass -RecoveryFile with the exact encrypted one-time provisioning file.'
  }
  $RecoveryFile = $candidates[0].FullName
}
if (-not (Test-Path -LiteralPath $RecoveryFile)) {
  throw 'The encrypted provisioning recovery file does not exist.'
}

$encrypted = Get-Content -LiteralPath $RecoveryFile -Raw
$secure = ConvertTo-SecureString $encrypted
$secretJson = [Net.NetworkCredential]::new('', $secure).Password
$secrets = $secretJson | ConvertFrom-Json
if ($secrets.version -ne 1) { throw 'The encrypted provisioning bundle version is unsupported.' }

$roleNames = @(
  'pixbrik_migrator',
  'pixbrik_admin_runtime',
  'pixbrik_customer_runtime',
  'pixbrik_identity_runtime',
  'pixbrik_service_runtime'
)
foreach ($role in $roleNames) {
  $password = $secrets.passwords.$role
  Assert-RandomSecret $password "$role password"
}
if ($secrets.passwordPepper -notmatch '^v1:([A-Za-z0-9_-]{43})$') { throw 'The password pepper is malformed.' }
if ($secrets.sessionHmacKey -notmatch '^v1:([A-Za-z0-9_-]{43})$') { throw 'The session HMAC key is malformed.' }
if ($secrets.passwordPepper -eq $secrets.sessionHmacKey) { throw 'Authentication secrets must be different.' }

$clipboardBundle = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($clipboardBundle)) {
  throw 'The clipboard does not contain the Vercel runtime environment bundle.'
}
$allowed = @(
  'AUTH_MODE', 'APP_URL', 'AUTH_PASSWORD_PEPPER', 'AUTH_SESSION_HMAC_KEY',
  'ADMIN_DATABASE_URL', 'CUSTOMER_DATABASE_URL', 'IDENTITY_DATABASE_URL', 'SERVICE_DATABASE_URL'
)
$values = @{}
foreach ($rawLine in ($clipboardBundle -split "`r?`n")) {
  $line = $rawLine.Trim()
  if (-not $line) { continue }
  $separator = $line.IndexOf('=')
  if ($separator -lt 1) { throw 'The clipboard contains a malformed environment line.' }
  $name = $line.Substring(0, $separator)
  $value = $line.Substring($separator + 1)
  if ($allowed -notcontains $name -or [string]::IsNullOrWhiteSpace($value)) {
    throw "The clipboard contains an unexpected or empty variable: $name"
  }
  if ($values.ContainsKey($name)) { throw "The clipboard repeats a variable: $name" }
  $values[$name] = $value
}
foreach ($name in $allowed) {
  if (-not $values.ContainsKey($name)) { throw "The clipboard is missing: $name" }
}
if ($values.AUTH_MODE -ne 'password') { throw 'The runtime bundle is not configured for password authentication.' }
if ($values.APP_URL -ne 'https://pixbrik-backoffice.vercel.app/backoffice') { throw 'The runtime bundle has an unexpected admin URL.' }
if ($values.AUTH_PASSWORD_PEPPER -ne $secrets.passwordPepper) { throw 'The runtime password pepper does not match the encrypted bundle.' }
if ($values.AUTH_SESSION_HMAC_KEY -ne $secrets.sessionHmacKey) { throw 'The runtime session key does not match the encrypted bundle.' }

$databaseVariables = [ordered]@{
  ADMIN_DATABASE_URL = 'pixbrik_admin_runtime'
  CUSTOMER_DATABASE_URL = 'pixbrik_customer_runtime'
  IDENTITY_DATABASE_URL = 'pixbrik_identity_runtime'
  SERVICE_DATABASE_URL = 'pixbrik_service_runtime'
}
$databaseUris = @{}
$commonHost = $null
$commonPath = $null
$commonQuery = $null
foreach ($entry in $databaseVariables.GetEnumerator()) {
  try { $uri = [uri]$values[$entry.Key] } catch { throw "$($entry.Key) is not a valid URL." }
  if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw "$($entry.Key) must use PostgreSQL." }
  $credentials = Decode-UserInfo $uri
  if ($credentials[0] -ne $entry.Value) { throw "$($entry.Key) uses the wrong database role." }
  if ($credentials[1] -ne $secrets.passwords.($entry.Value)) { throw "$($entry.Key) does not match the encrypted role password." }
  $labels = $uri.Host.ToLowerInvariant().Split('.')
  if ($labels.Count -lt 3 -or -not $labels[0].EndsWith('-pooler') -or $labels[-2] -ne 'neon' -or $labels[-1] -ne 'tech') {
    throw "$($entry.Key) must use the pooled Neon runtime endpoint."
  }
  if ($null -eq $commonHost) {
    $commonHost = $uri.Host
    $commonPath = $uri.AbsolutePath
    $commonQuery = $uri.Query
  } elseif ($uri.Host -ne $commonHost -or $uri.AbsolutePath -ne $commonPath -or $uri.Query -ne $commonQuery) {
    throw 'All runtime database roles must reference the same Neon branch and database.'
  }
  $databaseUris[$entry.Key] = $uri
}

$adminUri = $databaseUris.ADMIN_DATABASE_URL
$builder = [UriBuilder]::new($adminUri)
$hostLabels = $builder.Host.Split('.')
$hostLabels[0] = $hostLabels[0].Substring(0, $hostLabels[0].Length - '-pooler'.Length)
$builder.Host = $hostLabels -join '.'
$builder.UserName = 'pixbrik_migrator'
$builder.Password = $secrets.passwords.pixbrik_migrator

$environmentNames = @(
  'MIGRATION_DATABASE_URL', 'IDENTITY_DATABASE_URL', 'AUTH_PASSWORD_PEPPER',
  'AUTH_PASSWORD_PEPPER_PREVIOUS', 'AUTH_SESSION_HMAC_KEY',
  'CONFIRM_OWNER_BOOTSTRAP', 'CONFIRM_TEMP_PASSWORD_OUTPUT'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$succeeded = $false
$adminRoot = Split-Path $PSScriptRoot -Parent
try {
  $env:MIGRATION_DATABASE_URL = $builder.Uri.AbsoluteUri
  $env:IDENTITY_DATABASE_URL = $values.IDENTITY_DATABASE_URL
  $env:AUTH_PASSWORD_PEPPER = $values.AUTH_PASSWORD_PEPPER
  Remove-Item 'Env:AUTH_PASSWORD_PEPPER_PREVIOUS' -ErrorAction SilentlyContinue
  $env:AUTH_SESSION_HMAC_KEY = $values.AUTH_SESSION_HMAC_KEY
  $env:CONFIRM_OWNER_BOOTSTRAP = 'sam@benisty.ca'
  $env:CONFIRM_TEMP_PASSWORD_OUTPUT = 'sam@benisty.ca'

  Push-Location $adminRoot
  try {
    & npm run db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed; encrypted recovery material was retained.' }
    & npm run auth:bootstrap-owner
    if ($LASTEXITCODE -ne 0) { throw 'Owner bootstrap failed; encrypted recovery material was retained.' }
  } finally {
    Pop-Location
  }
  $succeeded = $true
} finally {
  Restore-ProcessEnvironment $previousEnvironment
  $secretJson = $null
  $secrets = $null
  $clipboardBundle = $null
}

if ($succeeded) {
  Remove-Item -LiteralPath $RecoveryFile -Force
  # Windows PowerShell's Set-Clipboard rejects an empty string as null. A
  # single whitespace character reliably replaces the secret bundle and is
  # still treated as empty by every provisioning guard.
  Set-Clipboard -Value ' '
  Write-Output 'PixBrik database initialized. Temporary process variables, clipboard contents, and encrypted recovery material were removed.'
}
