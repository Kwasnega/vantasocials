$ErrorActionPreference = "Stop"
$approvedOrderId = "ab1030cc-41b9-4f57-bae8-4226d9f6423d"
$envValues = @{}

foreach ($line in Get-Content ".env.local") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $value = $Matches[2].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $envValues[$Matches[1]] = $value
    }
}

if ($envValues["PANELS_LIVE_FULFILLMENT_ENABLED"] -ne "true") {
    throw "PANELS_LIVE_FULFILLMENT_ENABLED must be true before the controlled canary."
}
if ($envValues["R4_TEST_MODE"] -ne "false") {
    throw "R4_TEST_MODE must remain false."
}
if ($envValues["RELIABLESMM_CANARY_ORDER_ID"] -ne $approvedOrderId) {
    throw "The configured canary pin does not match the approved order."
}

$listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $listener) {
    throw "No local server is listening on port 3000."
}

$projectPath = (Resolve-Path ".").Path.TrimEnd("\")
$projectPathPattern = [regex]::Escape($projectPath)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
if (-not $serverProcess -or $serverProcess.CommandLine -notmatch $projectPathPattern -or $serverProcess.CommandLine -notmatch 'node_modules\\next') {
    throw "Port 3000 is not served by this VANTA Next.js project."
}

$serverStartedAt = [System.Management.ManagementDateTimeConverter]::ToDateTime($serverProcess.CreationDate)
if ($serverStartedAt -lt (Get-Item ".env.local").LastWriteTime) {
    throw "The VANTA server started before .env.local was last changed. Restart it before the controlled canary."
}

$secureSecret = Read-Host "Enter CRON_SECRET" -AsSecureString
$secretPointer = [IntPtr]::Zero
$cronSecret = $null
$responseStatus = "NO_HTTP_RESPONSE"
$responseBody = ""

try {
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
    $cronSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    $response = Invoke-WebRequest `
        -Uri "http://127.0.0.1:3000/api/internal/fulfillment/canary" `
        -Method Post `
        -Headers @{ Authorization = "Bearer $cronSecret" } `
        -ContentType "application/json" `
        -Body "{`"orderId`":`"$approvedOrderId`"}" `
        -TimeoutSec 90 `
        -UseBasicParsing `
        -ErrorAction Stop

    $responseStatus = [int]$response.StatusCode
    $responseBody = [string]$response.Content
}
catch {
    $webResponse = $_.Exception.Response
    if ($webResponse) {
        try {
            $responseStatus = [int]$webResponse.StatusCode
        } catch {
            $responseStatus = "HTTP_ERROR"
        }

        try {
            if ($webResponse -is [System.Net.Http.HttpResponseMessage]) {
                $responseBody = $webResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            } elseif ($webResponse -is [System.Net.HttpWebResponse]) {
                $reader = [System.IO.StreamReader]::new($webResponse.GetResponseStream())
                $responseBody = $reader.ReadToEnd()
                $reader.Dispose()
            }
        } catch {
            $responseBody = '{"error":"Response body could not be read."}'
        }
    } elseif ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $responseBody = [string]$_.ErrorDetails.Message
    } else {
        $responseBody = '{"error":"Request failed before an HTTP response was received."}'
    }
}
finally {
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
    $cronSecret = $null
    $secureSecret.Dispose()
}

$responseBody = $responseBody `
    -replace '(?i)Bearer\s+[A-Za-z0-9._~+/-]+=*', 'Bearer [redacted]' `
    -replace '(?i)https?://[^\s"\\]+', '[URL redacted]' `
    -replace '(?i)("?(?:secret|authorization|api[_-]?key|token)"?\s*:\s*")[^"]*(")', '$1[redacted]$2'

Write-Output "HTTP status: $responseStatus"
Write-Output "Sanitized response body:"
Write-Output $responseBody
