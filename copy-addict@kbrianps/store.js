// History storage: items in a JSON file, images as files next to it.
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const { _, ngettext } = require('./i18n');

var DATA_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'copy-addict']);
var IMAGE_DIR = GLib.build_filenamev([DATA_DIR, 'images']);
var CACHE_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'copy-addict']);
const HISTORY_FILE = GLib.build_filenamev([DATA_DIR, 'history.json']);
const SETTINGS_FILE = GLib.build_filenamev([DATA_DIR, 'settings.json']);
const SAVE_DELAY_MS = 250;

var TAGS = [
    { id: 'blue', get name() { return _('Blue'); }, color: '#3584e4' },
    { id: 'teal', get name() { return _('Teal'); }, color: '#2190a4' },
    { id: 'green', get name() { return _('Green'); }, color: '#3a944a' },
    { id: 'yellow', get name() { return _('Yellow'); }, color: '#c88800' },
    { id: 'orange', get name() { return _('Orange'); }, color: '#ed5b00' },
    { id: 'red', get name() { return _('Red'); }, color: '#e62d42' },
    { id: 'pink', get name() { return _('Pink'); }, color: '#d56199' },
    { id: 'purple', get name() { return _('Purple'); }, color: '#9c3cbe' },
    { id: 'slate', get name() { return _('Slate'); }, color: '#6f8396' },
];

var DEFAULT_SETTINGS = {
    historyLength: 30,          // unpinned and untagged items kept
    historyMinutes: 0,          // 0 = no time limit
    incognito: false,
    protectPinned: true,
    protectTagged: true,
    itemWidth: 250,
    itemHeight: 170,
    imageBackgroundSize: 'cover',
    excludedWmClasses: [],
};

function log(msg) { global.log(`copy-addict: ${msg}`); }

function readJson(path) {
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
    let [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(bytes));
}

function writeJson(path, data) {
    GLib.file_set_contents(path, JSON.stringify(data));
    GLib.chmod(path, 0o600);
}

