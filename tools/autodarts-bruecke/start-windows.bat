@echo off
rem Autodarts-Bruecke fuer Blink 180 starten (Doppelklick).
rem Voraussetzung: Node.js LTS ist installiert (https://nodejs.org).
cd /d "%~dp0"
title Autodarts-Bruecke
node bruecke.mjs %*
pause
