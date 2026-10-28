; Instalador de Windows (Inno Setup 6). Lo compila construir_windows.bat después de PyInstaller.
; Se instala para el usuario actual (sin pedir permisos de administrador) en
; %LOCALAPPDATA%\Programs\Diagramas electricos. Los diagramas viven aparte, en
; %LOCALAPPDATA%\DiagramasElectricos, y no se borran al desinstalar.

#define AppName "Diagramas eléctricos"
#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif

[Setup]
AppId={{6A0E3D2B-5C1F-4E8B-9B7A-2D4F8C1E9A31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Diagramas eléctricos
DefaultDirName={autopf}\Diagramas electricos
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=DiagramasElectricos-{#AppVersion}-instalador
SetupIconFile=icono.ico
UninstallDisplayIcon={app}\DiagramasElectricos.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\DiagramasElectricos\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\DiagramasElectricos.exe"
Name: "{group}\Desinstalar {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\DiagramasElectricos.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DiagramasElectricos.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
