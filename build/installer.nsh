; MMS installer/uninstaller customization — admin-password gate, data safety,
; and crisp high-DPI wizard art.
;
; Wired in via package.json -> build.nsis.include. electron-builder PREPENDS
; this file (the "shared header") to the generated installer script, so
; everything below is processed BEFORE the template body. Its macros are
; invoked from the template at these points:
;   customUnInit    -> inside un.onInit, BEFORE any file is removed
;   customUnInstall -> end of the uninstall section, AFTER files are removed
;
; ---------------------------------------------------------------------------
; High-DPI wizard art (why the logo used to look pixelated):
;
; The NSIS wizard is DPI-aware (ManifestDPIAware below), so on displays
; scaled above 100% the MUI2 controls grow with the DPI (dialog units track
; the font). MUI2 then loads the wizard/header bitmaps SCALED TO THE
; CONTROL ("FitControl": NSD_SetStretchedImage / SetBrandingImage
; /RESIZETOFIT all end in GDI LoadImage with explicit cx/cy) — the 100%
; art (164x314 / 150x57) got resampled by GDI, which is
; nearest-neighbor-grade: blocky, "pixelated" edges.
;
; Fix: scripts/gen-nsis-assets.py renders the same design at every Windows
; scale preset (100/125/150/175/200% -> build/installerSidebar.bmp,
; build/installerHeader.bmp + build/hidpi/*.bmp). The mms.HiDpiArt hook
; below runs from .onGUIInit / un.onGUIInit — AFTER MUI has extracted its
; 100% art, BEFORE any page displays it (exactly where MUI2 chains the
; MUI_CUSTOMFUNCTION_GUIINIT / MUI_CUSTOMFUNCTION_UNGUIINIT callbacks) —
; measures the real screen DPI and:
;   - wizard/sidebar: overwrites $PLUGINSDIR\modern-wizard.bmp with the
;     matching variant, so the later page load maps pixels 1:1;
;   - header: MUI already displayed the 100% bitmap by then, so the hook
;     re-loads the matching variant itself at the measured control size
;     (GetDlgItem 1046 -> GetClientRect -> LoadImage -> STM_SETIMAGE) and
;     frees the old bitmap.
; At 100% scaling nothing is swapped — the art is already pixel-perfect.
; Intermediate/custom DPIs pick the next preset up; the residual
; sub-pixel resample (a few px) is invisible.
;
; WHY THE HOOK IS WIRED AT FILE SCOPE (not via the template's
; customHeader hook): MUI2 generates .onGUIInit / un.onGUIInit when the
; FIRST language file is included (macro MUI_INSERT in MUI2.nsh), which
; in the generated script happens at "!insertmacro addLangs" — BEFORE the
; template reaches the customHeader insertion point. The
; MUI_CUSTOMFUNCTION_* defines must therefore already exist when this
; file is read. Defining them from customHeader would be too late: the
; callbacks would never be called (and the un. function would trip NSIS
; warning 6010 "uninstall function not referenced", which electron-builder
; turns into an error with makensis -WX).
;
; ---------------------------------------------------------------------------
; Uninstall gate design (main process + renderer implement the app side):
;   "$INSTDIR\${APP_EXECUTABLE_FILENAME}" --verify-uninstall
; shows a small MMS window asking for the mahallu administrator password.
; Exit codes: 0 = verified, 1 = declined/wrong password. Any other code
; (app missing/crashed) fails OPEN so a broken install can still be removed.
; Silent uninstalls (updates, reinstall-over) skip the gate entirely.
;
; Installer policy notes:
;   - perMachine:true -> default install dir is C:\Program Files\... (UAC);
;     the DATABASE and backups stay in %APPDATA%\mms per user (the app pins
;     its data folder to app.getPath("appData")\mms, independent of INSTDIR).
;   - The app never writes inside Program Files, so the unelevated app runs
;     fine from a per-machine install.

; Render the installer at native resolution instead of letting Windows
; DWM bitmap-stretch it on displays with scaling above 100%. Requires NSIS 3.03+;
; if makensis rejects it the Windows CI job fails fast and loudly.
ManifestDPIAware true

; =========================== high-DPI art =================================
; Callback wiring — must be defined here (file scope) because the template
; inserts languages (and with them MUI's .onGUIInit chain) before any of its
; custom macros. BUILD_UNINSTALLER marks the uninstaller compile pass; only
; there do uninstaller pages exist, so only there is the un. hook emitted
; (an unreferenced un. function is a makensis warning, and warnings are
; errors under electron-builder).

!define MUI_CUSTOMFUNCTION_GUIINIT mms.HiDpiArt

!macro MMS_HIDPI_ART FUNC
  ; Shared body for the installer and uninstaller hooks. Plain NSIS
  ; commands only (no LogicLib / message constants) so it expands safely
  ; in both contexts. Labels are function-local, so the two expansions
  ; cannot collide.
  Function ${FUNC}
    ; $0 = screen DC, $1 = LOGPIXELSX (96=100%, 120=125%, 144=150%,
    ; 168=175%, 192=200%). NSIS registers $0-$9 are free here: MUI calls
    ; this callback as the last statement of its .onGUIInit chain.
    ; Each ladder line is "IntCmp $1 <exact-preset-dpi> <variant> 0 <variant>":
    ; equal AND greater both select that variant; smaller falls through.
    System::Call 'USER32::GetDC(p0)p.r0'
    System::Call 'GDI32::GetDeviceCaps(pr0, i88)i.r1'
    System::Call 'USER32::ReleaseDC(p0, pr0)'
    IntCmp $1 96 mms_done mms_done 0     ; <= 96 DPI: art already 1:1

    InitPluginsDir

    ; ---- wizard/sidebar bitmap (loaded later, at finish-page show) ----
    IntCmp $1 192 mms_side200 0 mms_side200
    IntCmp $1 168 mms_side175 0 mms_side175
    IntCmp $1 144 mms_side150 0 mms_side150
    IntCmp $1 120 mms_side125 0 mms_side125
    IntCmp $1 97 mms_side125 mms_header mms_side125
    Goto mms_header
  mms_side200:
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerSidebar-200.bmp"
    Goto mms_header
  mms_side175:
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerSidebar-175.bmp"
    Goto mms_header
  mms_side150:
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerSidebar-150.bmp"
    Goto mms_header
  mms_side125:
    File "/oname=$PLUGINSDIR\modern-wizard.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerSidebar-125.bmp"

  mms_header:
    ; ---- header bitmap (already displayed by MUI at 100% size) ----
    GetDlgItem $2 $HWNDPARENT 1046
    StrCmp $2 0 mms_done
    IntCmp $1 192 mms_head200 0 mms_head200
    IntCmp $1 168 mms_head175 0 mms_head175
    IntCmp $1 144 mms_head150 0 mms_head150
    IntCmp $1 120 mms_head125 0 mms_head125
    Goto mms_done                       ; 97..119 DPI: header stays 1:1
                                       ; (a ~1.1x upscale is invisible at
                                       ; that strip's small size)
  mms_head200:
    File "/oname=$PLUGINSDIR\mms-header.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerHeader-200.bmp"
    Goto mms_head_load
  mms_head175:
    File "/oname=$PLUGINSDIR\mms-header.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerHeader-175.bmp"
    Goto mms_head_load
  mms_head150:
    File "/oname=$PLUGINSDIR\mms-header.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerHeader-150.bmp"
    Goto mms_head_load
  mms_head125:
    File "/oname=$PLUGINSDIR\mms-header.bmp" "${BUILD_RESOURCES_DIR}\hidpi\installerHeader-125.bmp"
  mms_head_load:
    ; Load at exactly the control's pixel size and swap it in.
    ; 0x0172 = STM_SETIMAGE, 0 = IMAGE_BITMAP, 0x10 = LR_LOADFROMFILE.
    ; The path goes through a register (MUI2's own pattern) so the
    ; System plugin never parses the expanded $PLUGINSDIR string.
    StrCpy $8 "$PLUGINSDIR\mms-header.bmp"
    System::Call 'USER32::GetClientRect(pr2, @r3)'
    System::Call '*$3(i, i, i.r4, i.r5)'
    System::Call 'USER32::LoadImage(p0, tr8, i0, ir4, ir5, i0x10) p.r6'
    StrCmp $6 0 mms_done
    SendMessage $2 0x0172 0 $6
    Pop $7                              ; STM_SETIMAGE returns the old bitmap
    StrCmp $7 0 mms_done
    System::Call 'GDI32::DeleteObject(pr7)'
  mms_done:
  FunctionEnd
!macroend

; Installer-side hook: emitted in every pass (MUI generates .onGUIInit
; unconditionally at the first language include; in the BUILD_UNINSTALLER
; pass the script quits before the GUI is ever created, which is harmless).
!insertmacro MMS_HIDPI_ART mms.HiDpiArt

!ifdef BUILD_UNINSTALLER
  ; Uninstaller-side hook: only in the uninstaller compile pass, where the
  ; uninstaller pages (and therefore un.onGUIInit) exist.
  !define MUI_CUSTOMFUNCTION_UNGUIINIT un.mms.HiDpiArt
  !insertmacro MMS_HIDPI_ART un.mms.HiDpiArt
!endif

; ======================= uninstall password gate ==========================

!macro customUnInit
  ; Skip the gate in silent mode (updates reinstall-over-silently).
  IfSilent mms_gate_passed
  ; Skip if the app executable is gone (nothing left to ask).
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 mms_gate_passed
    DetailPrint "MMS: verifying administrator password before uninstall..."
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --verify-uninstall' $0
    StrCmp "$0" "1" 0 mms_gate_passed
      MessageBox MB_OK|MB_ICONSTOP "Uninstall cancelled: the MMS administrator password is required to uninstall this application.$\r$\n$\r$\n(ഈ ആപ്പ് നീക്കം ചെയ്യാൻ MMS അഡ്മിൻ പാസ്‌വേഡ് ആവശ്യമാണ്.)"
      Abort
  mms_gate_passed:
!macroend

!macro customUnInstall
  ; Reassure the user after the uninstall finishes: the mahallu's database
  ; and backups live in %APPDATA%\mms and are NOT touched by the uninstaller.
  ; (perMachine uninstall runs elevated; when the elevating account is the
  ; same Windows user that uses MMS — the normal single-PC office case —
  ; $APPDATA points at that user's profile holding the data.)
  IfFileExists "$APPDATA\mms\mms.db" 0 mms_data_note_done
    MessageBox MB_OK|MB_ICONINFORMATION "MMS was uninstalled — your DATA IS SAFE.$\r$\n$\r$\nKept untouched at:$\r$\n$APPDATA\mms$\r$\n(database + backups)$\r$\n$\r$\nPlease do NOT delete that folder.$\r$\n(നിങ്ങളുടെ ഡാറ്റയും ബാക്കപ്പുകളും $APPDATA\mms ഫോൾഡറിൽ സുരക്ഷിതമായി നിലനിർത്തിയിട്ടുണ്ട് — ഈ ഫോൾഡർ ഇല്ലാതാക്കരുത്.)"
  mms_data_note_done:
!macroend
