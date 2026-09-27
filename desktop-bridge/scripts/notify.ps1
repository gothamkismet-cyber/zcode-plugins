# Shows a Windows toast notification. Title/Message arrive as UTF-16 argv
# (Unicode-safe); text nodes handle XML escaping internally.
# Uses the WindowsPowerShell AppUserModelID so the toast is allowed to show.

param(
    [string]$Title = 'ZCode',
    [string]$Message = ''
)

$ErrorActionPreference = 'Stop'
try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $xml.GetElementsByTagName('text')
    [void]$texts.Item(0).AppendChild($xml.CreateTextNode($Title))
    [void]$texts.Item(1).AppendChild($xml.CreateTextNode($Message))
    $toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    exit 0
} catch {
    [System.Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