let _idCounter = 0;
function newId() {
    _idCounter = (_idCounter + 1) % 100000;
    return `${Date.now().toString(36)}-${_idCounter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

var Store = class Store {
    constructor() {
        GLib.mkdir_with_parents(IMAGE_DIR, 0o700);
        GLib.mkdir_with_parents(CACHE_DIR, 0o700);
        this.items = [];
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        this._saveTimer = 0;
        this._listeners = [];
        this._loadSettings();
        this._load();
        this.trim();
        this._cleanOrphanImages();
    }

    onChange(fn) { this._listeners.push(fn); }
    _emit() { for (let fn of this._listeners) { try { fn(); } catch (e) { log(`listener: ${e}`); } } }

    // ---------- settings ----------
    _loadSettings() {
        try {
            let s = readJson(SETTINGS_FILE);
            if (s) Object.assign(this.settings, s);
        } catch (e) { log(`settings load failed: ${e}`); }
    }

    setSetting(key, value) {
        this.settings[key] = value;
        try { writeJson(SETTINGS_FILE, this.settings); } catch (e) { log(`settings save failed: ${e}`); }
        this._emit();
    }

    // ---------- items ----------
    _load() {
        try {
            let data = readJson(HISTORY_FILE);
            if (!data) return;
            let items = data.items || [];
            if ((data.version || 1) < 2) items = items.map(i => this._migrateV1(i)).filter(Boolean);
            this.items = items.filter(i => i && typeof i.content === 'string' && i.type);
            this.items.sort((a, b) => b.time - a.time);
        } catch (e) {
            log(`load failed: ${e}`);
            // Keep the broken file for inspection instead of overwriting it.
            try { Gio.File.new_for_path(HISTORY_FILE).move(Gio.File.new_for_path(HISTORY_FILE + '.broken'), Gio.FileCopyFlags.OVERWRITE, null, null); } catch (e2) { }
            this.items = [];
        }
    }

    _migrateV1(i) {
        if (i.type === 'text' && typeof i.text === 'string')
            return { id: newId(), type: 'text', content: i.text, hash: i.hash, pinned: !!i.pinned, tag: null, title: null, time: i.time, meta: {}, needsDetect: true };
        if (i.type === 'image' && i.image)
            return { id: newId(), type: 'image', content: i.image, mime: i.mime || 'image/png', hash: i.hash, pinned: !!i.pinned, tag: null, title: null, time: i.time, meta: {} };
        return null;
    }

    save() {
        if (this._saveTimer) return;
        this._saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveTimer = 0;
            this.saveNow();
            return GLib.SOURCE_REMOVE;
        });
    }

    saveNow() {
        if (this._saveTimer) { GLib.source_remove(this._saveTimer); this._saveTimer = 0; }
        try {
            let items = this.items.map(i => {
                let copy = Object.assign({}, i);
                delete copy._cache;
                return copy;
            });
            writeJson(HISTORY_FILE, { version: 2, items });
        } catch (e) { log(`save failed: ${e}`); }
    }

    imagePath(item) {
        return GLib.build_filenamev([IMAGE_DIR, item.content]);
    }

    isProtected(item) {
        return (this.settings.protectPinned && item.pinned) || (this.settings.protectTagged && !!item.tag);
    }

    // Insert a new capture, or move an identical one to the front.
    add(entry) {
        let existing = this.items.find(i => i.type === entry.type && i.hash === entry.hash);
        if (existing) {
            existing.time = Date.now();
            if (entry.meta) existing.meta = Object.assign({}, existing.meta, entry.meta);
            this._resort();
            this.save();
            this._emit();
            return { item: existing, isNew: false };
        }
        let item = Object.assign({ id: newId(), pinned: false, tag: null, title: null, meta: {} }, entry, { time: Date.now() });
        this.items.unshift(item);
        this.trim();
        this.save();
        this._emit();
        return { item, isNew: true };
    }

    touch(item) {
        item.time = Date.now();
        this._resort();
        this.save();
        this._emit();
    }

    _resort() { this.items.sort((a, b) => b.time - a.time); }

    update(item, changes) {
        Object.assign(item, changes);
        delete item._cache;
        // Editing can make it identical to another item: keep the edited one.
        if ('content' in changes) {
            let dup = this.items.find(i => i !== item && i.type === item.type && i.hash === item.hash);
            if (dup) {
                item.pinned = item.pinned || dup.pinned;
                item.tag = item.tag || dup.tag;
                this._removeRaw(dup);
            }
        }
        this.trim();
        this.save();
        this._emit();
    }

    trim() {
        let limit = this.settings.historyLength;
        let maxAge = this.settings.historyMinutes > 0 ? this.settings.historyMinutes * 60000 : 0;
        let now = Date.now();
        let kept = 0;
        let removed = [];
        this.items = this.items.filter(i => {
            if (i.pinned || i.tag) return true;
            if (maxAge && now - i.time > maxAge) { removed.push(i); return false; }
            kept++;
            if (kept <= limit) return true;
            removed.push(i);
            return false;
        });
        removed.forEach(i => this._deleteFiles(i));
        return removed.length;
    }

    _removeRaw(item) {
        this.items = this.items.filter(i => i !== item);
        this._deleteFiles(item);
    }

    remove(item) {
        this._removeRaw(item);
        this.save();
        this._emit();
    }

    clear(includeProtected) {
        let removed = this.items.filter(i => includeProtected || !(i.pinned || i.tag));
        this.items = this.items.filter(i => !removed.includes(i));
        removed.forEach(i => this._deleteFiles(i));
        this.save();
        this._emit();
    }

    _deleteFiles(item) {
        if (item.type !== 'image') return;
        if (this.items.some(i => i.type === 'image' && i.content === item.content)) return;
        try { Gio.File.new_for_path(this.imagePath(item)).delete(null); } catch (e) { }
    }

    _cleanOrphanImages() {
        try {
            let used = new Set(this.items.filter(i => i.type === 'image').map(i => i.content));
            let dir = Gio.File.new_for_path(IMAGE_DIR);
            let en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null)) !== null) {
                let name = info.get_name();
                if (!used.has(name)) {
                    try { dir.get_child(name).delete(null); } catch (e) { }
                }
            }
            en.close(null);
        } catch (e) { log(`orphan cleanup: ${e}`); }
    }

    destroy() {
        this.saveNow();
        this._listeners = [];
    }
};
