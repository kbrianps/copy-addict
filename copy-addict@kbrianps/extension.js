// copy-addict: clipboard history for Cinnamon, modelled on Copyous (GNOME).
// Super+V opens the bar; Super+Ctrl+Shift+V toggles incognito mode.
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Util = imports.misc.util;
const { _ } = require('./i18n');

const StoreMod = require('./store');
const Highlight = require('./highlight');
const CaptureMod = require('./capture');
const LinkPreviewMod = require('./linkPreview');
const DialogMod = require('./dialog');
const TrayMod = require('./tray');

const UUID = 'copy-addict@kbrianps';
const SESSION_FILE = GLib.build_filenamev([StoreMod.DATA_DIR, 'session']);

// settings-schema.json key -> store.settings key (with an optional conversion)
const SETTING_MAP = {
    'history-length': ['historyLength'],
    'history-minutes': ['historyMinutes'],
    'on-new-session': ['onNewSession'],
    'protect-pinned': ['protectPinned'],
    'protect-tagged': ['protectTagged'],
    'paste-on-select': ['pasteOnSelect'],
    'copy-sound': ['copySound'],
    'show-tray-icon': ['showTrayIcon'],
    'incognito': ['incognito'],
    'excluded-apps': ['excludedWmClasses', v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)],
    'position': ['position'],
    'item-width': ['itemWidth'],
    'item-height': ['itemHeight'],
    'image-fit': ['imageBackgroundSize'],
    'shortcut-open': ['shortcutOpen'],
    'shortcut-incognito': ['shortcutIncognito'],
};

let manager = null;

function log(msg) { global.log(`copy-addict: ${msg}`); }

function readFile(path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : null;
    } catch (e) { return null; }
}

