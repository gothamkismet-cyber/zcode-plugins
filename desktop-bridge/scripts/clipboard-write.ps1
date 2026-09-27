# Reads UTF-8 text from stdin and puts it on the Windows clipboard.
# Raw stream input bypasses console codepage issues entirely.

$ErrorActionPreference = 'Stop'
try {
    $reader = New-Object System.IO.StreamReader([System.Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    Set-Clipboard -Value $text
    exit 0
} catch {
    [System.Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
