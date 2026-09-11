@echo off
title Agente de Impresion Termica POS (Cloud Bridge)
echo ================================================================
echo ??? INICIANDO AGENTE DE IMPRESION EN TIEMPO REAL
echo ================================================================
set /p CLOUD_URL="Ingresa la URL de tu POS en Internet (ej. https://mi-pos.com) o presiona ENTER para usar localhost: " 
if "%CLOUD_URL%"=="" set CLOUD_URL=http://localhost:4000
node agente-impresion-local.js %CLOUD_URL%
pause
