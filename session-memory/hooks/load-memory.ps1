# session-memory plugin - SessionStart hook.
# Loads global + project memory files and emits {"additionalContext": "..."} on stdout.
# Kept pure ASCII on purpose: Windows PowerShell 5.1 reads BOM-less scripts in the
# ANSI codepage, so non-ASCII literals here would garble. Memory file content is
# read as UTF-8 and escaped to \uXXXX on output, which is safe under any codepage.
# Any failure exits 0 silently - a memory hook must never break session start.

$ErrorActionPreference = 'SilentlyContinue'
$PerFileCap = 8000

function Escape-Json([string]$text) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"additionalContext":"')
    foreach ($ch in $text.ToCharArray()) {
        $code = [int]$ch
        if ($ch -eq '"') { [void]$sb.Append('\"') }
        elseif ($ch -eq '\') { [void]$sb.Append('\\') }
        elseif ($ch -eq "`n") { [void]$sb.Append('\n') }
        elseif ($ch -eq "`t") { [void]$sb.Append('\t') }
        elseif ($code -lt 32 -or $code -gt 126) { [void]$sb.Append(('\u{0:x4}' -f $code)) }
        else { [void]$sb.Append($ch) }
    }
    [void]$sb.Append('"}')
    return $sb.ToString()
}

function Read-MemoryFile([string]$path) {
    if (-not $path) { return $null }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($content)) { return $null }
    $content = $content.Replace("`r`n", "`n").Trim()
    if ($content.Length -gt $PerFileCap) {
        $content = $content.Substring(0, $PerFileCap) + "`n[session-memory] file truncated at $PerFileCap chars - run /memory to clean it up"
    }
    return $content
}

try {
    $globalPath = Join-Path $env:USERPROFILE '.zcode\memory\GLOBAL.md'
    $projectDir = $env:ZCODE_PROJECT_DIR
    if (-not $projectDir) { $projectDir = $env:CLAUDE_PROJECT_DIR }
    $projectPath = $null
    if ($projectDir) { $projectPath = Join-Path $projectDir '.zcode\memory.md' }

    $sections = @()
    $pathLines = @()

    if ($globalPath) {
        $pathLines += ('- global (all projects): ' + $globalPath)
        $loaded = Read-MemoryFile $globalPath
        if ($loaded) { $sections += ("== global memory ==`n" + $loaded) }
    }
    if ($projectPath) {
        $pathLines += ('- project (this workspace): ' + $projectPath)
        $loaded = Read-MemoryFile $projectPath
        if ($loaded) { $sections += ("== project memory ==`n" + $loaded) }
    }

    if ($sections.Count -gt 0) {
        $header = "[session-memory] Loaded saved memory below. When the user asks to remember something or makes a long-term decision, update the matching file (rewrite stale entries instead of appending forever; never store secrets).`nMemory files:`n" + ($pathLines -join "`n")
        [Console]::Out.Write((Escape-Json ($header + "`n`n" + ($sections -join "`n`n"))))
    }
} catch { }
exit 0
