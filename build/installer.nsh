!include "LogicLib.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
  Var liraUpdatePending
  Var liraProgressLabel
!endif

!macro LiraStage MSG
  DetailPrint "${MSG}"
  ${If} $liraProgressLabel != 0
    SendMessage $liraProgressLabel ${WM_SETTEXT} 0 "STR:${MSG}"
  ${EndIf}
!macroend

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

!macro KillAppProcesses
  !insertmacro LogToInstallFile "[KillAppProcesses] Encerrando Lira.exe..."
  # ATENÇÃO: NÃO usar a flag /T (tree-kill) aqui! Quando a atualização é disparada pelo Lira,
  # o instalador é filho na árvore de processos do Lira. Se usarmos /T, o taskkill mataria o próprio instalador!
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "Lira.exe"`
  Pop $0
  !insertmacro LogToInstallFile `[KillAppProcesses] taskkill Lira.exe retorno: $0`

  !insertmacro LogToInstallFile "[KillAppProcesses] Encerrando process-audio-capture.exe..."
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "process-audio-capture.exe"`
  Pop $0
  !insertmacro LogToInstallFile `[KillAppProcesses] taskkill process-audio-capture.exe retorno: $0`
  Sleep 1000
!macroend

!macro customInit
  StrCpy $liraUpdatePending "false"
  StrCpy $liraProgressLabel 0
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo ======================================== >> "$TEMP\lira_install.log"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo [TIMESTAMP] %DATE% %TIME% >> "$TEMP\lira_install.log"`
  !insertmacro LogToInstallFile "=== INICIO DO INSTALADOR LIRA ==="
  !insertmacro LogToInstallFile `[customInit] EXEPATH: $EXEPATH`
  !insertmacro LogToInstallFile `[customInit] CMDLINE: $CMDLINE`
  !insertmacro LogToInstallFile `[customInit] INSTDIR inicial: $INSTDIR`
  !insertmacro LogToInstallFile `[customInit] TEMP: $TEMP`

  # Garante que o diretorio temporario de plugins exista
  InitPluginsDir
  File /oname=$PLUGINSDIR\update-recovery.ps1 "${BUILD_RESOURCES_DIR}\update-recovery.ps1"
  File /oname=$PLUGINSDIR\update-io.ps1 "${BUILD_RESOURCES_DIR}\update-io.ps1"
  !insertmacro LogToInstallFile `[customInit] PLUGINSDIR inicializado: $PLUGINSDIR`

  # Em SSDs ou particoes NTFS com compactacao ativa ("Compactar este disco para economizar espaco"),
  # descompacta o diretorio temporario de plugins para evitar erro de escrita e falhas de extracao.
  !insertmacro LogToInstallFile "[customInit] Descompactando PLUGINSDIR via compact.exe..."
  nsExec::Exec `"$SYSDIR\compact.exe" /U /I /Q "$PLUGINSDIR"`
  Pop $0
  !insertmacro LogToInstallFile `[customInit] compact.exe PLUGINSDIR retorno: $0`
  !insertmacro LogToInstallFile "[customInit] customInit concluido."
!macroend

!macro customCheckAppRunning
  !insertmacro LogToInstallFile "[customCheckAppRunning] Verificando e finalizando processos antes da instalacao..."
  !insertmacro KillAppProcesses
  !insertmacro LogToInstallFile "[customCheckAppRunning] Processos finalizados com sucesso."
  # This hook runs before uninstallOldVersion. Never back up from the uninstaller.
  !ifndef BUILD_UNINSTALLER
    # Release NSIS's working-directory handle so INSTDIR can be renamed on the same volume.
    SetOutPath "$TEMP"
    # Match electron-builder's one-click SpiderBanner label; fall back to the regular page status.
    FindWindow $R1 "#32770" "" $HWNDPARENT
    FindWindow $R1 "#32770" "" $HWNDPARENT $R1
    GetDlgItem $liraProgressLabel $R1 1000
    ${If} $liraProgressLabel == 0
      FindWindow $R1 "#32770" "" $HWNDPARENT
      GetDlgItem $liraProgressLabel $R1 1006
    ${EndIf}
    !insertmacro LiraStage "Preparando backup"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Backup -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}" -ProgressWindow "$liraProgressLabel"`
    Pop $0
    ${If} $0 != 0
      !insertmacro LogToInstallFile "[Backup] Falha ao salvar lira.backup; atualizacao cancelada."
      ${If} ${FileExists} "$INSTDIR\..\lira.update-pending.json"
        StrCpy $liraUpdatePending "true"
        Call LiraRollback
      ${Else}
        ExecShell "" "$appExe"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Nao foi possivel salvar o backup do Lira. A atualizacao foi cancelada. Tente novamente mais tarde."
      ${EndIf}
      Abort
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\..\lira.update-pending.json"
      StrCpy $liraUpdatePending "true"
      !insertmacro LogToInstallFile `[Backup] Aplicativo e dados do usuario salvos em $INSTDIR\..\lira.backup`
    ${EndIf}
    !insertmacro LiraStage "Instalando Lira"
  !endif
