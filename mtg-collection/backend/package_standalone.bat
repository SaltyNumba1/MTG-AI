@echo off
echo Building backend with PyInstaller...

REM Try local .venv first, then root-level .venv
if exist "%~dp0.venv\Scripts\pyinstaller.exe" (
    set PYINSTALLER=%~dp0.venv\Scripts\pyinstaller.exe
) else if exist "%~dp0..\..\..\.venv\Scripts\pyinstaller.exe" (
    set PYINSTALLER=%~dp0..\..\..\.venv\Scripts\pyinstaller.exe
) else if exist "%~dp0..\.venv\Scripts\pyinstaller.exe" (
    set PYINSTALLER=%~dp0..\.venv\Scripts\pyinstaller.exe
) else (
    echo ERROR: Could not find pyinstaller in any .venv location.
    exit /b 1
)

echo Using PyInstaller: %PYINSTALLER%
"%PYINSTALLER%" --clean mtg-collection.spec
if %ERRORLEVEL% neq 0 (
    echo PyInstaller build failed!
    exit /b %ERRORLEVEL%
)
echo Backend build complete.
if %ERRORLEVEL% neq 0 (
    echo PyInstaller build failed!
    exit /b %ERRORLEVEL%
)
echo Backend build complete.
