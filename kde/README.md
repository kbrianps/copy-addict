# copy-addict for KDE Plasma

Clipboard history for KDE Plasma 6 on Wayland, modelled on [Copyous](https://github.com/boerdereinar/copyous) for GNOME. It is a native Qt 6 / QML app, ported from the Cinnamon extension in this repository.

Press <kbd>Meta</kbd>+<kbd>V</kbd>, pick something you copied earlier, and it is pasted into the app you were using.

## Features

Everything the Cinnamon version has:

- **Every kind of copy**, each with its own card: text, code (syntax colours, line numbers), links (title, description, image), images (animated GIFs too), files (image, text or thumbnail preview), lists of files, colours and single characters.
- **Paste on select** into the focused window. Terminals get <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.
- **Search** that ignores accents, plus filters by type, tag and pinned items.
- **Pin and tag** items with 9 colours. Pinned and tagged items are protected and never expire.
- **Per-item menu**: edit the item or its title, open it, show it in its folder, paste as path, convert a colour (Hex / RGB / HSL).
- **Incognito mode** pauses recording. Password-manager copies (`x-kde-passwordManagerHint`) are never saved.
- **Tray icon**: left click opens the bar, middle click toggles incognito, right click opens a menu.
- **Settings window** in the KDE style, and the shortcuts live in *System Settings → Shortcuts → copy-addict*.
- English and Brazilian Portuguese.

The history file is the same as the Cinnamon version's, so moving from Cinnamon to Plasma keeps your history.

## Install

Requires Plasma 6 on Wayland (KWin), Qt 6.6+ and KDE Frameworks 6.

```sh
sudo apt install cmake ninja-build extra-cmake-modules qt6-base-dev qt6-declarative-dev qt6-wayland-dev \
    libkf6guiaddons-dev libkf6globalaccel-dev libkf6statusnotifieritem-dev libkf6i18n-dev \
    liblayershellqtinterface-dev plasma-wayland-protocols libwayland-dev gettext
cd kde
./install.sh
```

`install.sh` builds the app into `~/.local`, installs its `.desktop` file, enables a systemd user service that starts it at login, and downloads [highlight.js](https://highlightjs.org/) 11.11.1 (checking its SHA-256) for code detection. Options: `NO_SERVICE=1` (do not start at login), `NO_HIGHLIGHT=1` (code shows as plain text), `--uninstall`.

## How it works on Wayland

- **Reading the clipboard** in the background uses `KSystemClipboard` (the data-control protocol), like Klipper.
- **The bar** is a layer-shell surface over the work area of the active monitor, so it sits above windows and keeps the keyboard while open.
- **Pasting** sends <kbd>Ctrl</kbd>+<kbd>V</kbd> through KWin's fake-input protocol. KWin grants it only to programs whose `.desktop` file lists `org_kde_kwin_fake_input` in `X-KDE-Wayland-Interfaces` and whose `Exec` is the program's absolute path. `install.sh` writes that file.
- **The active window** (for terminals and ignored apps) comes from a small KWin script that the app loads at start and reports over D-Bus.

## Keys

| Key | Action |
|---|---|
| <kbd>Meta</kbd>+<kbd>V</kbd> | Open / close the bar |
| <kbd>Meta</kbd>+<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Toggle incognito mode |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd> | Move between items |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Go to the search box / back to the items |
| <kbd>Enter</kbd> or click | Paste |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Copy without pasting |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Default action (open link or file) |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> or middle click | Pin / unpin |
| <kbd>Delete</kbd> (<kbd>Shift</kbd>+<kbd>Delete</kbd> for protected items) | Delete |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> / <kbd>Ctrl</kbd>+<kbd>T</kbd> | Edit item / edit title |
| <kbd>Ctrl</kbd>+<kbd>A</kbd> or right click | Item menu (tags with <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd> clears) |
| <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>0</kbd> | Jump to item 1–10 |
| <kbd>Ctrl</kbd>+<kbd>Tab</kbd> / scroll on the search box | Cycle the type filter |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, <kbd>Ctrl</kbd>+<kbd>`</kbd> | Tag filter |
| <kbd>Alt</kbd> | Show pinned items only |
| typing | Search |
| <kbd>Esc</kbd> | Clear the search, then close |

## Command line and D-Bus

```sh
copy-addict --toggle      # open or close the bar
copy-addict --settings    # settings window
copy-addict --preview     # draw the bar without taking the keyboard (screenshots)
copy-addict --hide
copy-addict --quit
qdbus6 org.kbrianps.CopyAddict /CopyAddict pasteItem 1   # paste the second most recent item
```

## Data

- **History:** `~/.local/share/copy-addict/history.json`, readable only by you. Images are kept next to it.
- **Settings:** `~/.config/copy-addict/settings.json`.
- **Link previews:** cached in `~/.cache/copy-addict/`.

## Development

```sh
cmake -S . -B build -G Ninja && cmake --build build && cmake --install build --prefix ~/.local
systemctl --user restart copy-addict
journalctl --user -u copy-addict -f
```

Translations: `po/pt_BR/copy-addict.po`, template in `tools/copy-addict.pot`.

Two quirks of Qt's JavaScript engine are worked around when loading highlight.js: it rejects `__proto__: null` in object literals and Unicode property escapes (`\p{...}`) in regular expressions, so the app loads a patched copy from `~/.cache/copy-addict/`.

## License

GPL-3.0-or-later. highlight.js is BSD-3-Clause. It is downloaded at install time, not bundled.
