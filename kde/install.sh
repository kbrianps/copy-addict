#!/usr/bin/env bash
# Build and install copy-addict for KDE Plasma (Wayland) for the current user.
#   ./install.sh                 build, install to ~/.local and start it at every login
#   NO_SERVICE=1 ./install.sh    install, but do not enable the login service
#   NO_HIGHLIGHT=1 ./install.sh  skip downloading highlight.js
#   ./install.sh --uninstall
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
BIN="$PREFIX/bin/copy-addict"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/copy-addict"
DESKTOP="org.kbrianps.copy-addict.desktop"

HLJS_URL="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/es/highlight.min.js"
HLJS_SHA256="7865839949f0764d9e0a21e311a4e2c42633eeaee8ca5ec127b86438565731fe"

if [ "${1:-}" = "--uninstall" ]; then
    systemctl --user disable --now copy-addict.service 2>/dev/null || true
    rm -f "$BIN" "$APPS/$DESKTOP" "$UNITS/copy-addict.service"
    find "$PREFIX/share/locale" -name copy-addict.mo -delete 2>/dev/null || true
    systemctl --user daemon-reload
    command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true
    echo "uninstalled (history kept in $DATA)"
    exit 0
fi

cmake -S "$HERE" -B "$HERE/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" >/dev/null
cmake --build "$HERE/build"
cmake --install "$HERE/build" >/dev/null
echo "binary: $BIN"

# KWin grants the paste keys (fake input) only to programs listed in a .desktop file
# whose Exec is the program's absolute path.
mkdir -p "$APPS" "$UNITS" "$DATA"
sed "s|@BIN@|$BIN|g" "$HERE/data/$DESKTOP" > "$APPS/$DESKTOP"
sed "s|@BIN@|$BIN|g" "$HERE/data/copy-addict.service" > "$UNITS/copy-addict.service"
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true
echo "desktop file: $APPS/$DESKTOP"

# highlight.js powers code detection and syntax colours (optional).
if [ "${NO_HIGHLIGHT:-0}" != "1" ] && [ ! -f "$DATA/highlight.min.js" ]; then
    tmp="$(mktemp)"
    if curl -fsSL "$HLJS_URL" -o "$tmp" && echo "$HLJS_SHA256  $tmp" | sha256sum -c --status; then
        install -m 600 "$tmp" "$DATA/highlight.min.js"
        echo "highlight.js: installed"
    else
        echo "highlight.js: download failed or checksum mismatch; code items will show as plain text"
    fi
    rm -f "$tmp"
fi

systemctl --user daemon-reload
if [ "${NO_SERVICE:-0}" = "1" ]; then
    echo "service not enabled; start it with: systemctl --user start copy-addict"
    exit 0
fi
systemctl --user enable copy-addict.service >/dev/null 2>&1
systemctl --user restart copy-addict.service
echo "running: press Meta+V"
