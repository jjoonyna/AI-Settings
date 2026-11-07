#define AppVersion Version
[Setup]
AppName=AI-Settings
AppVersion={#AppVersion}
VersionInfoVersion={#Copy(Version, 2, Len(Version))}
DefaultDirName={tmp}\AI-Settings
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
OutputDir={#Output}
OutputBaseFilename=AI-Settings-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
DisableProgramGroupPage=yes
DisableDirPage=yes
WizardStyle=modern
[Languages]
Name: korean; MessagesFile: compiler:Languages\Korean.isl
[Files]
Source: "{#Payload}\*"; DestDir: "{tmp}\ai-settings-payload"; Flags: recursesubdirs createallsubdirs dontcopy
[Run]
Filename: "{%USERPROFILE}\.ai-settings\AI-Settings-User-Guide.ko.pdf"; Description: "사용설명서 열기"; Flags: shellexec postinstall skipifsilent unchecked
[Code]
var ModePage: TInputOptionWizardPage; Attempted: Boolean; AttemptResult: String;
procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpWelcome, 'AI 구성 선택', '설치할 구성을 선택하세요', '필요한 프로그램을 온라인으로 내려받습니다. 자세한 진행 내용은 콘솔에서 확인하세요.', True, False);
  ModePage.Add('Claude + Codex (권장)');
  ModePage.Add('Codex만');
  ModePage.SelectedValueIndex := 0;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var ResultCode: Integer; Mode, Params, PowerShellPath: String; Progress: TOutputMarqueeProgressWizardPage;
begin
  if Attempted then begin Result := AttemptResult; exit; end;
  Attempted := True;
  Result := '';
  Progress := CreateOutputMarqueeProgressPage('설치 중', '필요한 구성 요소를 설치하고 있습니다. 자세한 내용은 콘솔을 확인하세요.');
  Progress.Show;
  Progress.Animate;
  try
    try
      ExtractTemporaryFiles('{tmp}\ai-settings-payload\*');
      if ModePage.SelectedValueIndex = 1 then Mode := 'codex' else Mode := 'both';
      Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\ai-settings-payload\install.ps1') + '" -Mode ' + Mode;
      if IsWin64 then PowerShellPath := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe')
      else PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
      if not Exec(PowerShellPath, Params, ExpandConstant('{tmp}\ai-settings-payload'), SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
        Result := 'PowerShell을 시작하지 못했습니다. 오류 코드: ' + IntToStr(ResultCode) + '. 설치가 시작되지 않아 로그가 없을 수 있습니다. EXE를 다시 실행하세요.'
      else if ResultCode <> 0 then
        Result := '설치 실패. 종료 코드: ' + IntToStr(ResultCode) + '. 로그 위치: ' + ExpandConstant('{%USERPROFILE}\.ai-settings\logs') + '. EXE를 다시 실행하세요.';
    except
      Result := '설치 준비 실패: ' + GetExceptionMessage + '. 설치가 시작되지 않아 로그가 없을 수 있습니다. EXE를 다시 실행하세요.';
    end;
  finally
    Progress.Hide;
  end;
  AttemptResult := Result;
end;