!macroend

!macro customInstall
  !insertmacro LiraStage "Finalizando instalacao"
  !insertmacro LogToInstallFile `[customInstall] Arquivos extraidos para INSTDIR: $INSTDIR`
  !insertmacro LogToInstallFile "[customInstall] Descompactando INSTDIR via compact.exe (caso esteja em particao compactada)..."
  nsExec::Exec `"$SYSDIR\compact.exe" /U /I /Q /S:"$INSTDIR"`
  Pop $0
  !insertmacro LogToInstallFile `[customInstall] compact.exe INSTDIR retorno: $0`

  ${IfNot} ${FileExists} "$appExe"
  ${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    Abort "Os arquivos da nova versao estao incompletos."
  ${EndIf}
  # Inicia o aplicativo atualizado imediatamente apos a conclusao da instalacao
  !insertmacro LogToInstallFile `[customInstall] Iniciando app atualizado: $appExe`
  SetOutPath "$INSTDIR"
  ClearErrors
  ExecShell "" "$appExe"
  ${If} ${Errors}
    Abort "Nao foi possivel abrir a nova versao do Lira."
  ${EndIf}
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Commit -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}"`
  Pop $0
  ${If} $0 != 0
    Abort "Nao foi possivel concluir a atualizacao."
  ${EndIf}
  StrCpy $liraUpdatePending "false"
  !insertmacro LogToInstallFile "[customInstall] ExecShell disparado com sucesso."
  !insertmacro LogToInstallFile "=== INSTALACAO CONCLUIDA COM SUCESSO ==="
!macroend

!macro customUnInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\update-recovery.ps1 "${BUILD_RESOURCES_DIR}\update-recovery.ps1"
  File /oname=$PLUGINSDIR\update-io.ps1 "${BUILD_RESOURCES_DIR}\update-io.ps1"
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo ======================================== >> "$TEMP\lira_install.log"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo [TIMESTAMP] %DATE% %TIME% >> "$TEMP\lira_install.log"`
  !insertmacro LogToInstallFile "=== INICIO DO DESINSTALADOR LIRA ==="
  !insertmacro LogToInstallFile `[customUnInit] INSTDIR: $INSTDIR`
  !insertmacro LogToInstallFile `[customUnInit] CMDLINE: $CMDLINE`
!macroend

!macro customUnInstall
  # electron-builder invokes the old uninstaller with --updated during upgrades.
  ${IfNot} ${isUpdated}
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Cleanup -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}"`
    Pop $0
    ${If} $0 != 0
      !insertmacro LogToInstallFile "[Desinstalacao] Falha ao remover lira.backup."
      Abort "Nao foi possivel remover o backup do Lira."
    ${EndIf}
    !insertmacro LogToInstallFile `[Desinstalacao] Backup removido: $INSTDIR\..\lira.backup`
  ${EndIf}
  !insertmacro LogToInstallFile "[customUnInstall] Remocao concluida com sucesso."
  !insertmacro LogToInstallFile "=== DESINSTALACAO CONCLUIDA ==="
!macroend

!ifndef BUILD_UNINSTALLER
Function LiraRollback
  ${If} $liraUpdatePending != "true"
    Return
  ${EndIf}
  StrCpy $liraUpdatePending "false"
  !insertmacro KillAppProcesses
  # Leave INSTDIR before replacing it with the saved version.
  SetOutPath "$TEMP"
  !insertmacro LiraStage "Restaurando Lira"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Restore -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}" -ProgressWindow "$liraProgressLabel"`
  Pop $0
  ${If} $0 == 0
    !insertmacro LogToInstallFile "[Rollback] Aplicativo e dados do usuario restaurados de lira.backup."
    ${If} ${FileExists} "$INSTDIR\Lira.exe"
      ExecShell "" "$INSTDIR\Lira.exe"
    ${EndIf}
    MessageBox MB_OK|MB_ICONEXCLAMATION "A atualização não foi bem-sucedida. A versão anterior do Lira e os dados do usuário foram restaurados. Tente novamente mais tarde."
  ${Else}
    !insertmacro LogToInstallFile "[Rollback] Falha ao restaurar; lira.backup preservado."
    MessageBox MB_OK|MB_ICONSTOP "A atualização não foi bem-sucedida e não foi possível restaurar os arquivos automaticamente. O lira.backup foi preservado. Tente novamente mais tarde."
  ${EndIf}
FunctionEnd

Function .onInstFailed
  !insertmacro LogToInstallFile "[ERRO FATAL] A instalacao falhou (.onInstFailed)!"
  !insertmacro LogToInstallFile "[ERRO FATAL] Verifique permissoes, espaco em disco ou arquivos bloqueados."
  Call LiraRollback
FunctionEnd

Function .onGUIEnd
  # electron-builder also uses Quit on extraction/uninstall errors.
  Call LiraRollback
FunctionEnd

Function .onInstSuccess
  !insertmacro LogToInstallFile "[.onInstSuccess] Gravacao final do instalador concluida com sucesso."
FunctionEnd
!endif
