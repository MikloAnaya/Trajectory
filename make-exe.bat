@echo off
REM make-exe.bat - double-click wrapper for make-exe.ps1
REM Usage: double-click to quick-package; add -Installer to build the NSIS installer

SET SCRIPT_DIR=%~dp0
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%make-exe.ps1" %*
