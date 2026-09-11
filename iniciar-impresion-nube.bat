@echo off
title Agente de Impresion Termica POS (Render Cloud Bridge)
echo ================================================================
echo ??? AGENTE DE IMPRESION EN TIEMPO REAL (RENDER CLOUD BRIDGE)
echo ================================================================
echo Conectando con: https://punto-de-venta-d2sa.onrender.com
echo Impresora fisica: 192.168.1.30:9100
echo ================================================================
node agente-impresion-local.js https://punto-de-venta-d2sa.onrender.com
pause
