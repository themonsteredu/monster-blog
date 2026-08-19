; installer.iss — 설치파일 만들기 (Inno Setup 스크립트)
; 1) build_exe.bat 를 먼저 실행해 dist\MonsterBlog\ 를 만든 뒤,
; 2) Inno Setup(https://jrsoftware.org/isinfo.php 무료)을 설치하고 이 파일을 열어 Compile.
; 결과: Output\MonsterBlogSetup.exe — 고객에게 이 파일 하나만 보내면 됨.

[Setup]
AppName=몬스터 블로그 자동화
AppVersion=2.0.0
AppPublisher=더몬스터학원
DefaultDirName={autopf}\MonsterBlog
DefaultGroupName=몬스터 블로그 자동화
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
Name: "{group}\몬스터 블로그 자동화"; Filename: "{app}\MonsterBlog.exe"
Name: "{autodesktop}\몬스터 블로그 자동화"; Filename: "{app}\MonsterBlog.exe"

[Run]
Filename: "{app}\MonsterBlog.exe"; Description: "지금 실행"; Flags: nowait postinstall skipifsilent