class Manager {
    constructor(metadata) {
        this.store = new StoreMod.Store();
        this.highlight = Highlight;
        this.dialog = null;
        this.tray = null;

        this._bindSettings();
        // Writes from the UI (incognito button) go back to the settings file.
        this.store.setSetting = (key, value) => this._setSetting(key, value);
        this._applyNewSessionPolicy();

        this.linkPreview = new LinkPreviewMod.LinkPreview(this.store);
        this.capture = new CaptureMod.Capture(this.store, Highlight, this.linkPreview);
        this.capture.onNewItem = () => { if (this.tray) this.tray.flash(); };

        this._bindKeys();
        this._syncTray();

        // Code detection needs highlight.js: re-check items once it is loaded.
        Highlight.load(() => {
            if (manager !== this) return;
            let changed = 0;
            for (let item of this.store.items) {
                if (item.needsDetect || item.type === 'text' || item.type === 'code') {
                    if (this.capture.redetect(item)) changed++;
                    delete item.needsDetect;
                }
            }
            if (changed) { this.store.save(); log(`re-detected ${changed} items`); }
        });

        // Build the bar in the background so the first Super+V is instant.
        this._prebuildId = GLib.timeout_add(GLib.PRIORITY_LOW, 1500, () => {
            this._prebuildId = 0;
            if (manager === this && !this.dialog) this._ensureDialog();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------- settings ----------
    _bindSettings() {
        this.xs = new Settings.ExtensionSettings(this, UUID);
        for (let key of Object.keys(SETTING_MAP)) {
            let prop = 'cfg_' + key.replace(/-/g, '_');
            this.xs.bind(key, prop, () => this._settingChanged(key));
            this._copySetting(key);
        }
    }

    _copySetting(key) {
        let [name, conv] = SETTING_MAP[key];
        let value = this['cfg_' + key.replace(/-/g, '_')];
        this.store.settings[name] = conv ? conv(value) : value;
    }

    _settingChanged(key) {
        this._copySetting(key);
        if (key === 'history-length' || key === 'history-minutes') { if (this.store.trim()) this.store.save(); this.store._emit(); }
        if (key === 'shortcut-open' || key === 'shortcut-incognito') this._bindKeys();
        if (key === 'show-tray-icon' || key === 'incognito') this._syncTray();
        if (this.dialog) this.dialog._syncHeader();
    }

    _setSetting(name, value) {
        let key = Object.keys(SETTING_MAP).find(k => SETTING_MAP[k][0] === name);
        this.store.settings[name] = value;
        if (key) this.xs.setValue(key, value);
        this._syncTray();
        if (this.dialog) this.dialog._syncHeader();
    }

    // Copyous "clipboard-history": what to keep when a new login starts.
    _applyNewSessionPolicy() {
        let id = `${readFile('/proc/sys/kernel/random/boot_id') || ''}:${GLib.getenv('XDG_SESSION_ID') || ''}`;
        let last = readFile(SESSION_FILE);
        try { GLib.file_set_contents(SESSION_FILE, id); } catch (e) { }
        if (!last || last === id) return;      // same login (e.g. Cinnamon restart)
        let policy = this.store.settings.onNewSession;
        if (policy === 'clear') this.store.clear(true);
        else if (policy === 'keep-pinned-and-tagged') this.store.clear(false);
    }

    _bindKeys() {
        let s = this.store.settings;
        Main.keybindingManager.addHotKey('copy-addict-open', s.shortcutOpen || '<Super>v', () => this.toggle());
        Main.keybindingManager.addHotKey('copy-addict-incognito', s.shortcutIncognito || '', () => this.toggleIncognito());
    }

    shortcutLabel() {
        let k = (this.store.settings.shortcutOpen || '').split('::')[0];
        return k.replace(/<Super>/g, 'Super+').replace(/<Control>|<Primary>/g, 'Ctrl+').replace(/<Shift>/g, 'Shift+')
            .replace(/<Alt>/g, 'Alt+').replace(/\+([a-z])$/, (m, c) => '+' + c.toUpperCase());
    }

    _syncTray() {
        let want = this.store.settings.showTrayIcon !== false;
        if (want && !this.tray) {
            try { this.tray = new TrayMod.TrayIcon(this); } catch (e) { log(`tray: ${e}`); }
        } else if (!want && this.tray) {
            this.tray.destroy();
            this.tray = null;
        }
        if (this.tray) this.tray.sync();
    }

    // ---------- actions ----------
    _ensureDialog() {
        if (!this.dialog) this.dialog = new DialogMod.Dialog(this);
        return this.dialog;
    }

    toggle() {
        try {
            let d = this._ensureDialog();
            if (d.isOpen) d.close(); else d.open();
        } catch (e) {
            global.logError(`copy-addict: open failed: ${e}\n${e.stack}`);
        }
    }

    open() {
        try { let d = this._ensureDialog(); if (!d.isOpen) d.open(); } catch (e) { global.logError(`copy-addict: open failed: ${e}`); }
    }

    openClearConfirm() {
        this.open();
        if (this.dialog && this.dialog.isOpen) this.dialog._openClearConfirm();
    }

    openSettings() {
        if (this.dialog && this.dialog.isOpen) this.dialog.close();
        Util.spawn(['xlet-settings', 'extension', UUID]);
    }

    toggleIncognito() {
        let on = !this.store.settings.incognito;
        this._setSetting('incognito', on);
        let text = on ? _('copy-addict: incognito mode on') : _('copy-addict: incognito mode off');
        try {
            if (Main.osdWindowManager) Main.osdWindowManager.show(-1, null, text);
            else Main.notify('copy-addict', text);
        } catch (e) { Main.notify('copy-addict', text); }
    }

    // Draw the bar without grabbing input (debug/screenshots only).
    preview(on) {
        if (this._preview) { this._preview.destroy(); this._preview = null; }
        if (on) { this._preview = new DialogMod.Dialog(this, { preview: true }); this._preview.open(); }
        return this._preview;
    }

    updateContent(item, text) {
        let hash = CaptureMod.Helpers.md5(text);
        this.store.update(item, { content: text, hash });
        if (this.capture.redetect(item)) this.store.save();
        if (item.type === 'link') { delete item.meta.link; this.linkPreview.ensure(item); }
    }

    destroy() {
        if (this._prebuildId) GLib.source_remove(this._prebuildId);
        Main.keybindingManager.removeHotKey('copy-addict-open');
        Main.keybindingManager.removeHotKey('copy-addict-incognito');
        if (this._preview) this._preview.destroy();
        if (this.dialog) this.dialog.destroy();
        if (this.tray) this.tray.destroy();
        this.capture.destroy();
        this.linkPreview.destroy();
        this.store.destroy();
        if (this.xs) this.xs.finalize();
    }
}

function init(metadata) { }

function enable() {
    try {
        manager = new Manager();
        global.__copyAddict = manager;   // for debugging from Looking Glass
        log(`enabled, ${manager.store.items.length} items`);
    } catch (e) {
        global.logError(`copy-addict: enable failed: ${e}\n${e.stack}`);
    }
}

function disable() {
    if (manager) {
        try { manager.destroy(); } catch (e) { global.logError(`copy-addict: disable: ${e}`); }
    }
    manager = null;
    delete global.__copyAddict;
}
