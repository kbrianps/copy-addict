// Clipboard capture, type detection, and putting items back on the clipboard.
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Util = imports.misc.util;
const Main = imports.ui.main;

const CLIPBOARD = Meta.SelectionType.SELECTION_CLIPBOARD;
const PRIMARY = Meta.SelectionType.SELECTION_PRIMARY;
// GIF first so animations survive; then the formats Copyous accepts.
const IMAGE_MIMES = ['image/gif', 'image/png', 'image/webp', 'image/avif', 'image/jxl', 'image/jpeg', 'image/bmp', 'image/tiff'];
const FILE_MIMES = ['x-special/gnome-copied-files', 'text/uri-list'];
const TEXT_MIMES = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain', 'STRING'];
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const DEBOUNCE_MS = 80;
const PASTE_DELAY_MS = 160;
const COPY_SOUND = '/usr/share/sounds/Yaru/stereo/audio-volume-change.oga';   // same pop as the volume keys
const OWN_COPY_MS = 1000;
var TERMINALS = ['ghostty', 'gnome-terminal', 'kitty', 'alacritty', 'tilix', 'xterm', 'konsole', 'wezterm',
    'terminator', 'xfce4-terminal', 'mate-terminal', 'foot', 'urxvt', 'sakura', 'guake', 'terminology', 'blackbox', 'ptyxis'];

function log(msg) { global.log(`copy-addict: ${msg}`); }

function md5(data) {
    return typeof data === 'string'
        ? GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, data, -1)
        : GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5, data);
}

// ---------- Colors ----------
const NAMED_COLORS = ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
    'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid ' +
    'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown ' +
    'royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow ' +
    'springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' ');

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const COLOR_FUNC = new RegExp(`^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(\\s*[a-z-]*\\s*${NUM}(?:%|deg|turn|rad)?(?:\\s*[,\\s/]\\s*${NUM}(?:%|deg|turn|rad)?){2,3}\\s*\\)$`, 'i');

function isColor(t) {
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return true;
    if (COLOR_FUNC.test(t)) return true;
    return NAMED_COLORS.includes(t.toLowerCase());
}

function graphemeCount(t) {
    try { return [...new Intl.Segmenter().segment(t)].length; } catch (e) { return [...t].length; }
}

// Same order as Copyous: link, character, color, code, text.
function detectTextType(text, highlight) {
    let t = text.trim();
    if (/^https?:\/\//i.test(t) && !/\s/.test(t)) {
        try { if (GLib.uri_is_valid(t, GLib.UriFlags.NONE)) return { type: 'link' }; } catch (e) { }
    }
    if (graphemeCount(t) <= 1) return { type: 'character' };
    if (isColor(t)) return { type: 'color' };
    let lang = highlight.detectCode(text);
    if (lang) return { type: 'code', meta: { language: lang } };
    return { type: 'text' };
}

function parseFileList(raw) {
    let lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    let op = 'copy';
    if (lines.length && (lines[0].toLowerCase() === 'copy' || lines[0].toLowerCase() === 'cut')) op = lines.shift().toLowerCase();
    let uris = lines.filter(l => /^[a-z][a-z0-9+.-]*:/i.test(l));
    return { op, uris };
}

