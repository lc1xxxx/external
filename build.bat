@echo off
chcp 65001 > nul
title IP Tracker — Build

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   IP Tracker — Gerando executáveis   ║
echo  ╚══════════════════════════════════════╝
echo.

:: Verificar Node.js
node -v > nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js não encontrado!
    echo  Baixe em: https://nodejs.org
    pause
    exit /b 1
)

echo  [1/4] Node.js encontrado:
node -v
echo.

:: Instalar dependências
echo  [2/4] Instalando dependências...
call npm install
echo.

:: Instalar pkg globalmente
echo  [3/4] Instalando pkg (empacotador)...
call npm install -g pkg
echo.

:: Criar pasta dist
if not exist dist mkdir dist

:: Gerar executáveis
echo  [4/4] Gerando executáveis...
echo.

echo  Gerando ip-tracker-server.exe ...
call pkg server.js --targets node18-win-x64 --output dist\ip-tracker-server.exe

echo  Gerando ip-tracker-admin.exe ...
call pkg admin-cli.js --targets node18-win-x64 --output dist\ip-tracker-admin.exe

echo.
echo  ══════════════════════════════════════
echo  ✔ Pronto! Arquivos gerados em dist\:
echo.
dir /b dist\
echo.
echo  Como usar:
echo    1. Copie a pasta dist\ para onde quiser
echo    2. Coloque visits.json, index.html e admin.html na mesma pasta
echo    3. Execute ip-tracker-server.exe para iniciar o servidor
echo    4. Execute ip-tracker-admin.exe para abrir o painel CLI
echo  ══════════════════════════════════════
echo.
pause
