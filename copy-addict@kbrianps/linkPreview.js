// Link previews: fetch title, description and image (Open Graph / Twitter / <title>).
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;

const MAX_HTML_BYTES = 768 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_S = 12;
const LINK_DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'copy-addict', 'links']);

function log(msg) { global.log(`copy-addict: ${msg}`); }

function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
        let l = e.toLowerCase();
        if (l === 'amp') return '&';
        if (l === 'lt') return '<';
        if (l === 'gt') return '>';
        if (l === 'quot') return '"';
        if (l === 'apos') return '\'';
        if (l === 'nbsp') return ' ';
        let code = l.startsWith('#x') ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
        try { return String.fromCodePoint(code); } catch (err) { return m; }
    }).replace(/\s+/g, ' ').trim();
}

function metaContent(html, names) {
    for (let name of names) {
        let n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${n}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i');
        let re2 = new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${n}["']`, 'i');
        let m = html.match(re1) || html.match(re2);
        if (m && m[1].trim()) return decodeEntities(m[1]);
    }
    return null;
}

function resolveUrl(base, rel) {
    try { return GLib.Uri.resolve_relative(base, rel, GLib.UriFlags.NONE); } catch (e) { return rel; }
}

function md5(s) { return GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, s, -1); }

var LinkPreview = class LinkPreview {
    constructor(store) {
        this.store = store;
        this._pending = new Set();
        GLib.mkdir_with_parents(LINK_DIR, 0o700);
        this._session = new Soup.Session({ timeout: TIMEOUT_S, user_agent: 'Mozilla/5.0 (X11; Linux x86_64) copy-addict/2.0 (link preview)' });
        this._cancellable = new Gio.Cancellable();
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
    }

    imagePathFor(item) {
        let l = item.meta && item.meta.link;
        return l && l.imageFile ? GLib.build_filenamev([LINK_DIR, l.imageFile]) : null;
    }

    // Fetch once per item; results are stored in item.meta.link.
    ensure(item) {
        if (item.type !== 'link' || (item.meta && item.meta.link) || this._pending.has(item.id)) return;
        let url = item.content.trim();
        this._pending.add(item.id);
        let finish = link => { try { this._done(item, link); } catch (e) { this._pending.delete(item.id); log(`link preview: ${e}`); } };
        this._get(url, MAX_HTML_BYTES, (bytes, contentType) => { try {
            let link = { title: null, description: null, image: null, imageFile: null };
            if (bytes && contentType && contentType.startsWith('image/')) {
                // The URL itself is an image: it is its own preview.
                this._storeImage(url, bytes, link);
                return finish(link);
            }
            if (bytes) {
                let html = new TextDecoder('utf-8', { fatal: false }).decode(bytes.toArray());
                let head = html.slice(0, 300000);
                link.title = metaContent(head, ['og:title', 'twitter:title', 'title']);
                if (!link.title) {
                    let m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                    if (m) link.title = decodeEntities(m[1]);
                }
                link.description = metaContent(head, ['og:description', 'twitter:description', 'description']);
                let img = metaContent(head, ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'image']);
                if (img) link.image = resolveUrl(url, img);
            }
            if (!link.image) return finish(link);
            this._get(link.image, MAX_IMAGE_BYTES, (imgBytes, imgType) => {
                if (imgBytes && imgType && imgType.startsWith('image/')) this._storeImage(link.image, imgBytes, link);
                finish(link);
            });
        } catch (e) { log(`link preview parse: ${e}`); finish({ title: null, description: null, image: null, imageFile: null }); } });
    }

    _storeImage(url, bytes, link) {
        try {
            let name = md5(url);
            let path = GLib.build_filenamev([LINK_DIR, name]);
            Gio.File.new_for_path(path).replace_contents(bytes.toArray(), null, false, Gio.FileCreateFlags.NONE, null);
            link.imageFile = name;
        } catch (e) { log(`link image save failed: ${e}`); }
    }

    _done(item, link) {
        this._pending.delete(item.id);
        if (!this.store.items.includes(item)) return;
        this.store.update(item, { meta: Object.assign({}, item.meta, { link }) });
    }

    _get(url, maxBytes, cb) {
        let msg;
        try { msg = Soup.Message.new('GET', url); } catch (e) { return cb(null, null); }
        if (!msg) return cb(null, null);
        msg.request_headers.append('Accept', 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5');
        this._session.send_async(msg, GLib.PRIORITY_LOW, this._cancellable, (session, res) => {
            let stream, ctype;
            try {
                stream = session.send_finish(res);
                // status_code is a plain int; get_status() throws on codes Soup has no enum for (e.g. 429).
                let code = msg.status_code;
                if (code < 200 || code >= 300) { stream.close(null); return cb(null, null); }
                ctype = (msg.response_headers.get_content_type()[0] || '').toLowerCase();
            } catch (e) {
                try { if (stream) stream.close(null); } catch (e2) { }
                return cb(null, null);
            }
            let out = Gio.MemoryOutputStream.new_resizable();
            this._readChunks(stream, out, maxBytes, () => {
                let bytes = null;
                try { out.close(null); bytes = out.steal_as_bytes(); } catch (e) { }
                cb(bytes, ctype);
            });
        });
    }

    _readChunks(stream, out, maxBytes, done) {
        stream.read_bytes_async(65536, GLib.PRIORITY_LOW, this._cancellable, (s, res) => {
            let chunk;
            try { chunk = s.read_bytes_finish(res); } catch (e) { try { s.close(null); } catch (e2) { } return done(); }
            if (!chunk || chunk.get_size() === 0 || out.get_data_size() + chunk.get_size() > maxBytes) {
                if (chunk && chunk.get_size()) {
                    let room = maxBytes - out.get_data_size();
                    if (room > 0) out.write_bytes(chunk.toArray ? new GLib.Bytes(chunk.toArray().slice(0, room)) : chunk, null);
                }
                try { s.close(null); } catch (e) { }
                return done();
            }
            out.write_bytes(chunk, null);
            this._readChunks(s, out, maxBytes, done);
        });
    }
};
