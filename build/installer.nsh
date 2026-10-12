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

!macro KillAppProcesses
  !insertmacro LogToInstallFile "[KillAppProcesses] Encerrando Lira.exe..."
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "Lira.exe" /T`
  Pop $0
  !insertmacro LogToInstallFile `[KillAppProcesses] taskkill Lira.exe retorno: $0`

  !insertmacro LogToInstallFile "[KillAppProcesses] Encerrando process-audio-capture.exe..."
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "process-audio-capture.exe" /T`
  Pop $0
  !insertmacro LogToInstallFile `[KillAppProcesses] taskkill process-audio-capture.exe retorno: $0`
  Sleep 1000
!macroend

!macro customInit
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo ======================================== >> "$TEMP\lira_install.log"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo [TIMESTAMP] %DATE% %TIME% >> "$TEMP\lira_install.log"`
  !insertmacro LogToInstallFile "=== INICIO DO INSTALADOR LIRA ==="
  !insertmacro LogToInstallFile `[customInit] EXEPATH: $EXEPATH`
  !insertmacro LogToInstallFile `[customInit] CMDLINE: $CMDLINE`
  !insertmacro LogToInstallFile `[customInit] INSTDIR inicial: $INSTDIR`
  !insertmacro LogToInstallFile `[customInit] TEMP: $TEMP`

  # Garante que o diretorio temporario de plugins exista
  InitPluginsDir
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
!macroend

!macro customInstall
  !insertmacro LogToInstallFile `[customInstall] Arquivos extraidos para INSTDIR: $INSTDIR`
  !insertmacro LogToInstallFile "[customInstall] Descompactando INSTDIR via compact.exe (caso esteja em particao compactada)..."
  nsExec::Exec `"$SYSDIR\compact.exe" /U /I /Q /S:"$INSTDIR"`
  Pop $0
  !insertmacro LogToInstallFile `[customInstall] compact.exe INSTDIR retorno: $0`

  # Inicia o aplicativo atualizado imediatamente apos a conclusao da instalacao
  !insertmacro LogToInstallFile `[customInstall] Iniciando app atualizado: $appExe`
  SetOutPath "$INSTDIR"
  ExecShell "" "$appExe"
  !insertmacro LogToInstallFile "[customInstall] ExecShell disparado com sucesso."
  !insertmacro LogToInstallFile "=== INSTALACAO CONCLUIDA COM SUCESSO ==="
!macroend

!macro customUnInit
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo ======================================== >> "$TEMP\lira_install.log"`
  nsExec::Exec `"$SYSDIR\cmd.exe" /c echo [TIMESTAMP] %DATE% %TIME% >> "$TEMP\lira_install.log"`
  !insertmacro LogToInstallFile "=== INICIO DO DESINSTALADOR LIRA ==="
  !insertmacro LogToInstallFile `[customUnInit] INSTDIR: $INSTDIR`
  !insertmacro LogToInstallFile `[customUnInit] CMDLINE: $CMDLINE`
!macroend

!macro customUnInstall
  !insertmacro LogToInstallFile "[customUnInstall] Remocao concluida com sucesso."
  !insertmacro LogToInstallFile "=== DESINSTALACAO CONCLUIDA ==="
!macroend

Function .onInstFailed
  !insertmacro LogToInstallFile "[ERRO FATAL] A instalacao falhou (.onInstFailed)!"
  !insertmacro LogToInstallFile "[ERRO FATAL] Verifique permissoes, espaco em disco ou arquivos bloqueados."
FunctionEnd

Function .onInstSuccess
  !insertmacro LogToInstallFile "[.onInstSuccess] Gravacao final do instalador concluida com sucesso."
FunctionEnd
