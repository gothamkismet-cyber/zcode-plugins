# Opens a URL / folder / file with the system default handler.
# Guardrails (denylisted extensions, protocol allowlist) are enforced in the
# node layer before this script is ever invoked.

param(
    [string]$Target = ''
)

$ErrorActionPreference = 'Stop'
try {
    Start-Process $Target | Out-Null
    exit 0
} catch {
    [System.Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
