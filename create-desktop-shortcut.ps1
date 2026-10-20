$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$ShortcutPath = Join-Path $DesktopPath "DeviceBridge.lnk"
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$ProjectDir\launch-silent.vbs`""
$Shortcut.WorkingDirectory = $ProjectDir
$Shortcut.Description = "DeviceBridge - Cross-Device Windows & Phone Transfer"
$Shortcut.Save()

Write-Host "Created Desktop Shortcut: $ShortcutPath" -ForegroundColor Green
