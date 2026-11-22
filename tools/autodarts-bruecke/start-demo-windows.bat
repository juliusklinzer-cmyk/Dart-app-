@echo off
rem Brücke ohne Autodarts testen: Darts von Hand eintippen.
cd /d "%~dp0"
title Autodarts-Bruecke (Demo)
node bruecke.mjs --demo
pause
