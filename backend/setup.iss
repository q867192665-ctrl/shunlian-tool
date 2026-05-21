; 瞬联调试工具 Inno Setup 安装脚本
; 使用前请先运行 build_all.bat 生成 exe 文件

#define AppName "瞬联调试工具"
#define AppVersion "1.0.4"
#define AppPublisher "瞬联调试工具"
#define AppExeName "ShunLianTool.exe"
#define BackendExeName "shunlian_backend.exe"
#define GuardianExeName "shunlian_guardian.exe"

[Setup]
AppId={{B3C4D5E6-F7A8-9012-BCDE-F34567890123}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=ShunLianTool_Setup_v{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=logo.ico
UninstallDisplayIcon={app}\{#AppExeName}
PrivilegesRequired=admin
UsePreviousAppDir=yes
CloseApplications=no
RestartApplications=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"

[Files]
; 后端主程序
Source: "dist\setup_files\{#BackendExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 启动器（快捷方式指向此文件）
Source: "dist\setup_files\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 进程守护
Source: "dist\setup_files\{#GuardianExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 配置文件
Source: "dist\setup_files\config.yaml"; DestDir: "{app}"; Flags: ignoreversion
; 图标
Source: "dist\setup_files\logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\setup_files\Logo.jpg"; DestDir: "{app}"; Flags: ignoreversion
; 前端静态文件
Source: "dist\setup_files\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
; 更新日志
Source: "dist\setup_files\更新日志.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\logo.ico"; WorkingDir: "{app}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\logo.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; 安装完成后启动程序
Filename: "{app}\{#AppExeName}"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 卸载时删除临时文件
Type: filesandordirs; Name: "{app}\__pycache__"
Type: filesandordirs; Name: "{app}\*.log"

[UninstallRun]
; 卸载前关闭后端进程
Filename: "taskkill"; Parameters: "/f /im {#BackendExeName}"; Flags: runhidden
Filename: "taskkill"; Parameters: "/f /im {#AppExeName}"; Flags: runhidden
Filename: "taskkill"; Parameters: "/f /im {#GuardianExeName}"; Flags: runhidden

[Code]
var
  OldVersionUninstalled: Boolean;

function GetUninstallExePath(const UninstallString: String): String;
var
  P: Integer;
begin
  Result := UninstallString;
  if Pos('"', Result) = 1 then
  begin
    Delete(Result, 1, 1);
    P := Pos('"', Result);
    if P > 0 then
      Result := Copy(Result, 1, P - 1);
  end
  else
  begin
    P := Pos(' ', Result);
    if P > 0 then
      Result := Copy(Result, 1, P - 1);
  end;
end;

function IsProcessRunning(const ProcessName: String): Boolean;
var
  BatchFile: String;
  ResultCode: Integer;
begin
  Result := False;
  BatchFile := ExpandConstant('{tmp}\check_process.bat');
  SaveStringToFile(BatchFile, '@echo off' + #13#10 + 'tasklist /FI "IMAGENAME eq ' + ProcessName + '" /NH | find /I "' + ProcessName + '" >nul && exit 0 || exit 1', False);
  if Exec('cmd.exe', '/c "' + BatchFile + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if ResultCode = 0 then
      Result := True;
  end;
  DeleteFile(BatchFile);
end;

function KillProcess(const ProcessName: String): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('taskkill', '/f /im ' + ProcessName, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function FindOldVersionInstallDir: String;
var
  InstallDir: String;
begin
  Result := '';
  
  // 1. 从当前程序注册表查找
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{B3C4D5E6-F7A8-9012-BCDE-F34567890123}}_is1', 'InstallLocation', InstallDir) then
  begin
    Result := InstallDir;
    Exit;
  end;
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{B3C4D5E6-F7A8-9012-BCDE-F34567890123}}_is1', 'InstallLocation', InstallDir) then
  begin
    Result := InstallDir;
    Exit;
  end;
  
  // 2. 从旧版注册表查找
  if RegQueryStringValue(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ChinaTool_is1', 'InstallLocation', InstallDir) then
  begin
    Result := InstallDir;
    Exit;
  end;
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ChinaTool_is1', 'InstallLocation', InstallDir) then
  begin
    Result := InstallDir;
    Exit;
  end;
end;

function FindUninstaller(const InstallDir: String): String;
begin
  Result := '';
  
  if InstallDir = '' then
    Exit;
    
  // 检查 unins000.exe
  if FileExists(InstallDir + 'unins000.exe') then
  begin
    Result := InstallDir + 'unins000.exe';
    Exit;
  end;
  
  // 检查 unins001.exe（多次安装后可能生成）
  if FileExists(InstallDir + 'unins001.exe') then
  begin
    Result := InstallDir + 'unins001.exe';
    Exit;
  end;
end;

function InitializeSetup: Boolean;
var
  OldUninstallKey: String;
  UninstallPath: String;
  UninstallExe: String;
  UninstallParams: String;
  ResultCode: Integer;
  AppInstallDir: String;
  OldVersion: String;
  FoundOldVersion: Boolean;
  OldAppName: String;
  HasOldProcess: Boolean;
  RetryCount: Integer;
begin
  Result := True;
  OldVersionUninstalled := False;
  FoundOldVersion := False;
  OldAppName := '{#AppName}';
  HasOldProcess := False;

  // 第一步：检查旧版本进程是否在运行
  if IsProcessRunning('shunlian_backend.exe') then HasOldProcess := True;
  if IsProcessRunning('{#BackendExeName}') then HasOldProcess := True;
  if IsProcessRunning('{#AppExeName}') then HasOldProcess := True;
  if IsProcessRunning('{#GuardianExeName}') then HasOldProcess := True;

  // 第二步：从注册表查找已安装的旧版本
  OldUninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{B3C4D5E6-F7A8-9012-BCDE-F34567890123}}_is1';
  
  // 检查 HKLM
  if RegKeyExists(HKLM, OldUninstallKey) then
  begin
    if RegQueryStringValue(HKLM, OldUninstallKey, 'UninstallString', UninstallPath) then
    begin
      RegQueryStringValue(HKLM, OldUninstallKey, 'DisplayVersion', OldVersion);
      RegQueryStringValue(HKLM, OldUninstallKey, 'InstallLocation', AppInstallDir);
      RegQueryStringValue(HKLM, OldUninstallKey, 'DisplayName', OldAppName);
      FoundOldVersion := True;
    end;
  end;
  
  // 检查 HKCU
  if not FoundOldVersion and RegKeyExists(HKCU, OldUninstallKey) then
  begin
    if RegQueryStringValue(HKCU, OldUninstallKey, 'UninstallString', UninstallPath) then
    begin
      RegQueryStringValue(HKCU, OldUninstallKey, 'DisplayVersion', OldVersion);
      RegQueryStringValue(HKCU, OldUninstallKey, 'InstallLocation', AppInstallDir);
      RegQueryStringValue(HKCU, OldUninstallKey, 'DisplayName', OldAppName);
      FoundOldVersion := True;
    end;
  end;

  // 如果没找到，再检查旧版 ChinaTool 的注册表路径
  if not FoundOldVersion then
  begin
    OldUninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\ChinaTool_is1';
    if RegKeyExists(HKLM, OldUninstallKey) then
    begin
      if RegQueryStringValue(HKLM, OldUninstallKey, 'UninstallString', UninstallPath) then
      begin
        RegQueryStringValue(HKLM, OldUninstallKey, 'DisplayVersion', OldVersion);
        RegQueryStringValue(HKLM, OldUninstallKey, 'InstallLocation', AppInstallDir);
        RegQueryStringValue(HKLM, OldUninstallKey, 'DisplayName', OldAppName);
        FoundOldVersion := True;
      end;
    end;
    if not FoundOldVersion and RegKeyExists(HKCU, OldUninstallKey) then
    begin
      if RegQueryStringValue(HKCU, OldUninstallKey, 'UninstallString', UninstallPath) then
      begin
        RegQueryStringValue(HKCU, OldUninstallKey, 'DisplayVersion', OldVersion);
        RegQueryStringValue(HKCU, OldUninstallKey, 'InstallLocation', AppInstallDir);
        RegQueryStringValue(HKCU, OldUninstallKey, 'DisplayName', OldAppName);
        FoundOldVersion := True;
      end;
    end;
  end;

  // 如果注册表没找到但检测到进程在运行，尝试查找安装目录
  if not FoundOldVersion and HasOldProcess then
  begin
    AppInstallDir := FindOldVersionInstallDir;
    if AppInstallDir <> '' then
    begin
      UninstallExe := FindUninstaller(AppInstallDir);
      if UninstallExe <> '' then
      begin
        OldVersion := '未知';
        OldAppName := '瞬联调试工具';
        FoundOldVersion := True;
        UninstallPath := UninstallExe;
      end;
    end;
  end;
  
  // 如果找到旧版本，执行卸载
  if FoundOldVersion then
  begin
    if MsgBox('检测到已安装旧版本 ' + OldAppName + '（版本：' + OldVersion + '）。' + #13 + #10 + #13 + #10 +
              '是否先卸载旧版本，然后自动安装新版本？',
              mbConfirmation, MB_YESNO) = IDYES then
    begin
      // 先终止所有相关进程
      KillProcess('{#AppExeName}');
      KillProcess('{#BackendExeName}');
      KillProcess('shunlian_backend.exe');
      KillProcess('shunlian_frontend.exe');
      KillProcess('{#GuardianExeName}');
      Sleep(3000);

      // 确定卸载程序路径
      if Pos('unins', UninstallPath) > 0 then
      begin
        UninstallExe := UninstallPath;
      end
      else
      begin
        UninstallExe := GetUninstallExePath(UninstallPath);
      end;
      
      UninstallParams := '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES';

      if FileExists(UninstallExe) then
      begin
        OldVersionUninstalled := True;
        Exec(UninstallExe, UninstallParams, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Sleep(5000);
        
        // 多次检查并终止可能残留的进程
        RetryCount := 0;
        while (IsProcessRunning('{#BackendExeName}') or IsProcessRunning('shunlian_backend.exe')) and (RetryCount < 3) do
        begin
          KillProcess('{#AppExeName}');
          KillProcess('{#BackendExeName}');
          KillProcess('shunlian_backend.exe');
          KillProcess('shunlian_frontend.exe');
      KillProcess('{#GuardianExeName}');
          Sleep(2000);
          RetryCount := RetryCount + 1;
        end;
      end
      else
      begin
        // 找不到卸载程序，但仍然终止旧进程
        OldVersionUninstalled := True;
        KillProcess('{#AppExeName}');
        KillProcess('{#BackendExeName}');
        KillProcess('shunlian_backend.exe');
        KillProcess('shunlian_frontend.exe');
      KillProcess('{#GuardianExeName}');
        Sleep(2000);
      end;
    end
    else
    begin
      Result := False;
    end;
  end;

  // 无论是否找到旧版本，都要确保相关进程已终止（防止文件被占用）
  if HasOldProcess then
  begin
    KillProcess('{#AppExeName}');
    KillProcess('{#BackendExeName}');
    KillProcess('shunlian_backend.exe');
    KillProcess('shunlian_frontend.exe');
      KillProcess('{#GuardianExeName}');
    Sleep(3000);
    
    // 再次检查并终止残留进程
    RetryCount := 0;
    while (IsProcessRunning('{#BackendExeName}') or IsProcessRunning('shunlian_backend.exe')) and (RetryCount < 3) do
    begin
      KillProcess('{#AppExeName}');
      KillProcess('{#BackendExeName}');
      KillProcess('shunlian_backend.exe');
      KillProcess('shunlian_frontend.exe');
      KillProcess('{#GuardianExeName}');
      Sleep(2000);
      RetryCount := RetryCount + 1;
    end;
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataPath: string;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataPath := ExpandConstant('{app}');
    if DirExists(DataPath) then
    begin
      DelTree(DataPath + '\__pycache__', True, True, True);
    end;
    DataPath := ExpandConstant('{localappdata}\ShunLianTool');
    if DirExists(DataPath) then
    begin
      DelTree(DataPath, True, True, True);
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  MarkerFile: string;
begin
  if (CurStep = ssPostInstall) then
  begin
    // 创建一个标记文件，表示刚安装完成，前端检测到此文件后应清除旧版本号记录
    MarkerFile := ExpandConstant('{app}\static\just_installed');
    SaveStringToFile(MarkerFile, '1', False);
    
    if OldVersionUninstalled then
    begin
      MsgBox('旧版本已卸载完成，新版本已安装。', mbInformation, MB_OK);
    end;
  end;
end;
