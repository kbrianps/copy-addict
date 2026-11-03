#!/usr/bin/env bash
# Install copy-addict for the current user.
#   ./install.sh          copy the extension
#   ./install.sh --dev    symlink it to this checkout (edit and reload)
#   NO_HIGHLIGHT=1 ./install.sh   skip downloading highlight.js
set -euo pipefail

UUID="copy-addict@kbrianps"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/$UUID"
DEST="$HOME/.local/share/cinnamon/extensions/$UUID"
DATA="$HOME/.local/share/copy-addict"
LOCALE="$HOME/.local/share/locale"

HLJS_URL="https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/es/highlight.min.js"
HLJS_SHA256="7865839949f0764d9e0a21e311a4e2c42633eeaee8ca5ec127b86438565731fe"

mode="copy"
[ "${1:-}" = "--dev" ] && mode="link"

for cmd in xdotool msgfmt; do
    command -v "$cmd" >/dev/null || echo "warning: '$cmd' not found (sudo apt install ${cmd/msgfmt/gettext})"
done

mkdir -p "$(dirname "$DEST")" "$DATA"
rm -rf "$DEST"
if [ "$mode" = "link" ]; then
    ln -s "$SRC" "$DEST"
else
    cp -r "$SRC" "$DEST"
fi
echo "extension: $DEST ($mode)"

# Translations
if command -v msgfmt >/dev/null; then
    for po in "$SRC"/po/*.po; do
        lang="$(basename "$po" .po)"
        mkdir -p "$LOCALE/$lang/LC_MESSAGES"
        msgfmt -o "$LOCALE/$lang/LC_MESSAGES/$UUID.mo" "$po"
    done
    echo "translations: installed"
fi

# highlight.js powers code detection and syntax colours (optional).
if [ "${NO_HIGHLIGHT:-0}" != "1" ] && [ ! -f "$DATA/highlight.min.js" ]; then
    tmp="$(mktemp)"
    if curl -fsSL "$HLJS_URL" -o "$tmp" && echo "$HLJS_SHA256  $tmp" | sha256sum -c --status; then
        mv "$tmp" "$DATA/highlight.min.js"
        echo "highlight.js: installed"
    else
        rm -f "$tmp"
        echo "highlight.js: download failed or checksum mismatch; code items will show as plain text"
    fi
fi

# Enable the extension
current="$(gsettings get org.cinnamon enabled-extensions)"
if ! grep -q "'$UUID'" <<<"$current"; then
    if [ "$current" = "@as []" ] || [ "$current" = "[]" ]; then
        gsettings set org.cinnamon enabled-extensions "['$UUID']"
    else
        gsettings set org.cinnamon enabled-extensions "${current%]}, '$UUID']"
    fi
    echo "enabled"
else
    echo "already enabled; restart Cinnamon to load the new version (Ctrl+Alt+Esc)"
fi
