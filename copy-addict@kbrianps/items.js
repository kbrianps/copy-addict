// Item cards: one per clipboard entry, rendered by type.
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const Pango = imports.gi.Pango;
const GdkPixbuf = imports.gi.GdkPixbuf;
const { _, ngettext } = require('./i18n');

var TYPE_INFO = {
    text: { get name() { return _('Text'); }, icon: 'format-justify-left-symbolic' },
    code: { get name() { return _('Code'); }, icon: 'utilities-terminal-symbolic' },
    link: { get name() { return _('Link'); }, icon: 'insert-link-symbolic' },
    image: { get name() { return _('Image'); }, icon: 'image-x-generic-symbolic' },
    file: { get name() { return _('File'); }, icon: 'text-x-generic-symbolic' },
    files: { get name() { return _('Files'); }, icon: 'folder-documents-symbolic' },
    color: { get name() { return _('Color'); }, icon: 'applications-graphics-symbolic' },
    character: { get name() { return _('Character'); }, icon: 'accessories-character-map-symbolic' },
};
var TYPE_ORDER = ['text', 'code', 'image', 'file', 'files', 'link', 'character', 'color'];

const TEXT_PREVIEW_CHARS = 1500;
const FILE_TEXT_PREVIEW_BYTES = 4096;
const HOME = GLib.get_home_dir();

function log(msg) { global.log(`copy-addict: ${msg}`); }


function relativeTime(ms) {
    let s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return _('just now');
    let m = Math.floor(s / 60);
    if (m < 60) return ngettext('%d minute ago', '%d minutes ago', m).format(m);
    let h = Math.floor(m / 60);
    if (h < 24) return ngettext('%d hour ago', '%d hours ago', h).format(h);
    let d = Math.floor(h / 24);
    if (d === 1) return _('yesterday');
    if (d < 7) return ngettext('%d day ago', '%d days ago', d).format(d);
    let w = Math.floor(d / 7);
    if (d < 30) return ngettext('%d week ago', '%d weeks ago', w).format(w);
    let mo = Math.floor(d / 30);
    if (d < 365) return ngettext('%d month ago', '%d months ago', mo).format(mo);
    let y = Math.floor(d / 365);
    return ngettext('%d year ago', '%d years ago', y).format(y);
}

function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    let units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes, i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < units.length - 1);
    return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

function prettyPath(path) {
    return path && path.startsWith(HOME + '/') ? '~' + path.slice(HOME.length) : (path === HOME ? '~' : path);
}

function uriToPath(uri) {
    try { return GLib.filename_from_uri(uri)[0]; } catch (e) { return null; }
}

// Copyous-style text cleanup: trim blank edges, tabs to spaces, strip shared indentation.
function normalizeText(text) {
    let lines = text.replace(/\t/g, '    ').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    let indents = lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length);
    let cut = indents.length ? Math.min(...indents) : 0;
    return lines.map(l => l.slice(cut)).join('\n');
}

function parseCssColor(text) {
    try {
        let [ok, c] = Clutter.Color.from_string(text.trim());
        if (ok) return c;
    } catch (e) { }
    return null;
}

function cssUrl(path) {
    return 'file://' + path.split('/').map(encodeURIComponent).join('/');
}

