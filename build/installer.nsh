!macro KillAppProcesses
  # Encerra todas as instâncias em execução do Lira e processos auxiliares para garantir que nenhum arquivo fique bloqueado
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "Lira.exe" /T`
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "gather-v2-clone.exe" /T`
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "process-audio-capture.exe" /T`
  Sleep 1000
!macroend

!macro customInit
  # Ao inicializar o instalador, encerra o aplicativo para que o instalador tome o controle
  !insertmacro KillAppProcesses
!macroend

!macro customCheckAppRunning
  # Garante que nenhum processo permaneça em execução antes da cópia/substituição dos arquivos
  !insertmacro KillAppProcesses
!macroend

!macro customInstall
  # Inicia o aplicativo atualizado imediatamente após a conclusão da instalação
  SetOutPath "$INSTDIR"
  ExecShell "" "$appExe"
!macroend
