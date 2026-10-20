Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strCurrentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Run launch.bat silently without keeping an empty cmd terminal window pinned
WshShell.CurrentDirectory = strCurrentDir
WshShell.Run "cmd /c """ & strCurrentDir & "\launch.bat""", 0, False
