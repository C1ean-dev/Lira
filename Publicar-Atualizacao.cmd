@echo off
setlocal
title Publicar atualizacao do Lira - Windows e Android
pushd "%~dp0"
node "%~dp0scripts\local-release.mjs" %*
set "releaseResult=%ERRORLEVEL%"
if not "%releaseResult%"=="0" echo Falha na publicacao. Confira a mensagem e os logs acima.
popd
pause
exit /b %releaseResult%
