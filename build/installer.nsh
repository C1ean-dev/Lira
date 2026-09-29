!macro customInstall
  # Inicia o aplicativo instalado imediatamente ao concluir a instalação
  ${ifNot} ${Silent}
    ExecShell "" "$appExe"
  ${else}
    ${if} ${isForceRun}
      ExecShell "" "$appExe"
    ${endif}
  ${endif}
!macroend
