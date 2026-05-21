@echo off
chcp 65001 > nul
title IP Tracker
echo.
echo  Iniciando IP Tracker...
echo.
start "IP Tracker — Servidor" cmd /k "node server.js"
timeout /t 2 /nobreak > nul
start "IP Tracker — Admin CLI" cmd /k "node admin-cli.js"