var Capture = class Capture {
    constructor(store, highlight, linkPreview) {
        this.store = store;
        this.highlight = highlight;
        this.linkPreview = linkPreview;
        this.onNewItem = null;      // callback(item) for genuinely new captures
        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._timer = 0;
        this._prev = null;          // [type, hash] of the last thing seen or set by us
        this._ownerId = this._selection.connect('owner-changed', (sel, type) => {
            if (type !== CLIPBOARD) return;
            if (this._timer) GLib.source_remove(this._timer);
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
                this._timer = 0;
                this._read();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    destroy() {
        if (this._ownerId) this._selection.disconnect(this._ownerId);
        if (this._timer) GLib.source_remove(this._timer);
    }

    _shouldSave(mimes) {
        if (this.store.settings.incognito) return false;
        if (mimes.includes('x-kde-passwordManagerHint')) return false;
        let excluded = this.store.settings.excludedWmClasses || [];
        if (excluded.length) {
            let w = global.display.focus_window;
            let cls = w ? `${w.get_wm_class() || ''} ${w.get_wm_class_instance() || ''}`.toLowerCase() : '';
            if (excluded.some(e => cls.split(' ').includes(e))) return false;
        }
        return true;
    }

    _transfer(mime, cb) {
        let stream = Gio.MemoryOutputStream.new_resizable();
        this._selection.transfer_async(CLIPBOARD, mime, -1, stream, null, (sel, res) => {
            try {
                sel.transfer_finish(res);
                stream.close(null);
                cb(stream.steal_as_bytes());
            } catch (e) {
                log(`transfer ${mime} failed: ${e}`);
                cb(null);
            }
        });
    }

    _read() {
        if (this.paused) return;
        let mimes = this._selection.get_mimetypes(CLIPBOARD) || [];
        if (!mimes.length) return;
        // Sound for every copy the user makes (not when we set the clipboard ourselves).
        if (Date.now() > (this._ownCopyUntil || 0)) this._playCopySound();
        if (!this._shouldSave(mimes)) return;

        let fileMime = FILE_MIMES.find(m => mimes.includes(m));
        let imageMime = IMAGE_MIMES.find(m => mimes.includes(m));
        let hasText = TEXT_MIMES.some(m => mimes.includes(m));

        // Files win (file managers also offer the path as text); then images; then text.
        if (fileMime) return this._readFiles(fileMime, () => hasText && this._readText());
        if (imageMime) return this._readImage(imageMime);
        if (hasText) this._readText();
    }

    _readText() {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (cb, text) => {
            if (!text || !text.trim()) return;
            let hash = md5(text);
            let det = detectTextType(text, this.highlight);
            this._save({ type: det.type, content: text, hash, meta: det.meta || {} });
        });
    }

    _readFiles(mime, fallback) {
        this._transfer(mime, bytes => {
            if (!bytes || !bytes.get_size()) return fallback && fallback();
            let raw = new TextDecoder().decode(bytes.toArray());
            let { op, uris } = parseFileList(raw);
            if (!uris.length) return fallback && fallback();
            let content = uris.join('\n');
            let hash = md5(content);
            this._save({ type: uris.length === 1 ? 'file' : 'files', content, hash, meta: { op } });
        });
    }

    _readImage(mime) {
        this._transfer(mime, bytes => {
            if (!bytes) return;
            let size = bytes.get_size();
            if (!size || size > MAX_IMAGE_BYTES) return;
            let hash = md5(bytes);
            let ext = mime.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
            let name = `${hash}.${ext}`;
            let path = GLib.build_filenamev([this._imageDir(), name]);
            try {
                if (!GLib.file_test(path, GLib.FileTest.EXISTS))
                    Gio.File.new_for_path(path).replace_contents(bytes.toArray(), null, false, Gio.FileCreateFlags.PRIVATE, null);
            } catch (e) { log(`image save failed: ${e}`); return; }
            let meta = { bytes: size };
            try {
                let fmt = GdkPixbuf.Pixbuf.get_file_info(path);
                if (fmt && fmt[0] !== null) { meta.width = fmt[1]; meta.height = fmt[2]; }
                if (mime === 'image/gif') {
                    let anim = GdkPixbuf.PixbufAnimation.new_from_file(path);
                    meta.animated = !anim.is_static_image();
                }
            } catch (e) { }
            this._save({ type: 'image', content: name, mime, hash, meta });
        });
    }

    _imageDir() {
        return GLib.build_filenamev([GLib.get_user_data_dir(), 'copy-addict', 'images']);
    }

    _save(entry) {
        // Skip what we just put on the clipboard ourselves, and repeats of the same copy.
        if (this._prev && this._prev[0] === entry.type && this._prev[1] === entry.hash) return;
        // A file manager often re-offers a copied file as plain text: ignore that echo.
        if (this._prev && (this._prev[0] === 'file' || this._prev[0] === 'files') && entry.type !== 'file' && entry.type !== 'files') {
            let paths = this._prevPaths || [];
            if (paths.includes(entry.content.trim())) return;
        }
        this._prev = [entry.type, entry.hash];
        this._prevPaths = (entry.type === 'file' || entry.type === 'files')
            ? entry.content.split('\n').map(u => { try { return GLib.filename_from_uri(u)[0]; } catch (e) { return u; } }) : null;
        let { item, isNew } = this.store.add(entry);
        if (item.type === 'link' && this.linkPreview) this.linkPreview.ensure(item);
        if (isNew && this.onNewItem) this.onNewItem(item);
    }

    _playCopySound() {
        if (this.store.settings.copySound === false) return;
        let file = this.store.settings.copySoundFile || COPY_SOUND;
        try { Main.soundManager.playSoundFile(0, file); } catch (e) { }
    }

    // ---------- Put back ----------
    copy(item) {
        this._ownCopyUntil = Date.now() + OWN_COPY_MS;
        this._prev = [item.type, item.hash];
        try {
            if (item.type === 'image') {
                let [ok, contents] = GLib.file_get_contents(this.store.imagePath(item));
                if (!ok) return false;
                let source = Meta.SelectionSourceMemory.new(item.mime || 'image/png', new GLib.Bytes(contents));
                this._selection.set_owner(CLIPBOARD, source);
            } else if (item.type === 'file' || item.type === 'files') {
                let data = 'copy\n' + item.content;
                let source = Meta.SelectionSourceMemory.new('x-special/gnome-copied-files', new GLib.Bytes(new TextEncoder().encode(data)));
                this._selection.set_owner(CLIPBOARD, source);
            } else {
                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.content);
            }
        } catch (e) {
            log(`copy failed: ${e}`);
            return false;
        }
        this.store.touch(item);    // Copyous: update-date-on-copy
        return true;
    }

    copyText(text) {
        this._ownCopyUntil = Date.now() + OWN_COPY_MS;
        this._prev = ['text', md5(text)];
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    }

    // Copy, then send the paste keys to the focused window.
    paste(item, asText) {
        if (asText !== undefined) this.copyText(asText);
        else if (!this.copy(item)) return;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
            let win = global.display.focus_window;
            let cls = win ? `${win.get_wm_class() || ''} ${win.get_wm_class_instance() || ''}`.toLowerCase() : '';
            let terminal = TERMINALS.some(t => cls.includes(t));
            Util.spawn(['xdotool', 'key', '--clearmodifiers', terminal ? 'ctrl+shift+v' : 'ctrl+v']);
            return GLib.SOURCE_REMOVE;
        });
    }

    // Re-run type detection (used after highlight.js loads, and for migrated items).
    redetect(item) {
        if (['image', 'file', 'files'].includes(item.type)) return false;
        let det = detectTextType(item.content, this.highlight);
        if (det.type === item.type && JSON.stringify(det.meta || {}) === JSON.stringify(item.meta && item.meta.language ? { language: item.meta.language } : {})) return false;
        item.type = det.type;
        item.meta = Object.assign({}, item.meta, det.meta || {});
        if (det.type !== 'code') delete item.meta.language;
        delete item._cache;
        return true;
    }
};

var Helpers = { md5, isColor, detectTextType, parseFileList };
