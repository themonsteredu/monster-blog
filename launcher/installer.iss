; installer.iss - build the customer setup file (Inno Setup script)
; 1) run build_exe.bat first (creates dist\MonsterBlog\)
; 2) install Inno Setup (https://jrsoftware.org/isinfo.php), open this file, press Compile
; Result: Output\MonsterBlogSetup.exe  -- send only this file to customers.

[Setup]
AppName=몬스터 블로그
AppVersion=3.0.0
AppPublisher=더몬스터학원
DefaultDirName={autopf}\MonsterBlog
DefaultGroupName=몬스터 블로그
DisableProgramGroupPage=yes
OutputBaseFilename=MonsterBlogSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "dist\MonsterBlog\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\몬스터 블로그"; Filename: "{app}\MonsterBlog.exe"
Name: "{autodesktop}\몬스터 블로그"; Filename: "{app}\MonsterBlog.exe"

[Run]
Filename: "{app}\MonsterBlog.exe"; Description: "지금 실행"; Flags: nowait postinstall skipifsilent
