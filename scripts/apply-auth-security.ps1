# Applies college-safety Auth settings for CampusPulse.
# Usage (PowerShell):
#   $env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
#   .\scripts\apply-auth-security.ps1
# Revoke the token afterward.

$ErrorActionPreference = "Stop"
$token = $env:SUPABASE_ACCESS_TOKEN
if (-not $token) { throw "Set SUPABASE_ACCESS_TOKEN first (short-lived personal access token)." }

$project = "zqljaarwncamxqxawcxd"
$uri = "https://api.supabase.com/v1/projects/$project/config/auth"
$headers = @{
  Authorization = "Bearer $token"
  "Content-Type" = "application/json"
}

# Invite-only Auth, tight redirects, 72-hour invite/reset links, standard password length.
$body = @{
  disable_signup = $true
  mailer_autoconfirm = $false
  mailer_otp_exp = 259200
  password_min_length = 8
  # password_hibp_enabled requires Pro plan; enable in dashboard after upgrade
  site_url = "https://sygnetta.vercel.app/software/"
  uri_allow_list = @(
    "https://sygnetta.vercel.app/software/**",
    "http://localhost:3000/software/**",
    "http://127.0.0.1:3000/software/**"
  ) -join ","
} | ConvertTo-Json

try {
  $res = Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -Body $body
  Write-Host "disable_signup=$($res.disable_signup)"
  Write-Host "mailer_otp_exp=$($res.mailer_otp_exp)"
  Write-Host "password_min_length=$($res.password_min_length)"
  Write-Host "password_hibp_enabled=$($res.password_hibp_enabled)"
  Write-Host "site_url=$($res.site_url)"
  Write-Host "uri_allow_list=$($res.uri_allow_list)"
} catch {
  Write-Host $_.ErrorDetails.Message
  throw
}
