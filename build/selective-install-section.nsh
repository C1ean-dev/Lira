# Based on electron-builder's installSection.nsh. Keep its link/registry/UI macros,
# but never uninstall the old tree in the differential path. The template adapter
# is checked when packaging so upstream changes cannot silently bypass this flow.
!include installer.nsh

InitPluginsDir
${IfNot} ${Silent}
  SetDetailsPrint none
${EndIf}
StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!insertmacro setLinkVars

!ifdef ONE_CLICK
  !ifdef HEADER_ICO
    File /oname=$PLUGINSDIR\installerHeaderico.ico "${HEADER_ICO}"
  !endif
  ${IfNot} ${Silent}
    !ifdef HEADER_ICO
      SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\installerHeaderico.ico"
    !else
      SpiderBanner::Show /MODERN
    !endif
    FindWindow $0 "#32770" "" $hwndparent
    FindWindow $0 "#32770" "" $hwndparent $0
    GetDlgItem $0 $0 1000
    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"
    StrCpy $1 $hwndparent
    System::Call 'user32::ShutdownBlockReasonCreate(${SYSTYPE_PTR}r1, w "$(installing)")'
  ${EndIf}
  !insertmacro CHECK_APP_RUNNING
!else
  ${IfNot} ${UAC_IsInnerInstance}
    !insertmacro CHECK_APP_RUNNING
  ${EndIf}
!endif

Var /GLOBAL keepShortcuts
StrCpy $keepShortcuts "false"
!insertmacro setIsTryToKeepShortcuts
${If} $isTryToKeepShortcuts == "true"
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts
  ${If} $R1 == "true"
  ${AndIf} ${FileExists} "$appExe"
    StrCpy $keepShortcuts "true"
  ${EndIf}
${EndIf}

${If} $liraDeltaUpdate != "true"
  !insertmacro uninstallOldVersion SHELL_CONTEXT
  !insertmacro handleUninstallResult SHELL_CONTEXT
  ${If} $installMode == "all"
    !insertmacro uninstallOldVersion HKEY_CURRENT_USER
    !insertmacro handleUninstallResult HKEY_CURRENT_USER
  ${EndIf}
  ClearErrors
  SetOutPath "$INSTDIR"
${Else}
  ClearErrors
  SetOutPath "$liraPayloadDir"
${EndIf}
${If} ${Errors}
  Abort "Nao foi possivel preparar o diretorio de instalacao."
${EndIf}

!ifdef UNINSTALLER_ICON
  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
!endif

# Extract once to the selected output directory. Unlike the stock macro this
# does not CopyFiles the entire staged runtime over the existing installation.
!ifdef ZIP_COMPRESSION
  !error "Selective Windows updates require the default 7z NSIS package"
!endif
!ifdef COMPRESS
  SetCompress off
!endif
Var /GLOBAL packageArch
!insertmacro identify_package
!insertmacro compute_files_for_current_arch
!ifdef COMPRESS
  SetCompress "${COMPRESS}"
!endif
Nsis7z::Extract "$PLUGINSDIR\app-$packageArch.7z"
ClearErrors
WriteUninstaller "$OUTDIR\${UNINSTALL_FILENAME}"
${If} ${Errors}
  Abort "Nao foi possivel gravar o desinstalador."
${EndIf}
!insertmacro custom_files_post_decompression

${If} $liraDeltaUpdate == "true"
  !insertmacro LiraStage "Preparando backup diferencial"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Backup -InstallDir "$INSTDIR" -PayloadDir "$liraPayloadDir" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}" -ProgressWindow "$liraProgressLabel"`
  Pop $0
  ${If} ${FileExists} "$INSTDIR\..\lira.update-pending.json"
    StrCpy $liraUpdatePending "true"
  ${EndIf}
  ${If} $0 != 0
    Abort "Nao foi possivel preparar o backup diferencial."
  ${EndIf}
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\update-recovery.ps1" -Action Apply -InstallDir "$INSTDIR" -PayloadDir "$liraPayloadDir" -UserDataDir "$APPDATA\${APP_PACKAGE_NAME}" -ProgressWindow "$liraProgressLabel"`
  Pop $0
  ${If} $0 != 0
    Abort "Nao foi possivel aplicar a atualizacao diferencial."
  ${EndIf}
${EndIf}

SetOutPath "$INSTDIR"
!insertmacro registryAddInstallInfo
!insertmacro addStartMenuLink $keepShortcuts
!insertmacro addDesktopLink $keepShortcuts
${If} ${FileExists} "$newStartMenuLink"
  StrCpy $launchLink "$newStartMenuLink"
${Else}
  StrCpy $launchLink "$appExe"
${EndIf}
!ifmacrodef registerFileAssociations
  !insertmacro registerFileAssociations
!endif
!insertmacro customInstall

!macro doStartApp
  HideWindow
  !insertmacro StartApp
!macroend
!ifdef ONE_CLICK
  !insertmacro quitSuccess
!endif
