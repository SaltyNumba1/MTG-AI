@echo off
echo Building backend with PyInstaller...
pyinstaller --clean mtg-collection.spec
if %ERRORLEVEL% neq 0 (
    echo PyInstaller build failed!
    exit /b %ERRORLEVEL%
)
echo Backend build complete.
