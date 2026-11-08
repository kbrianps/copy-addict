// KWin script loaded by copy-addict: reports the active window, so the app knows
// where a copy came from (ignored apps) and where it pastes (terminals get Ctrl+Shift+V).
function report(w) {
    if (!w) return;
    callDBus("org.kbrianps.CopyAddict", "/KWinBridge", "org.kbrianps.CopyAddict.KWinBridge", "windowActivated",
        String(w.resourceClass || ""), String(w.resourceName || ""), String(w.caption || ""));
}
workspace.windowActivated.connect(report);
report(workspace.activeWindow);
