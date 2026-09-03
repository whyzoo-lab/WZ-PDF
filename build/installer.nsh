; Custom NSIS steps for the WZ PDF installer.
;
; Adds the install directory to the user's PATH so the console converters
; (hwp2pdf, hwp2hwpx, hwpx2hwp) run from any terminal, and takes it back out
; on uninstall.
;
; Why PowerShell rather than NSIS string handling: a standard makensis build
; truncates strings at NSIS_MAX_STRLEN (1024). Reading a longer PATH and writing
; it back would silently destroy the entries past the cut — a real way to break
; someone's machine. The registry API has no such limit, preserves REG_EXPAND_SZ
; so entries like %USERPROFILE%\bin stay unexpanded, and makes the "already
; there?" test exact instead of a substring guess.
;
; The install directory is handed over in an environment variable, never
; interpolated into the script text, so a path containing a quote (C:\Users\
; O'Brien\...) cannot break — or escape — the command.

!include WinMessages.nsh

!macro WzPdfPathScript ps
  System::Call 'kernel32::SetEnvironmentVariable(t "WZPDF_DIR", t "$INSTDIR")'
  ; Full path on purpose. A bare "powershell" is searched for in the installer's
  ; own directory first (usually Downloads), so a powershell.exe dropped beside
  ; the installer would run with the installer's token - Administrator when the
  ; user chose a per-machine install.
  nsExec::ExecToLog "$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $\"${ps}$\""
  Pop $0
  ; Tell already-running shells and Explorer to re-read the environment.
  SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=3000
!macroend

!macro customInstall
  DetailPrint "Adding $INSTDIR to PATH so hwp2pdf / hwp2hwpx / hwpx2hwp work from any terminal..."
  ; Remove-then-append keeps this idempotent across reinstalls and upgrades.
  !insertmacro WzPdfPathScript "$$d=$$env:WZPDF_DIR; $$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment'); $$c=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$p=@($$c -split ';' | Where-Object {$$_ -ne '' -and $$_ -ne $$d}); $$k.SetValue('Path',(($$p + $$d) -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString); $$k.Close()"
!macroend

!macro customUnInstall
  DetailPrint "Removing $INSTDIR from PATH..."
  ; Only our own entry is dropped; everything else is written back untouched.
  !insertmacro WzPdfPathScript "$$d=$$env:WZPDF_DIR; $$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$$true); if($$k){$$c=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$p=@($$c -split ';' | Where-Object {$$_ -ne '' -and $$_ -ne $$d}); $$k.SetValue('Path',($$p -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString); $$k.Close()}"
!macroend
