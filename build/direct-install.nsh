!include "LogicLib.nsh"

!macro LogToInstallFile MSG
  Push $R8
  ClearErrors
  FileOpen $R8 "$TEMP\lira_install.log" a
  IfErrors +4 0
    FileSeek $R8 0 END
    FileWrite $R8 `${MSG}$\r$\n`
    FileClose $R8
  Pop $R8
!macroend

!macro customInit
  !insertmacro LogToInstallFile "=== INICIO DO INSTALADOR LIRA ==="
  InitPluginsDir
  nsExec::Exec `"$SYSDIR\compact.exe" /U /I /Q "$PLUGINSDIR"`
  Pop $0
  !insertmacro LogToInstallFile `[customInit] compact.exe PLUGINSDIR retorno: $0`
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    # A previous installer may still need to finish recovering its transaction.
    ${If} ${FileExists} "$INSTDIR\..\lira.update-pending.json"
      !insertmacro LogToInstallFile "[ERRO] Atualizacao anterior pendente."
      MessageBox MB_OK|MB_ICONSTOP "Conclua a recuperacao com o instalador que iniciou a atualizacao anterior do Lira." /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  !endif

  # Killing the process tree would also kill the installer launched by Lira.
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "Lira.exe"`
  Pop $0
  !insertmacro LogToInstallFile `[Processos] taskkill Lira.exe retorno: $0`
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "process-audio-capture.exe"`
  Pop $0
  !insertmacro LogToInstallFile `[Processos] taskkill process-audio-capture.exe retorno: $0`
  Sleep 1000
!macroend

!macro customInstall
  nsExec::Exec `"$SYSDIR\compact.exe" /U /I /Q /S:"$INSTDIR"`
  Pop $0
  !insertmacro LogToInstallFile `[customInstall] compact.exe INSTDIR retorno: $0`

  ${IfNot} ${FileExists} "$appExe"
  ${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    Abort "Os arquivos da nova versao estao incompletos."
  ${EndIf}

  SetOutPath "$INSTDIR"
  ClearErrors
  ExecShell "" "$appExe"
  ${If} ${Errors}
    Abort "Nao foi possivel abrir a nova versao do Lira."
  ${EndIf}
  !insertmacro LogToInstallFile "=== INSTALACAO CONCLUIDA COM SUCESSO ==="
!macroend
