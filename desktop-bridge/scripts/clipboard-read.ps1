# Returns the current clipboard TEXT as raw UTF-8 bytes on stdout.
# Non-text clipboards (images, files) yield empty output. Kept pure ASCII:
# PowerShell 5.1 reads BOM-less scripts in the ANSI codepage.

$ErrorActionPreference = 'Stop'
try {
    $t = Get-Clipboard -Raw -Format Text
    if ($null -eq $t) { $t = '' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($t)
    [System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
    exit 0
} catch {
    [System.Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
