// The clipboard bar (Super+V): header with filters and search, cards, menus and editors.
const Main = imports.ui.main;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Pango = imports.gi.Pango;
const Util = imports.misc.util;
const { _, ngettext } = require('./i18n');

const Items = require('./items');
const StoreMod = require('./store');

const MARGIN = 6;
const KEYCODE_DIGITS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];   // 1..9, 0 on the digit row

function log(msg) { global.log(`copy-addict: ${msg}`); }

function fold(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function icon(name, size) {
    return new St.Icon({ icon_name: name, icon_type: St.IconType.SYMBOLIC, icon_size: size || 16 });
}

function button(cls, child, fn) {
    let b = new St.Button({ style_class: cls, reactive: true, can_focus: false });
    if (typeof child === 'string') b.set_label(child); else if (child) b.set_child(child);
    if (fn) b.connect('clicked', () => fn());
    return b;
}

function hexOf(c) {
    let h = n => n.toString(16).padStart(2, '0');
    return `#${h(c.red)}${h(c.green)}${h(c.blue)}${c.alpha < 255 ? h(c.alpha) : ''}`;
}

function rgbOf(c) {
    return c.alpha < 255 ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${+(c.alpha / 255).toFixed(3)})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
}

function hslOf(c) {
    let r = c.red / 255, g = c.green / 255, b = c.blue / 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    let base = `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
    return c.alpha < 255 ? `hsla(${base}, ${+(c.alpha / 255).toFixed(3)})` : `hsl(${base})`;
}

var Dialog = class Dialog {
    // opts.preview: draw without grabbing keyboard/mouse (for screenshots while someone is typing).
    constructor(manager, opts) {
        opts = opts || {};
        this.preview = !!opts.preview;
        this.manager = manager;
        this.store = manager.store;
        this.cards = [];
        this.visible = [];
        this.focusIndex = 0;            // -1 = search box
        this.typeFilter = null;
        this.tagFilter = null;
        this.pinnedOnly = false;
        this._popup = null;             // open menu / editor / confirm
        this._inlineEdit = null;
        this._closed = true;            // "not open"; the actors live as long as the extension
        this._dirty = true;
        this._cache = new Map();        // item id -> { card, sig }

        this.area = { x: 0, y: 0, width: 800, height: 600 };
        this.actor = new St.Widget({ reactive: true, style_class: 'ca-backdrop', visible: false });
        this.actor.connect('button-press-event', (a, ev) => {
            if (ev.get_source() === this.actor) {
                if (this._popup) this._closePopup(); else this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('key-press-event', (a, ev) => this._onKey(ev));

        this.panel = new St.BoxLayout({ vertical: true, style_class: 'ca-panel', reactive: true });
        this.actor.add_child(this.panel);
        this._buildHeader();

        this.scroll = new St.ScrollView({ style_class: 'ca-scroll', x_fill: true, y_fill: true });
        this.scroll.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.NEVER);
        this.row = new St.BoxLayout({ style_class: 'ca-row' });
        this.scroll.add_actor(this.row);
        this.scroll.connect('scroll-event', (a, ev) => this._onScroll(ev));
        this.panel.add_child(this.scroll);

        this.emptyBox = new St.BoxLayout({ vertical: true, style_class: 'ca-empty', x_align: Clutter.ActorAlign.CENTER });
        this.emptyIcon = icon('edit-paste-symbolic', 40);
        this.emptyLabel = new St.Label({ text: '', style_class: 'ca-empty-label', x_align: Clutter.ActorAlign.CENTER });
        this.emptyBox.add_child(this.emptyIcon);
        this.emptyBox.add_child(this.emptyLabel);
        this.panel.add_child(this.emptyBox);

        Main.uiGroup.add_actor(this.actor);
        this._storeListener = () => {
            if (this._closed) { this._dirty = true; return; }
            if (!this._inlineEdit && !this._popup) this.refresh(true);
        };
        this.store.onChange(this._storeListener);
        this.refresh(false);   // build the cards now, while hidden, so opening is instant
    }

    get isOpen() { return !this._closed; }

    // Show on the monitor under the pointer. Returns false if input could not be grabbed.
    open() {
        if (!this._closed) return true;
        let monitorIndex = this._pointerMonitorIndex();
        let ws = global.workspace_manager.get_active_workspace();
        this.area = ws.get_work_area_for_monitor(monitorIndex);
        let mon = Main.layoutManager.monitors[monitorIndex];
        this.actor.set_position(mon.x, mon.y);
        this.actor.set_size(mon.width, mon.height);
        this.panel.set_width(this.area.width - 2 * MARGIN * global.ui_scale);

        // Copyous default: search and filters start fresh every time.
        this._ignoreSearch = true;
        this.search.set_text('');
        this._ignoreSearch = false;
        this.typeFilter = null;
        this.tagFilter = null;
        this.pinnedOnly = false;
        this.focusIndex = 0;
        this._syncHeader();
        this._closed = false;
        this.refresh(false);
        Main.uiGroup.set_child_above_sibling(this.actor, null);
        this.actor.show();
        this._place();
        this.cards.forEach(c => c.resume());
        let adj = this.scroll.get_hscroll_bar().get_adjustment();
        adj.value = 0;

        if (this.preview) {
            this.actor.reactive = false;
            return true;
        }
        if (!Main.pushModal(this.actor)) {
            log('could not grab input');
            this._hide();
            return false;
        }
        this._focusSearchEntry();
        return true;
    }

    _pointerMonitorIndex() {
        let [px, py] = global.get_pointer();
        let mons = Main.layoutManager.monitors;
        let i = mons.findIndex(mm => px >= mm.x && px < mm.x + mm.width && py >= mm.y && py < mm.y + mm.height);
        return i >= 0 ? i : Main.layoutManager.primaryIndex;
    }

    // Bottom of the work area (Copyous setting the user had: bottom, fill, horizontal).
    _place() {
        let m = MARGIN * global.ui_scale;
        let mon = this.actor;
        let [, natH] = this.panel.get_preferred_height(this.panel.width);
        let x = this.area.x - mon.x + m;
        let y = this.store.settings.position === 'top'
            ? this.area.y - mon.y + m
            : this.area.y - mon.y + this.area.height - natH - m;
        this.panel.set_position(x, y);
    }

    // ---------- header ----------
    _buildHeader() {
        let h = new St.BoxLayout({ style_class: 'ca-header' });

        this.incognitoBtn = button('ca-header-button', icon('view-conceal-symbolic'), () => {
            this.store.setSetting('incognito', !this.store.settings.incognito);
            this._syncHeader();
        });
        h.add_child(this.incognitoBtn);

        let searchBox = new St.BoxLayout({ style_class: 'ca-search-box', x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        this.filterBtn = button('ca-filter-button', null, () => this._openFilterMenu());
        this.filterBtnBox = new St.BoxLayout({ style_class: 'ca-filter-box' });
        this.filterIcon = icon('edit-find-symbolic', 14);
        this.filterArrow = icon('pan-down-symbolic', 12);
        this.filterBtnBox.add_child(this.filterIcon);
        this.filterBtnBox.add_child(this.filterArrow);
        this.filterBtn.set_child(this.filterBtnBox);
        this.filterBtn.connect('button-press-event', (a, ev) => {
            if (ev.get_button() === 2) { this.typeFilter = null; this.tagFilter = null; this._filtersChanged(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
        searchBox.add_child(this.filterBtn);

        this.search = new St.Entry({ style_class: 'ca-search', hint_text: _('Type to search'), can_focus: true, x_expand: true });
        this.search.clutter_text.connect('text-changed', () => {
            if (this._ignoreSearch) return;
            this.focusIndex = 0;
            this.refresh(false);
        });
        this.search.connect('scroll-event', (a, ev) => this._onSearchScroll(ev));
        searchBox.add_child(this.search);

        this.pinFilterBtn = button('ca-pin-filter', icon('view-pin-symbolic', 14), () => { this.pinnedOnly = !this.pinnedOnly; this._filtersChanged(); });
        searchBox.add_child(this.pinFilterBtn);
        h.add_child(searchBox);

        this.countLabel = new St.Label({ text: '', style_class: 'ca-count', y_align: Clutter.ActorAlign.CENTER });
        h.add_child(this.countLabel);
        this.clearBtn = button('ca-header-button ca-clear', _('Clear'), () => this._openClearConfirm());
        h.add_child(this.clearBtn);
        this.panel.add_child(h);
        this._syncHeader();
    }

    _syncHeader() {
        let inc = this.store.settings.incognito;
        this.incognitoBtn.child.icon_name = inc ? 'view-conceal-symbolic' : 'view-reveal-symbolic';
        if (inc) this.incognitoBtn.add_style_pseudo_class('checked'); else this.incognitoBtn.remove_style_pseudo_class('checked');
        this.filterIcon.icon_name = this.typeFilter ? Items.TYPE_INFO[this.typeFilter].icon : 'edit-find-symbolic';
        let tag = this.tagFilter && this.tagById(this.tagFilter);
        this.filterBtn.style = tag ? `color: ${tag.color};` : null;
        if (this.typeFilter || this.tagFilter) this.filterBtn.add_style_pseudo_class('checked'); else this.filterBtn.remove_style_pseudo_class('checked');
        if (this.pinnedOnly) this.pinFilterBtn.add_style_pseudo_class('checked'); else this.pinFilterBtn.remove_style_pseudo_class('checked');
        let hint = [];
        if (this.typeFilter) hint.push(Items.TYPE_INFO[this.typeFilter].name);
        if (tag) hint.push(tag.name);
        if (this.pinnedOnly) hint.push(_('Pinned'));
        this.search.hint_text = hint.length ? _('Search in: %s').format(hint.join(' · ')) : (inc ? _('Incognito: nothing new is saved') : _('Type to search'));
    }

    tagById(id) { return StoreMod.TAGS.find(t => t.id === id); }

    _filtersChanged() {
        this.focusIndex = 0;
        this._syncHeader();
        this.refresh(false);
    }

    // ---------- list ----------
    _matches(item, q) {
        if (this.typeFilter && item.type !== this.typeFilter) return false;
        if (this.tagFilter && item.tag !== this.tagFilter) return false;
        if (this.pinnedOnly && !item.pinned) return false;
        if (!q) return true;
        let fields = [item.title];
        if (item.type === 'file' || item.type === 'files') {
            for (let u of item.content.split('\n')) {
                let p = Items.Helpers.uriToPath(u) || u;
                fields.push(p, Items.Helpers.prettyPath(p));
            }
        } else if (item.type !== 'image') {
            fields.push(item.content);
            if (item.meta && item.meta.link) fields.push(item.meta.link.title, item.meta.link.description);
        }
        return fields.some(f => f && fold(f).includes(q));
    }

    refresh(keepFocus) {
        let focusedId = keepFocus && this.visible[this.focusIndex] ? this.visible[this.focusIndex].id : null;
        let q = fold(this.search.get_text().trim());
        this.visible = this.store.items.filter(i => this._matches(i, q));
        this.row.remove_all_children();     // keep the actors; they are cached
        let alive = new Set(this.store.items.map(i => i.id));
        for (let [id, c] of this._cache) {
            if (!alive.has(id)) { c.card.actor.destroy(); this._cache.delete(id); }
        }
        this.cards = this.visible.map(item => {
            let sig = this._signature(item);
            let c = this._cache.get(item.id);
            if (c && c.sig !== sig) { c.card.actor.destroy(); c = null; }
            if (!c) {
                c = { card: new Items.ItemCard(this, item), sig };
                this._cache.set(item.id, c);
            } else {
                c.card.updateTime();
            }
            return c.card;
        });
        this.cards.forEach(c => this.row.add_child(c.actor));
        this._dirty = false;
        let n = this.visible.length;
        this.scroll.visible = n > 0;
        this.emptyBox.visible = n === 0;
        let filtering = q || this.typeFilter || this.tagFilter || this.pinnedOnly;
        this.emptyIcon.icon_name = filtering ? 'edit-find-symbolic' : 'edit-paste-symbolic';
        this.emptyLabel.text = filtering ? _('No items found') : _('Clipboard is empty');
        this.countLabel.text = ngettext('%d item', '%d items', n).format(n);
        if (focusedId) {
            let i = this.visible.findIndex(it => it.id === focusedId);
            this.focusIndex = i >= 0 ? i : Math.min(this.focusIndex, n - 1);
        }
        if (this.focusIndex >= n) this.focusIndex = n - 1;
        if (n === 0) this.focusIndex = -1;
        else if (this.focusIndex < -1) this.focusIndex = 0;
        this._applyFocus();
        if (this.panel.get_parent()) this._place();
    }

    // Anything that changes how a card looks.
    _signature(item) {
        let m = item.meta || {};
        return [item.hash, item.type, item.pinned ? 1 : 0, item.tag || '', item.title || '',
            m.link ? 1 : 0, m.language ? m.language.id : '', this.store.settings.itemWidth, this.store.settings.itemHeight,
            this.store.settings.imageBackgroundSize].join('|');
    }

    _applyFocus() {
        this.cards.forEach((c, i) => c.setFocused(i === this.focusIndex));
        if (this.focusIndex === -1) this.search.add_style_pseudo_class('focus'); else this.search.remove_style_pseudo_class('focus');
        if (this.focusIndex >= 0) GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._scrollToFocus(); return GLib.SOURCE_REMOVE; });
    }

    _setFocus(i) {
        if (!this.cards.length) { this.focusIndex = -1; return this._applyFocus(); }
        this.focusIndex = Math.max(-1, Math.min(this.cards.length - 1, i));
        this._applyFocus();
    }

    // Keep the focused card centred, like Copyous.
    _scrollToFocus() {
        if (this._closed) return;
        let card = this.cards[this.focusIndex];
        if (!card) return;
        let adj = this.scroll.get_hscroll_bar().get_adjustment();
        let target = card.actor.x + card.actor.width / 2 - adj.page_size / 2;
        target = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, target));
        if (adj.ease) adj.ease(target, { duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        else adj.value = target;
    }

    _onScroll(ev) {
        let adj = this.scroll.get_hscroll_bar().get_adjustment();
        let step = (this.store.settings.itemWidth + 10) * global.ui_scale;
        let dir = ev.get_scroll_direction();
        let delta = 0;
        if (dir === Clutter.ScrollDirection.UP || dir === Clutter.ScrollDirection.LEFT) delta = -step;
        else if (dir === Clutter.ScrollDirection.DOWN || dir === Clutter.ScrollDirection.RIGHT) delta = step;
        else if (dir === Clutter.ScrollDirection.SMOOTH) {
            let [dx, dy] = ev.get_scroll_delta();
            delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * step * 0.5;
        }
        adj.value = Math.max(adj.lower, Math.min(adj.upper - adj.page_size, adj.value + delta));
        return Clutter.EVENT_STOP;
    }

    // Scroll on the search box cycles the type filter; Ctrl+scroll cycles the tag.
    _onSearchScroll(ev) {
        let dir = ev.get_scroll_direction();
        let step = 0;
        if (dir === Clutter.ScrollDirection.UP) step = -1;
        else if (dir === Clutter.ScrollDirection.DOWN) step = 1;
        else if (dir === Clutter.ScrollDirection.SMOOTH) { let [, dy] = ev.get_scroll_delta(); step = dy > 0 ? 1 : dy < 0 ? -1 : 0; }
        if (!step) return Clutter.EVENT_STOP;
        let ctrl = (ev.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if (ctrl) this._cycleTag(step); else this._cycleType(step);
        return Clutter.EVENT_STOP;
    }

    _cycleType(step) {
        let list = [null, ...Items.TYPE_ORDER];
        let i = list.indexOf(this.typeFilter);
        this.typeFilter = list[(i + step + list.length) % list.length];
        this._filtersChanged();
    }

    _cycleTag(step) {
        let list = [null, ...StoreMod.TAGS.map(t => t.id)];
        let i = list.indexOf(this.tagFilter);
        this.tagFilter = list[(i + step + list.length) % list.length];
        this._filtersChanged();
    }

    // ---------- keyboard ----------
    _focusSearchEntry() {
        if (this.preview) return;
        global.stage.set_key_focus(this.search.clutter_text);
    }

    _setKeyFocus(actor) {
        if (!this.preview) global.stage.set_key_focus(actor);
    }

    _onKey(ev) {
        if (this._closed) return Clutter.EVENT_STOP;
        if (this._inlineEdit) return Clutter.EVENT_PROPAGATE;
        if (this._popup) return this._popup.onKey ? this._popup.onKey(ev) : Clutter.EVENT_PROPAGATE;

        let sym = ev.get_key_symbol();
        let state = ev.get_state();
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        let shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        let code = ev.get_key_code();
        let onItem = this.focusIndex >= 0;
        let item = this.visible[this.focusIndex];
        let text = this.search.get_text();

        if (sym === Clutter.KEY_Escape) {
            if (text) { this.search.set_text(''); return Clutter.EVENT_STOP; }
            this.close();
            return Clutter.EVENT_STOP;
        }
        // Ctrl+Shift+1..9 toggles a tag filter (by key position, so it works with any layout).
        if (ctrl && shift && KEYCODE_DIGITS.includes(code)) {
            let i = KEYCODE_DIGITS.indexOf(code);
            let tag = i < 9 ? StoreMod.TAGS[i].id : null;
            this.tagFilter = this.tagFilter === tag ? null : tag;
            this._filtersChanged();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && !shift && KEYCODE_DIGITS.includes(code)) {
            let i = KEYCODE_DIGITS.indexOf(code);
            this._setFocus(i === 9 ? 9 : i);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Alt_L || sym === Clutter.KEY_Alt_R || sym === Clutter.KEY_ISO_Level3_Shift) {
            this.pinnedOnly = !this.pinnedOnly;
            this._filtersChanged();
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (sym === Clutter.KEY_Tab || sym === Clutter.KEY_ISO_Left_Tab)) {
            this._cycleType(shift || sym === Clutter.KEY_ISO_Left_Tab ? -1 : 1);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (sym === Clutter.KEY_grave || sym === Clutter.KEY_asciitilde || sym === Clutter.KEY_dead_grave || sym === Clutter.KEY_dead_tilde)) {
            this._cycleTag(shift || sym === Clutter.KEY_asciitilde || sym === Clutter.KEY_dead_tilde ? -1 : 1);
            return Clutter.EVENT_STOP;
        }
        if (ctrl && (sym === Clutter.KEY_f || sym === Clutter.KEY_F)) {
            this._setFocus(-1);
            this.search.clutter_text.set_selection(0, -1);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Tab && !ctrl) {
            this._setFocus(onItem ? -1 : 0);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter || sym === Clutter.KEY_ISO_Enter) {
            let target = item || this.visible[0];
            if (target) this.choose(target, shift, ctrl);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_space && onItem && !text) {
            this.choose(item, shift, ctrl);
            return Clutter.EVENT_STOP;
        }
        if (sym === Clutter.KEY_BackSpace && !text && (this.typeFilter || this.tagFilter)) {
            this.typeFilter = null;
            this.tagFilter = null;
            this._filtersChanged();
            return Clutter.EVENT_STOP;
        }
        if (onItem) {
            switch (sym) {
                case Clutter.KEY_Right: case Clutter.KEY_KP_Right:
                    this._setFocus(this.focusIndex + 1); return Clutter.EVENT_STOP;
                case Clutter.KEY_Left: case Clutter.KEY_KP_Left:
                    this._setFocus(Math.max(0, this.focusIndex - 1)); return Clutter.EVENT_STOP;
                case Clutter.KEY_Up: case Clutter.KEY_KP_Up:
                    this._setFocus(-1); return Clutter.EVENT_STOP;
                case Clutter.KEY_Down: case Clutter.KEY_KP_Down:
                    return Clutter.EVENT_STOP;
                case Clutter.KEY_Home: case Clutter.KEY_KP_Home:
                    this._setFocus(0); return Clutter.EVENT_STOP;
                case Clutter.KEY_End: case Clutter.KEY_KP_End:
                    this._setFocus(this.cards.length - 1); return Clutter.EVENT_STOP;
                case Clutter.KEY_Page_Down:
                    this._setFocus(this.focusIndex + this._pageSize()); return Clutter.EVENT_STOP;
                case Clutter.KEY_Page_Up:
                    this._setFocus(Math.max(0, this.focusIndex - this._pageSize())); return Clutter.EVENT_STOP;
                case Clutter.KEY_Delete: case Clutter.KEY_KP_Delete:
                    if (item) this.deleteItem(item, shift); return Clutter.EVENT_STOP;
            }
            if (ctrl && item) {
                switch (sym) {
                    case Clutter.KEY_s: case Clutter.KEY_S: this.togglePin(item); return Clutter.EVENT_STOP;
                    case Clutter.KEY_e: case Clutter.KEY_E: this.openEditor(item); return Clutter.EVENT_STOP;
                    case Clutter.KEY_t: case Clutter.KEY_T: this.cards[this.focusIndex].editTitle(); return Clutter.EVENT_STOP;
                    case Clutter.KEY_a: case Clutter.KEY_A: this.openItemMenu(this.cards[this.focusIndex]); return Clutter.EVENT_STOP;
                    case Clutter.KEY_c: case Clutter.KEY_C: this.activate(item, 'copy'); return Clutter.EVENT_STOP;
                }
            }
        } else {
            if ((sym === Clutter.KEY_Down || sym === Clutter.KEY_KP_Down) && this.cards.length) {
                this._setFocus(0);
                return Clutter.EVENT_STOP;
            }
        }
        // Everything else (typing, Backspace, caret keys in search) goes to the search box.
        return Clutter.EVENT_PROPAGATE;
    }

    _pageSize() {
        let w = (this.store.settings.itemWidth + 10) * global.ui_scale;
        return Math.max(1, Math.floor(this.scroll.width / w));
    }

    beginInlineEdit(entry, commit) {
        this._inlineEdit = { entry, commit };
        this._setKeyFocus(entry.clutter_text);
        entry.clutter_text.connect('key-focus-out', () => { if (this._inlineEdit && this._inlineEdit.entry === entry) commit(); });
    }

    endInlineEdit() {
        this._inlineEdit = null;
        this._focusSearchEntry();
    }

    // ---------- item actions ----------
    // Enter / click / Space. With "paste on select" off, plain choose copies and Shift pastes.
    choose(item, shift, ctrl) {
        if (ctrl) return this.activate(item, 'action');
        let paste = this.store.settings.pasteOnSelect !== false;
        if (shift) paste = !paste;
        this.activate(item, paste ? 'paste' : 'copy');
    }

    activate(item, mode) {
        let cap = this.manager.capture;
        if (mode === 'copy') {
            cap.copy(item);
            this.close();
        } else if (mode === 'action') {
            this.close();
            this._defaultAction(item);
        } else {
            this.close();
            cap.paste(item);
        }
    }

    _defaultAction(item) {
        let cap = this.manager.capture;
        switch (item.type) {
            case 'link': return this._open(item.content.trim());
            case 'file': return this._open(item.content.trim());
            case 'files': return this.manager.capture.paste(item, this._paths(item).join(' '));
            case 'image': return this._open(GLib.filename_to_uri(this.store.imagePath(item), null));
            default: return cap.paste(item);
        }
    }

    _paths(item) {
        if (item.type === 'image') return [this.store.imagePath(item)];
        return item.content.split('\n').map(u => Items.Helpers.uriToPath(u) || u);
    }

    _quote(p) { return /[^\w@%+=:,./-]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p; }

    _open(uri) {
        try { Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1)); }
        catch (e) { Util.spawn(['xdg-open', uri]); }
    }

    _showInFolder(item) {
        let path = this._paths(item)[0];
        let uri = GLib.filename_to_uri(path, null);
        Util.spawn(['dbus-send', '--session', '--dest=org.freedesktop.FileManager1', '--type=method_call',
            '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems', `array:string:${uri}`, 'string:']);
    }

    togglePin(item) {
        this.store.update(item, { pinned: !item.pinned });
        this.refresh(true);
    }

    setTag(item, tagId) {
        this.store.update(item, { tag: item.tag === tagId ? null : tagId });
        this.refresh(true);
    }

    setTitle(item, title) {
        this.store.update(item, { title });
        this.refresh(true);
    }

    deleteItem(item, force) {
        if (!force && this.store.isProtected(item)) {
            this._flash(_('Protected item: use Shift+Delete to delete it'));
            return;
        }
        this.store.remove(item);
        this.refresh(true);
    }

    _flash(text) {
        this.countLabel.text = text;
        if (this._flashTimer) GLib.source_remove(this._flashTimer);
        this._flashTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2200, () => {
            this._flashTimer = 0;
            if (!this._closed) this.countLabel.text = ngettext('%d item', '%d items', this.visible.length).format(this.visible.length);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ---------- popups ----------
    _showPopup(popup, x, y) {
        this._closePopup();
        this._popup = popup;
        this.actor.add_child(popup.actor);
        let [, natW] = popup.actor.get_preferred_width(-1);
        let [, natH] = popup.actor.get_preferred_height(natW);
        let maxX = this.actor.width - natW - 8, maxY = this.actor.height - natH - 8;
        popup.actor.set_position(Math.max(8, Math.min(maxX, x)), Math.max(8, Math.min(maxY, y)));
        this._setKeyFocus(popup.focus || this.actor);
    }

    _closePopup() {
        if (!this._popup) return;
        let p = this._popup;
        this._popup = null;
        p.actor.destroy();
        if (!this._closed) this._focusSearchEntry();
    }

    _menuPopup(title) {
        let actor = new St.BoxLayout({ vertical: true, style_class: 'ca-menu', reactive: true });
        if (title) actor.add_child(new St.Label({ text: title, style_class: 'ca-menu-title' }));
        let entries = [];
        let popup = { actor, entries, index: -1 };
        popup.add = (text, iconName, fn, accel) => {
            let b = new St.Button({ style_class: 'ca-menu-item', reactive: true, can_focus: false, x_fill: true });
            let box = new St.BoxLayout({ style_class: 'ca-menu-item-box', x_expand: true });
            box.add_child(icon(iconName || 'empty-symbolic', 16));
            box.add_child(new St.Label({ text, x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
            if (accel) box.add_child(new St.Label({ text: accel, style_class: 'ca-menu-accel', y_align: Clutter.ActorAlign.CENTER }));
            b.set_child(box);
            b.connect('clicked', () => fn());
            b.connect('enter-event', () => popup.select(entries.indexOf(b)));
            actor.add_child(b);
            entries.push(b);
            return b;
        };
        popup.separator = () => actor.add_child(new St.Widget({ style_class: 'ca-menu-separator', height: 1 }));
        popup.select = i => {
            popup.index = i;
            entries.forEach((e, j) => j === i ? e.add_style_pseudo_class('selected') : e.remove_style_pseudo_class('selected'));
        };
        popup.onKey = ev => {
            let sym = ev.get_key_symbol();
            if (sym === Clutter.KEY_Escape) { this._closePopup(); return Clutter.EVENT_STOP; }
            if (sym === Clutter.KEY_Down) { popup.select((popup.index + 1) % entries.length); return Clutter.EVENT_STOP; }
            if (sym === Clutter.KEY_Up) { popup.select((popup.index - 1 + entries.length) % entries.length); return Clutter.EVENT_STOP; }
            if ((sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter || sym === Clutter.KEY_space) && entries[popup.index]) {
                entries[popup.index].emit('clicked', 1); return Clutter.EVENT_STOP;
            }
            if (popup.onExtraKey) return popup.onExtraKey(ev);
            return Clutter.EVENT_STOP;
        };
        return popup;
    }

    openItemMenu(card, x, y) {
        let item = card.item;
        let i = this.cards.indexOf(card);
        if (i >= 0) this._setFocus(i);
        let popup = this._menuPopup();

        // Tag row: 1..9 toggles, 0 clears.
        let tagRow = new St.BoxLayout({ style_class: 'ca-tag-row' });
        StoreMod.TAGS.forEach((t, idx) => {
            let b = new St.Button({ style_class: 'ca-tag-dot', reactive: true, can_focus: false });
            b.style = `background-color: ${t.color};`;
            if (item.tag === t.id) { b.add_style_pseudo_class('checked'); b.set_child(icon('object-select-symbolic', 12)); }
            b.connect('clicked', () => { this._closePopup(); this.setTag(item, t.id); });
            tagRow.add_child(b);
        });
        popup.actor.add_child(tagRow);
        popup.onExtraKey = ev => {
            let code = ev.get_key_code();
            let n = KEYCODE_DIGITS.indexOf(code);
            if (n >= 0) {
                this._closePopup();
                if (n === 9) { this.store.update(item, { tag: null }); this.refresh(true); }
                else this.setTag(item, StoreMod.TAGS[n].id);
            }
            return Clutter.EVENT_STOP;
        };
        popup.separator();

        let close = fn => () => { this._closePopup(); fn(); };
        popup.add(_('Paste'), 'edit-paste-symbolic', close(() => this.activate(item, 'paste')), 'Enter');
        popup.add(_('Copy without pasting'), 'edit-copy-symbolic', close(() => this.activate(item, 'copy')), 'Shift+Enter');
        if (['text', 'code', 'link', 'color', 'character'].includes(item.type))
            popup.add(_('Edit'), 'document-edit-symbolic', close(() => this.openEditor(item)), 'Ctrl+E');
        popup.add(_('Edit title'), 'insert-text-symbolic', close(() => card.editTitle()), 'Ctrl+T');
        if (item.type === 'link') popup.add(_('Open in browser'), 'web-browser-symbolic', close(() => { this.close(); this._open(item.content.trim()); }), 'Ctrl+Enter');
        if (item.type === 'file' || item.type === 'image') {
            popup.add(_('Open'), 'document-open-symbolic', close(() => { this.close(); this._defaultAction(item); }), item.type === 'file' ? 'Ctrl+Enter' : '');
            popup.add(_('Show in folder'), 'folder-open-symbolic', close(() => { this.close(); this._showInFolder(item); }));
        }
        if (['file', 'files', 'image'].includes(item.type))
            popup.add(_('Paste as path'), 'insert-link-symbolic', close(() => { this.close(); this.manager.capture.paste(item, this._paths(item).map(p => this._quote(p)).join(' ')); }));
        if (item.type === 'color') {
            let c = Items.Helpers.parseCssColor(item.content);
            if (c) {
                let cur = item.content.trim();
                [['Hex', hexOf(c)], ['RGB', rgbOf(c)], ['HSL', hslOf(c)]].forEach(([n, v]) => {
                    if (v.toLowerCase() !== cur.toLowerCase())
                        popup.add(_('Paste as %s: %s').format(n, v), 'applications-graphics-symbolic', close(() => { this.close(); this.manager.capture.paste(item, v); }));
                });
            }
        }
        popup.separator();
        popup.add(item.pinned ? _('Unpin') : _('Pin'), 'view-pin-symbolic', close(() => this.togglePin(item)), 'Ctrl+S');
        popup.add(_('Delete'), 'user-trash-symbolic', close(() => this.deleteItem(item, true)), 'Del');

        if (x === undefined) {
            let [cx, cy] = card.actor.get_transformed_position();
            x = cx - this.actor.x + 8;
            y = cy - this.actor.y - 8;
            let [, natH] = popup.actor.get_preferred_height(-1);
            y -= natH;
        } else {
            x -= this.actor.x; y -= this.actor.y;
        }
        this._showPopup(popup, x, y);
        popup.select(0);
    }

    _openFilterMenu() {
        let popup = this._menuPopup(_('Filter'));
        let tagRow = new St.BoxLayout({ style_class: 'ca-tag-row' });
        StoreMod.TAGS.forEach(t => {
            let b = new St.Button({ style_class: 'ca-tag-dot', reactive: true, can_focus: false });
            b.style = `background-color: ${t.color};`;
            if (this.tagFilter === t.id) { b.add_style_pseudo_class('checked'); b.set_child(icon('object-select-symbolic', 12)); }
            b.connect('clicked', () => { this._closePopup(); this.tagFilter = this.tagFilter === t.id ? null : t.id; this._filtersChanged(); });
            tagRow.add_child(b);
        });
        popup.actor.add_child(tagRow);
        popup.separator();
        let set = t => () => { this._closePopup(); this.typeFilter = t; this._filtersChanged(); };
        let all = popup.add(_('All'), 'edit-select-all-symbolic', set(null));
        if (!this.typeFilter) all.add_style_class_name('ca-menu-current');
        Items.TYPE_ORDER.forEach(t => {
            let b = popup.add(Items.TYPE_INFO[t].name, Items.TYPE_INFO[t].icon, set(t));
            if (this.typeFilter === t) b.add_style_class_name('ca-menu-current');
        });
        let [bx, by] = this.filterBtn.get_transformed_position();
        this._showPopup(popup, bx - this.actor.x, 0);
        let [, natH] = popup.actor.get_preferred_height(-1);
        popup.actor.set_position(popup.actor.x, Math.max(8, by - this.actor.y - natH - 6));
        popup.select(Math.max(0, this.typeFilter ? Items.TYPE_ORDER.indexOf(this.typeFilter) + 1 : 0));
    }

    openEditor(item) {
        if (!['text', 'code', 'link', 'color', 'character'].includes(item.type)) return;
        let actor = new St.BoxLayout({ vertical: true, style_class: 'ca-editor', reactive: true });
        actor.add_child(new St.Label({ text: _('Edit item'), style_class: 'ca-editor-title' }));
        let entry = new St.Entry({ style_class: 'ca-editor-entry' + (item.type === 'code' ? ' ca-mono' : ''), text: item.content, can_focus: true });
        entry.clutter_text.single_line_mode = false;
        entry.clutter_text.activatable = false;
        entry.clutter_text.line_wrap = true;
        entry.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        let sv = new St.ScrollView({ style_class: 'ca-editor-scroll', x_fill: true, y_fill: true });
        sv.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        let box = new St.BoxLayout({ vertical: true });
        box.add_child(entry);
        sv.add_actor(box);
        actor.add_child(sv);
        let buttons = new St.BoxLayout({ style_class: 'ca-editor-buttons' });
        buttons.add_child(new St.Label({ text: _('Ctrl+Enter saves · Esc cancels'), style_class: 'ca-menu-accel', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        let save = () => {
            let text = entry.get_text();
            this._closePopup();
            if (!text.trim() || text === item.content) return;
            this.manager.updateContent(item, text);
            this.refresh(true);
        };
        buttons.add_child(button('ca-dialog-button', _('Cancel'), () => this._closePopup()));
        buttons.add_child(button('ca-dialog-button ca-suggested', _('Save'), save));
        actor.add_child(buttons);
        let w = Math.min(760 * global.ui_scale, this.actor.width - 80);
        actor.set_width(w);
        let popup = { actor, focus: entry.clutter_text };
        popup.onKey = ev => {
            let sym = ev.get_key_symbol();
            let ctrl = (ev.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (sym === Clutter.KEY_Escape) { this._closePopup(); return Clutter.EVENT_STOP; }
            if (ctrl && (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter || sym === Clutter.KEY_s || sym === Clutter.KEY_S)) { save(); return Clutter.EVENT_STOP; }
            if (ctrl && sym === Clutter.KEY_Tab) { entry.clutter_text.insert_text('\t', entry.clutter_text.get_cursor_position()); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        };
        entry.clutter_text.connect('key-press-event', (a, ev) => popup.onKey(ev));
        this._showPopup(popup, (this.actor.width - w) / 2, this.actor.height * 0.18);
    }

    _openClearConfirm() {
        let actor = new St.BoxLayout({ vertical: true, style_class: 'ca-confirm', reactive: true });
        actor.add_child(new St.Label({ text: _('Clear history?'), style_class: 'ca-editor-title' }));
        actor.add_child(new St.Label({ text: _('Deleted items cannot be recovered.'), style_class: 'ca-confirm-text' }));
        let includeProtected = false;
        let check = new St.Button({ style_class: 'ca-check', reactive: true, can_focus: false });
        let checkBox = new St.BoxLayout({ style_class: 'ca-check-box' });
        let checkIcon = icon('checkbox-symbolic', 16);
        checkBox.add_child(checkIcon);
        checkBox.add_child(new St.Label({ text: _('Also delete pinned and tagged items'), y_align: Clutter.ActorAlign.CENTER }));
        check.set_child(checkBox);
        let sync = () => { checkIcon.icon_name = includeProtected ? 'checkbox-checked-symbolic' : 'checkbox-symbolic'; };
        check.connect('clicked', () => { includeProtected = !includeProtected; sync(); });
        sync();
        actor.add_child(check);
        let buttons = new St.BoxLayout({ style_class: 'ca-editor-buttons' });
        buttons.add_child(new St.Widget({ x_expand: true }));
        let doClear = () => { this._closePopup(); this.store.clear(includeProtected); this.focusIndex = 0; this.refresh(false); };
        buttons.add_child(button('ca-dialog-button', _('Cancel'), () => this._closePopup()));
        buttons.add_child(button('ca-dialog-button ca-destructive', _('Clear'), doClear));
        actor.add_child(buttons);
        let popup = { actor };
        popup.onKey = ev => {
            let sym = ev.get_key_symbol();
            if (sym === Clutter.KEY_Escape) { this._closePopup(); return Clutter.EVENT_STOP; }
            if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter) { doClear(); return Clutter.EVENT_STOP; }
            if (sym === Clutter.KEY_space) { includeProtected = !includeProtected; sync(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_STOP;
        };
        let [, natW] = actor.get_preferred_width(-1);
        this._showPopup(popup, (this.actor.width - natW) / 2, this.actor.height * 0.3);
    }

    // ---------- lifecycle ----------
    close() {
        if (this._closed) return;
        if (this._popup) this._closePopup();
        this._inlineEdit = null;
        if (!this.preview) Main.popModal(this.actor);
        this._hide();
    }

    _hide() {
        this._closed = true;
        this.actor.hide();
        for (let { card } of this._cache.values()) card.pause();
        if (this._flashTimer) { GLib.source_remove(this._flashTimer); this._flashTimer = 0; }
    }

    // Only when the extension is disabled.
    destroy() {
        if (!this._closed) this.close();
        let i = this.store._listeners.indexOf(this._storeListener);
        if (i >= 0) this.store._listeners.splice(i, 1);
        for (let { card } of this._cache.values()) card.actor.destroy();
        this._cache.clear();
        this.actor.destroy();
    }
};
