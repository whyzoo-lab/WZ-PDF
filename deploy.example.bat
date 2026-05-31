@echo off
setlocal

REM ============================================================
REM  WZ PDF - Web Deploy Script
REM
REM  Server:  YOUR_USER@YOUR_SERVER:/opt/wz-pdf
REM  URL:     http://YOUR_SERVER:PORT
REM
REM  Usage:
REM    deploy.bat              Build + upload dist + sync installer
REM    deploy.bat fast         Build + upload dist only (skip installer)
REM    deploy.bat installer    Force re-upload installer
REM
REM  Prerequisite: SSH key auth set up (~/.ssh/id_ed25519)
REM ============================================================

set SERVER=YOUR_USER@YOUR_SERVER
set REMOTE=/opt/wz-pdf
set URL=http://YOUR_SERVER:PORT
REM Local build-output dir AND the remote subfolder the installer is served from.
set INSTALLER_DIR=release

set MODE=%1
if "%MODE%"=="" set MODE=auto

echo.
echo ============================================================
echo  WZ PDF Deploy  --^>  %SERVER%:%REMOTE%
echo ============================================================
echo.

REM ---- 1) Build ----------------------------------------------
echo [1/4] Building (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: BUILD FAILED
    exit /b 1
)

REM ---- 2) Clear remote (keep installer dir) ------------------
REM Note: using -not instead of ! so cmd doesn't eat the bang.
echo.
echo [2/4] Clearing remote (preserving %INSTALLER_DIR%)...
ssh -o BatchMode=yes %SERVER% "find %REMOTE% -mindepth 1 -maxdepth 1 -not -name %INSTALLER_DIR% -exec rm -rf {} +"
if errorlevel 1 (
    echo ERROR: SSH FAILED - check SSH key auth
    exit /b 1
)

REM ---- 3) Upload dist/ via tar pipe --------------------------
REM scp can't expand wildcards reliably on Windows; tar pipe is robust
REM and preserves directory structure in one stream.
echo.
echo [3/4] Uploading dist/ (tar pipe)...
tar c -C dist . | ssh -o BatchMode=yes %SERVER% "cd %REMOTE% && tar x"
if errorlevel 1 (
    echo ERROR: UPLOAD FAILED
    exit /b 1
)

REM ---- 4) Installer upload (smart skip) ----------------------
echo.
if "%MODE%"=="fast" (
    echo [4/4] Skipping installer upload (fast mode^)
    goto :verify
)

set INSTALLER=
for /f "delims=" %%F in ('dir /b /o-d %INSTALLER_DIR%\WZ_PDF_Setup_*.exe 2^>nul') do (
    if not defined INSTALLER set INSTALLER=%INSTALLER_DIR%\%%F
)

if not defined INSTALLER (
    echo [4/4] No installer found in %INSTALLER_DIR%\ - skipping
    goto :verify
)

for %%I in ("%INSTALLER%") do set LOCAL_SIZE=%%~zI
for %%I in ("%INSTALLER%") do set INSTALLER_NAME=%%~nxI

if "%MODE%"=="installer" goto :do_upload

set REMOTE_SIZE=0
for /f %%S in ('ssh -o BatchMode^=yes %SERVER% "stat -c %%s %REMOTE%/%INSTALLER_DIR%/%INSTALLER_NAME% 2>/dev/null || echo 0"') do set REMOTE_SIZE=%%S

if "%REMOTE_SIZE%"=="%LOCAL_SIZE%" (
    echo [4/4] Installer already in sync ^(%LOCAL_SIZE% bytes^) - skipping
    goto :verify
)

:do_upload
echo [4/4] Uploading %INSTALLER_NAME% ^(%LOCAL_SIZE% bytes^)...
ssh -o BatchMode=yes %SERVER% "mkdir -p %REMOTE%/%INSTALLER_DIR%"
scp -q "%INSTALLER%" %SERVER%:%REMOTE%/%INSTALLER_DIR%/
if errorlevel 1 (
    echo ERROR: INSTALLER UPLOAD FAILED
    exit /b 1
)

REM ---- Verify ------------------------------------------------
:verify
echo.
echo ============================================================
echo  Verifying endpoints...
echo ============================================================
curl -s -o nul -w "  GET  /                                 -^> HTTP %%{http_code}\n" %URL%/
curl -s -o nul -w "  GET  /help.html                        -^> HTTP %%{http_code}\n" %URL%/help.html
if defined INSTALLER_NAME (
    curl -s -o nul -w "  HEAD /%INSTALLER_DIR%/%INSTALLER_NAME%    -^> HTTP %%{http_code}\n" -I %URL%/%INSTALLER_DIR%/%INSTALLER_NAME%
)

echo.
echo  Deploy complete!
echo  Open: %URL%/
echo.
endlocal
