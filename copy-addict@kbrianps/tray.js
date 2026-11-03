// Tray icon (XApp status icon, shown by Cinnamon's tray applet) and its menu.
const Main = imports.ui.main;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const XApp = imports.gi.XApp;

const { _ } = require('./i18n');

const ICON = 'edit-paste-symbolic';
const ICON_INCOGNITO = 'view-conceal-symbolic';
const ICON_COPIED = 'object-select-symbolic';
const FLASH_MS = 650;

function menuIcon(name) {
    return new St.Icon({ icon_name: name, icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
}

class TrayMenu {
    constructor(manager, x, y) {
        this.manager = manager;
        this._closed = false;
        let stage = global.stage;
        // Transparent catcher: a click anywhere else closes the menu.
        this.actor = new St.Widget({ reactive: true, x: 0, y: 0, width: stage.width, height: stage.height });
        this.actor.connect('button-press-event', (a, ev) => {
            if (ev.get_source() === this.actor) { this.close(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('key-press-event', (a, ev) => this._onKey(ev));

        this.menu = new St.BoxLayout({ vertical: true, style_class: 'ca-menu', reactive: true });
        this.entries = [];
        this.index = -1;
        let s = manager.store.settings;
        this._add(_('Open clipboard history'), ICON, () => manager.open(), manager.shortcutLabel());
        this._add(_('Incognito mode'), s.incognito ? 'checkbox-checked-symbolic' : 'checkbox-symbolic', () => manager.toggleIncognito());
        this.menu.add_child(new St.Widget({ style_class: 'ca-menu-separator', height: 1 }));
        this._add(_('Clear history…'), 'edit-clear-all-symbolic', () => manager.openClearConfirm());
        this._add(_('Settings'), 'preferences-system-symbolic', () => manager.openSettings());
        this.actor.add_child(this.menu);
        Main.uiGroup.add_actor(this.actor);

        // Place under the icon, inside the monitor that contains it.
        let mon = Main.layoutManager.monitors.find(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height)
            || Main.layoutManager.primaryMonitor;
        let [, w] = this.menu.get_preferred_width(-1);
        let [, h] = this.menu.get_preferred_height(w);
        let mx = Math.max(mon.x + 8, Math.min(mon.x + mon.width - w - 8, x - w + 24));
        let my = y + 4;
        if (my + h > mon.y + mon.height - 8) my = Math.max(mon.y + 8, y - h - 36);
        this.menu.set_position(mx, my);

        if (!Main.pushModal(this.actor)) { this.actor.destroy(); this._closed = true; return; }
        global.stage.set_key_focus(this.actor);
    }

    _add(text, iconName, fn, accel) {
        let b = new St.Button({ style_class: 'ca-menu-item', reactive: true, can_focus: false, x_fill: true });
        let box = new St.BoxLayout({ style_class: 'ca-menu-item-box', x_expand: true });
        box.add_child(menuIcon(iconName));
        box.add_child(new St.Label({ text, x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        if (accel) box.add_child(new St.Label({ text: accel, style_class: 'ca-menu-accel', y_align: Clutter.ActorAlign.CENTER }));
        b.set_child(box);
        b.connect('clicked', () => { this.close(); fn(); });
        b.connect('enter-event', () => this._select(this.entries.indexOf(b)));
        this.menu.add_child(b);
        this.entries.push(b);
    }

    _select(i) {
        this.index = i;
        this.entries.forEach((e, j) => j === i ? e.add_style_pseudo_class('selected') : e.remove_style_pseudo_class('selected'));
    }

    _onKey(ev) {
        let sym = ev.get_key_symbol();
        let n = this.entries.length;
        if (sym === Clutter.KEY_Escape) this.close();
        else if (sym === Clutter.KEY_Down) this._select((this.index + 1) % n);
        else if (sym === Clutter.KEY_Up) this._select((this.index - 1 + n) % n);
        else if ((sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) && this.entries[this.index]) this.entries[this.index].emit('clicked', 1);
        return Clutter.EVENT_STOP;
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        Main.popModal(this.actor);
        this.actor.destroy();
    }
}

var TrayIcon = class TrayIcon {
    constructor(manager) {
        this.manager = manager;
        this._flashTimer = 0;
        this.icon = new XApp.StatusIcon();
        this.icon.set_name('copy-addict');
        this._releaseId = this.icon.connect('button-release-event', (icon, x, y, button, time, position) => this._onRelease(x, y, button));
        this.sync();
        this.icon.set_visible(true);
    }

    sync() {
        if (!this.icon) return;
        let inc = this.manager.store.settings.incognito;
        if (!this._flashTimer) this.icon.set_icon_name(inc ? ICON_INCOGNITO : ICON);
        this.icon.set_tooltip_text(inc ? _('copy-addict (incognito: not saving)') : _('copy-addict: clipboard history'));
    }

    // Brief check mark when something is copied.
    flash() {
        if (!this.icon || this.manager.store.settings.incognito) return;
        if (this._flashTimer) GLib.source_remove(this._flashTimer);
        this.icon.set_icon_name(ICON_COPIED);
        this._flashTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FLASH_MS, () => {
            this._flashTimer = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onRelease(x, y, button) {
        if (button === 1) this.manager.toggle();
        else if (button === 2) this.manager.toggleIncognito();
        else if (button === 3) {
            if (this._menu && !this._menu._closed) this._menu.close();
            this._menu = new TrayMenu(this.manager, x, y);
        }
    }

    destroy() {
        if (this._flashTimer) { GLib.source_remove(this._flashTimer); this._flashTimer = 0; }
        if (this._menu) this._menu.close();
        if (this.icon) {
            this.icon.disconnect(this._releaseId);
            this.icon.set_visible(false);
            this.icon.run_dispose();
            this.icon = null;
        }
    }
};
