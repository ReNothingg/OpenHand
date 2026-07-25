#define AppName "OpenHand"
#define AppVersion "1.0.0"
#define AppPublisher "OpenHand contributors"
#define AppExecutable "OpenHand.exe"

[Setup]
AppId={{2B82E8DB-FF87-48A0-A92E-79FFB52EB97F}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\OpenHand
DefaultGroupName=OpenHand
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\build
OutputBaseFilename=OpenHand-Setup-win-x64
SetupIconFile=..\app-icon.ico
UninstallDisplayIcon={app}\{#AppExecutable}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Files]
Source: "..\build\OpenHand-win-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\OpenHand"; Filename: "{app}\{#AppExecutable}"
Name: "{userdesktop}\OpenHand"; Filename: "{app}\{#AppExecutable}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"

[Registry]
Root: HKCU; Subkey: "Software\Classes\OpenHand.GCode"; ValueType: string; ValueData: "OpenHand G-code"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\OpenHand.GCode\DefaultIcon"; ValueType: string; ValueData: """{app}\{#AppExecutable}"",0"
Root: HKCU; Subkey: "Software\Classes\OpenHand.GCode\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExecutable}"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.gcode\OpenWithProgids"; ValueType: none; ValueName: "OpenHand.GCode"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.nc\OpenWithProgids"; ValueType: none; ValueName: "OpenHand.GCode"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.tap\OpenWithProgids"; ValueType: none; ValueName: "OpenHand.GCode"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\Applications\OpenHand.exe\SupportedTypes"; ValueType: string; ValueName: ".gcode"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\Applications\OpenHand.exe\SupportedTypes"; ValueType: string; ValueName: ".nc"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\Applications\OpenHand.exe\SupportedTypes"; ValueType: string; ValueName: ".tap"; ValueData: ""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExecutable}"; Description: "Запустить OpenHand"; Flags: nowait postinstall skipifsilent
