# Emits machine info as JSON (UTF-8 raw stdout). ConvertTo-Json escapes
# non-ASCII to \uXXXX, so the output is codepage-safe regardless.

$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{
        drive   = $_.DeviceID
        total_gb = [math]::Round($_.Size / 1GB, 1)
        free_gb  = [math]::Round($_.FreeSpace / 1GB, 1)
    }
}
$uptimeHours = $null
if ($os -and $os.LastBootUpTime) {
    $uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
}
$info = [ordered]@{
    host         = $env:COMPUTERNAME
    user         = $env:USERNAME
    os           = $os.Caption
    os_version   = $os.Version
    model        = ($cs.Manufacturer + ' ' + $cs.Model).Trim()
    cpu          = $cpu.Name
    cpu_load_pct = $cpu.LoadPercentage
    ram_total_gb = if ($cs.TotalPhysicalMemory) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { $null }
    ram_free_gb  = if ($os.FreePhysicalMemory) { [math]::Round($os.FreePhysicalMemory / 1KB / 1024, 1) } else { $null }
    last_boot    = $os.LastBootUpTime
    uptime_hours = $uptimeHours
    disks        = @($disks)
}
$json = $info | ConvertTo-Json -Depth 3
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
[System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
exit 0
