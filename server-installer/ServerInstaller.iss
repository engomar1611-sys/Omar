; NEW FEED ERP server application installer.
#define MyAppName "NEW FEED ERP Server"
#define MyAppVersion "0.2.0"
[Setup]
AppId={{D8B87B9A-40E5-4CFB-94B4-7F3D58B4A9F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=NEW FEED ERP
DefaultDirName={autopf}\NEW FEED ERP Server
DefaultGroupName=NEW FEED ERP Server
OutputDir=..\dist
OutputBaseFilename=NEW-FEED-ERP-Server-Setup-{#MyAppVersion}
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
PrivilegesRequired=admin
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
[Files]
Source: "..\dist\server-payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "configure-server.ps1"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\إعداد خادم NEW FEED ERP"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure-server.ps1"""; WorkingDir: "{app}"
[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure-server.ps1"""; WorkingDir: "{app}"; Flags: postinstall waituntilterminated runascurrentuser; Description: "إعداد قاعدة البيانات وتشغيل خدمة NEW FEED ERP"

[UninstallRun]
Filename: "{app}\NewFeedERPService.exe"; Parameters: "stop"; Flags: runhidden
Filename: "{app}\NewFeedERPService.exe"; Parameters: "uninstall"; Flags: runhidden