// ---------- Animated images ----------
var ImageView = class ImageView {
    // fit: 'cover' or 'contain'
    constructor(path, fit, animatedHint) {
        this.path = path;
        this._timer = 0;
        this.actor = new St.Widget({ style_class: 'ca-image', x_expand: true, y_expand: true, clip_to_allocation: true });
        let animated = false;
        if (animatedHint !== false && /\.(gif|webp)$/i.test(path)) {
            try {
                this._anim = GdkPixbuf.PixbufAnimation.new_from_file(path);
                animated = !this._anim.is_static_image();
            } catch (e) { this._anim = null; }
        }
        if (animated) {
            this._image = new Clutter.Image();
            this._canvas = new Clutter.Actor({ x_expand: true, y_expand: true, content: this._image,
                content_gravity: Clutter.ContentGravity.RESIZE_ASPECT });
            this.actor.layout_manager = new Clutter.BinLayout();
            this.actor.add_child(this._canvas);
            this._iter = this._anim.get_iter(null);
            this._showFrame();
            this.actor.connect('destroy', () => this.stop());
        } else {
            this.actor.style = `background-image: url("${cssUrl(path)}"); background-size: ${fit === 'contain' ? 'contain' : 'cover'};`;
        }
    }

    // Resume the animation (after the bar is shown again).
    start() {
        if (this._iter && !this._timer) this._showFrame();
    }

    _showFrame() {
        let pb = this._iter.get_pixbuf();
        try {
            this._image.set_data(pb.get_pixels(), pb.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
                pb.get_width(), pb.get_height(), pb.get_rowstride());
        } catch (e) { log(`gif frame: ${e}`); return; }
        let delay = this._iter.get_delay_time();
        if (delay < 0) return;   // last frame of a non-looping animation
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(20, delay), () => {
            this._timer = 0;
            this._iter.advance(null);
            this._showFrame();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        if (this._timer) { GLib.source_remove(this._timer); this._timer = 0; }
    }
};

function label(text, cls, opts) {
    let l = new St.Label(Object.assign({ text: text || '', style_class: cls }, opts || {}));
    return l;
}

function wrapLabel(l, lines) {
    l.clutter_text.line_wrap = true;
    l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// ---------- Card ----------
var ItemCard = class ItemCard {
    constructor(dialog, item) {
        this.dialog = dialog;
        this.item = item;
        this.store = dialog.manager.store;
        this._views = [];
        let s = this.store.settings;

        this.actor = new St.BoxLayout({ vertical: true, style_class: 'ca-card', reactive: true, track_hover: true,
            can_focus: false, clip_to_allocation: true });
        this.actor.set_size(s.itemWidth * global.ui_scale, s.itemHeight * global.ui_scale);
        this.actor._delegate = this;

        this._buildHeader();
        this.body = new St.BoxLayout({ vertical: true, style_class: 'ca-card-body', x_expand: true, y_expand: true, clip_to_allocation: true });
        this.actor.add_child(this.body);
        try { this._buildBody(); } catch (e) {
            log(`render ${item.type}: ${e}\n${e.stack}`);
            this.body.add_child(label(_('Could not show this item'), 'ca-muted'));
        }
        this._applyTag();

        this._pressed = 0;
        this.actor.connect('button-press-event', (a, ev) => { this._pressed = ev.get_button(); return Clutter.EVENT_STOP; });
        this.actor.connect('button-release-event', (a, ev) => this._onRelease(ev));
        this.actor.connect('destroy', () => this._views.forEach(v => v.stop && v.stop()));
    }

    get title() {
        if (this.item.title) return this.item.title;
        let info = TYPE_INFO[this.item.type] || TYPE_INFO.text;
        if (this.item.type === 'code' && this.item.meta && this.item.meta.language) return `${info.name} · ${this.item.meta.language.name}`;
        return info.name;
    }

    _buildHeader() {
        let item = this.item;
        this.header = new St.BoxLayout({ style_class: 'ca-card-header' });
        let info = TYPE_INFO[item.type] || TYPE_INFO.text;
        this.typeIcon = new St.Icon({ icon_name: info.icon, icon_type: St.IconType.SYMBOLIC, icon_size: 14, style_class: 'ca-type-icon',
            y_align: Clutter.ActorAlign.CENTER });
        this.header.add_child(this.typeIcon);

        this.titleBox = new St.BoxLayout({ x_expand: true, style_class: 'ca-title-box' });
        this.titleLabel = label(this.title, 'ca-card-title', { y_align: Clutter.ActorAlign.CENTER, reactive: true });
        this.titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.titleLabel.connect('button-press-event', (a, ev) => {
            if (ev.get_button() === 1 && ev.get_click_count() === 2) { this.editTitle(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
        this.titleBox.add_child(this.titleLabel);
        if (!item.title) {
            this.timeLabel = label(relativeTime(item.time), 'ca-card-time', { y_align: Clutter.ActorAlign.CENTER });
            this.titleBox.add_child(this.timeLabel);
        }
        this.header.add_child(this.titleBox);

        let controls = new St.BoxLayout({ style_class: 'ca-card-controls' });
        this.menuBtn = this._miniButton('view-more-symbolic', () => this.dialog.openItemMenu(this));
        controls.add_child(this.menuBtn);
        this.deleteBtn = this._miniButton('user-trash-symbolic', () => this.dialog.deleteItem(this.item, false));
        if (this.store.isProtected(item)) this.deleteBtn.hide();
        controls.add_child(this.deleteBtn);
        this.pinBtn = this._miniButton('view-pin-symbolic', () => this.dialog.togglePin(this.item));
        if (item.pinned) this.pinBtn.add_style_pseudo_class('checked');
        controls.add_child(this.pinBtn);
        this.header.add_child(controls);
        this.actor.add_child(this.header);
    }

    _miniButton(icon, fn) {
        let b = new St.Button({ style_class: 'ca-mini-button', reactive: true, can_focus: false });
        b.set_child(new St.Icon({ icon_name: icon, icon_type: St.IconType.SYMBOLIC, icon_size: 14 }));
        b.connect('clicked', () => fn());
        return b;
    }

    _applyTag() {
        let tag = this.item.tag && this.dialog.tagById(this.item.tag);
        if (tag) {
            this.header.style = `color: ${tag.color};`;
            this.typeIcon.style = `color: ${tag.color};`;
            this.titleLabel.style = `color: ${tag.color};`;
            if (this.item.pinned) this.pinBtn.style = `background-color: ${tag.color}; color: #ffffff;`;
            this.actor.add_style_class_name('ca-tagged');
            this.actor.style = `border-top: 3px solid ${tag.color};`;
        }
    }

    _buildBody() {
        let item = this.item;
        switch (item.type) {
            case 'image': return this._image();
            case 'code': return this._code(item.content, item.meta && item.meta.language && item.meta.language.id);
            case 'link': return this._link();
            case 'file': return this._file();
            case 'files': return this._files();
            case 'color': return this._color();
            case 'character': return this._character();
            default: return this._text();
        }
    }

    _text() {
        let text = this._cached('text', () => normalizeText(this.item.content.slice(0, TEXT_PREVIEW_CHARS)));
        let l = wrapLabel(label(text, 'ca-text', { y_expand: true }));
        this.body.add_child(l);
    }

    _code(code, langId) {
        let hl = this.dialog.manager.highlight;
        let markup = this._cached('code:' + (langId || ''), () => hl.highlight(normalizeText(code.slice(0, TEXT_PREVIEW_CHARS)), langId, true));
        let l = label('', 'ca-code', { y_expand: true });
        l.clutter_text.set_markup(markup);
        let multi = code.trim().includes('\n');
        l.clutter_text.line_wrap = !multi;
        if (!multi) l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.body.add_child(l);
    }

    _image() {
        let path = this.store.imagePath(this.item);
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return this._missing(_('Missing image'), 'image-missing-symbolic');
        let v = new ImageView(path, this.store.settings.imageBackgroundSize, this.item.meta && this.item.meta.animated);
        this._views.push(v);
        this.body.add_child(v.actor);
        let m = this.item.meta || {};
        if (m.width && m.height) {
            let tag = m.animated ? ' · GIF' : '';
            this.body.add_child(label(`${m.width}×${m.height} · ${humanSize(m.bytes || 0)}${tag}`, 'ca-info'));
        }
    }

    _link() {
        let url = this.item.content.trim();
        let link = this.item.meta && this.item.meta.link;
        let imgPath = this.dialog.manager.linkPreview ? this.dialog.manager.linkPreview.imagePathFor(this.item) : null;
        if (link && imgPath && GLib.file_test(imgPath, GLib.FileTest.EXISTS)) {
            let v = new ImageView(imgPath, 'contain', null);
            this._views.push(v);
            v.actor.add_style_class_name('ca-link-image');
            this.body.add_child(v.actor);
        }
        if (link) {
            let t = wrapLabel(label(link.title || _('No title'), 'ca-link-title'));
            this.body.add_child(t);
            if (link.description) this.body.add_child(wrapLabel(label(link.description, 'ca-link-desc')));
        } else {
            if (this.dialog.manager.linkPreview) this.dialog.manager.linkPreview.ensure(this.item);
            this.body.add_child(label(_('Loading preview…'), 'ca-muted'));
        }
        let u = label(url.replace(/^https?:\/\//, ''), 'ca-link-url');
        u.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this.body.add_child(new St.Widget({ y_expand: true }));
        this.body.add_child(u);
    }

    _file() {
        let uri = this.item.content.trim();
        let file = Gio.File.new_for_uri(uri);
        let path = file.get_path();
        let info = null;
        try {
            info = file.query_info('standard::content-type,standard::size,standard::type,standard::icon,thumbnail::path', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) { }
        if (!info) {
            this.body.add_child(label(prettyPath(path || uri), 'ca-file-path'));
            return this._missing(_('Missing file'), 'dialog-question-symbolic');
        }
        let ctype = info.get_content_type() || '';
        let isDir = info.get_file_type() === Gio.FileType.DIRECTORY;
        let preview = false;
        if (!isDir && ctype.startsWith('image/') && path) {
            let v = new ImageView(path, this.store.settings.imageBackgroundSize, null);
            this._views.push(v);
            this.body.add_child(v.actor);
            preview = true;
        } else if (!isDir && path && (Gio.content_type_is_a(ctype, 'text/plain') || ctype.startsWith('text/')) && info.get_size() > 0) {
            try {
                let stream = file.read(null);
                let bytes = stream.read_bytes(FILE_TEXT_PREVIEW_BYTES, null);
                stream.close(null);
                let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.toArray());
                let ext = (path.split('.').pop() || '').toLowerCase();
                let hl = this.dialog.manager.highlight;
                let lang = hl.languageFor ? hl.languageFor(ext) : null;
                this._code(text, lang);
                preview = true;
            } catch (e) { }
        }
        if (!preview) {
            let thumb = info.get_attribute_byte_string('thumbnail::path') || this._findThumbnail(uri);
            if (thumb && GLib.file_test(thumb, GLib.FileTest.EXISTS)) {
                let v = new ImageView(thumb, 'contain', false);
                this._views.push(v);
                this.body.add_child(v.actor);
            } else {
                let icon = new St.Icon({ gicon: info.get_icon(), icon_size: 56, style_class: 'ca-file-icon', x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER, y_expand: true });
                this.body.add_child(icon);
            }
        }
        let name = label(file.get_basename(), 'ca-file-name');
        name.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this.body.add_child(name);
        let detail = isDir ? _('Folder') : humanSize(info.get_size());
        let dir = label(`${prettyPath(file.get_parent() ? file.get_parent().get_path() : '')} · ${detail}`, 'ca-info');
        dir.clutter_text.ellipsize = Pango.EllipsizeMode.START;
        this.body.add_child(dir);
    }

    _findThumbnail(uri) {
        let h = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, uri, -1);
        for (let size of ['x-large', 'large', 'normal']) {
            let p = GLib.build_filenamev([GLib.get_user_cache_dir(), 'thumbnails', size, `${h}.png`]);
            if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
        }
        return null;
    }

    _files() {
        let paths = this.item.content.split('\n').map(u => uriToPath(u) || u);
        let parts = paths.map(p => p.split('/'));
        let common = [];
        for (let i = 0; parts.length && i < parts[0].length - 1; i++) {
            let seg = parts[0][i];
            if (parts.every(p => p[i] === seg && p.length > i + 1)) common.push(seg); else break;
        }
        let base = common.join('/') || '/';
        let dir = label(prettyPath(base), 'ca-file-path');
        dir.clutter_text.ellipsize = Pango.EllipsizeMode.START;
        this.body.add_child(dir);
        let max = 5;
        let list = new St.BoxLayout({ vertical: true, style_class: 'ca-file-list', y_expand: true });
        paths.slice(0, max).forEach(p => {
            let row = new St.BoxLayout({ style_class: 'ca-file-row' });
            let isDir = GLib.file_test(p, GLib.FileTest.IS_DIR);
            row.add_child(new St.Icon({ icon_name: isDir ? 'folder-symbolic' : 'text-x-generic-symbolic', icon_type: St.IconType.SYMBOLIC, icon_size: 14 }));
            let n = label(p.slice(base.length).replace(/^\//, ''), 'ca-file-row-name');
            n.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            row.add_child(n);
            list.add_child(row);
        });
        this.body.add_child(list);
        if (paths.length > max) this.body.add_child(label(ngettext('+%d file', '+%d files', paths.length - max).format(paths.length - max), 'ca-info'));
    }

    _color() {
        let text = this.item.content.trim();
        let c = parseCssColor(text);
        let swatch = new St.BoxLayout({ vertical: true, style_class: 'ca-swatch', x_expand: true, y_expand: true });
        let fg = 'rgba(255,255,255,0.85)';
        if (c) {
            let a = c.alpha / 255;
            swatch.style = `background-color: rgba(${c.red},${c.green},${c.blue},${a.toFixed(3)});`;
            let lum = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;
            if (lum >= 0.5 && a > 0.4) fg = 'rgba(0,0,0,0.8)';
        } else {
            swatch.add_style_class_name('ca-swatch-unknown');
        }
        let l = label(text, 'ca-swatch-text', { x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, y_expand: true });
        l.style = `color: ${fg};`;
        swatch.add_child(l);
        this.body.add_child(swatch);
    }

    _character() {
        let ch = this.item.content.trim();
        this.body.add_child(label(ch, 'ca-char', { x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, y_expand: true }));
        let codes = [...ch].map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
        this.body.add_child(label(codes, 'ca-info', { x_align: Clutter.ActorAlign.CENTER }));
    }

    _missing(text, icon) {
        let box = new St.BoxLayout({ vertical: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER, style_class: 'ca-missing' });
        box.add_child(new St.Icon({ icon_name: icon, icon_type: St.IconType.SYMBOLIC, icon_size: 32 }));
        box.add_child(label(text, 'ca-muted'));
        this.body.add_child(box);
    }

    _cached(key, fn) {
        let c = this.item._cache || (this.item._cache = {});
        if (!(key in c)) c[key] = fn();
        return c[key];
    }

    // ---------- interaction ----------
    _onRelease(ev) {
        let button = ev.get_button();
        if (button !== this._pressed) return Clutter.EVENT_STOP;
        this._pressed = 0;
        let state = ev.get_state();
        let shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        if (button === 1) {
            this.dialog.choose(this.item, shift, ctrl);
        } else if (button === 2) {
            this.dialog.togglePin(this.item);
        } else if (button === 3) {
            let [x, y] = ev.get_coords();
            this.dialog.openItemMenu(this, x, y);
        }
        return Clutter.EVENT_STOP;
    }

    updateTime() {
        if (this.timeLabel) this.timeLabel.text = relativeTime(this.item.time);
    }

    pause() { this._views.forEach(v => v.stop && v.stop()); }

    resume() { this._views.forEach(v => v.start && v.start()); }

    setFocused(on) {
        if (on) this.actor.add_style_pseudo_class('selected');
        else this.actor.remove_style_pseudo_class('selected');
    }

    editTitle() {
        if (this._titleEntry) return;
        let entry = new St.Entry({ style_class: 'ca-title-entry', text: this.item.title || this.title, can_focus: true, x_expand: true });
        this._titleEntry = entry;
        this.titleBox.hide();
        this.header.insert_child_at_index(entry, 1);
        let done = save => {
            if (!this._titleEntry) return;
            let t = entry.get_text().trim();
            this._titleEntry = null;
            this.dialog.endInlineEdit();
            if (save) {
                let def = (TYPE_INFO[this.item.type] || TYPE_INFO.text).name;
                this.dialog.setTitle(this.item, t && t !== def ? t : null);
            } else {
                entry.destroy();
                this.titleBox.show();
            }
        };
        entry.clutter_text.connect('activate', () => done(true));
        entry.clutter_text.connect('key-press-event', (a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape) { done(false); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });
        this.dialog.beginInlineEdit(entry, () => done(true));
        entry.clutter_text.set_selection(0, -1);
    }
};

var Helpers = { relativeTime, humanSize, prettyPath, uriToPath, normalizeText, parseCssColor };
