// Code detection and syntax highlighting with highlight.js (same file Copyous uses).
const GLib = imports.gi.GLib;

const CANDIDATES = [
    GLib.build_filenamev([GLib.get_user_data_dir(), 'copy-addict', 'highlight.min.js']),
    GLib.build_filenamev([GLib.get_user_data_dir(), 'copyous@boerdereinar.dev', 'highlight.min.js']),
];

const MAX_DETECT_CHARS = 10000;
const MAX_HIGHLIGHT_CHARS = 4000;

// Dark theme, close to Copyous's (GNOME palette).
const THEME = {
    'keyword': { fg: '#f66151', bold: true },
    'built_in': { fg: '#ffbe6f' },
    'type': { fg: '#ffbe6f' },
    'literal': { fg: '#dc8add' },
    'number': { fg: '#dc8add' },
    'regexp': { fg: '#f8e45c' },
    'string': { fg: '#8ff0a4' },
    'subst': { fg: '#f6f5f4' },
    'symbol': { fg: '#f8e45c' },
    'class': { fg: '#62a0ea' },
    'function': { fg: '#62a0ea' },
    'title': { fg: '#62a0ea', bold: true },
    'title.function': { fg: '#62a0ea' },
    'title.class': { fg: '#ffbe6f', bold: true },
    'params': { fg: '#f6f5f4' },
    'comment': { fg: '#9a9996', italic: true },
    'doctag': { fg: '#99c1f1' },
    'meta': { fg: '#99c1f1' },
    'meta keyword': { fg: '#99c1f1', bold: true },
    'meta string': { fg: '#8ff0a4' },
    'section': { fg: '#62a0ea', bold: true },
    'tag': { fg: '#f66151' },
    'name': { fg: '#f66151' },
    'attr': { fg: '#ffbe6f' },
    'attribute': { fg: '#ffbe6f' },
    'variable': { fg: '#99c1f1' },
    'template-variable': { fg: '#dc8add' },
    'template-tag': { fg: '#dc8add' },
    'property': { fg: '#99c1f1' },
    'operator': { fg: '#f6f5f4' },
    'punctuation': { fg: '#c0bfbc' },
    'bullet': { fg: '#ffa348', bold: true },
    'code': { fg: '#dc8add' },
    'emphasis': { italic: true },
    'strong': { bold: true },
    'link': { underline: true },
    'quote': { fg: '#9a9996' },
    'selector-tag': { fg: '#5bc8af' },
    'selector-id': { fg: '#5bc8af', bold: true },
    'selector-class': { fg: '#8ff0a4' },
    'selector-attr': { fg: '#5bc8af' },
    'selector-pseudo': { fg: '#dc8add', bold: true },
    'addition': { fg: '#5bc8af' },
    'deletion': { fg: '#f66151' },
};

var hljs = null;
let _loading = false;
let _waiters = [];

function log(msg) { global.log(`copy-addict: ${msg}`); }

function load(cb) {
    if (hljs) { if (cb) cb(hljs); return; }
    if (cb) _waiters.push(cb);
    if (_loading) return;
    let path = CANDIDATES.find(p => GLib.file_test(p, GLib.FileTest.EXISTS));
    if (!path) { log('highlight.js not found, code detection off'); return; }
    _loading = true;
    import(GLib.filename_to_uri(path, null)).then(m => {
        hljs = m.default || m;
        _loading = false;
        log(`highlight.js loaded (${hljs.listLanguages().length} languages)`);
        let w = _waiters; _waiters = [];
        w.forEach(fn => { try { fn(hljs); } catch (e) { log(`hljs waiter: ${e}`); } });
    }).catch(e => { _loading = false; log(`highlight.js failed: ${e}`); });
}

// Strong hints that settle close calls (hljs alone scores Python below SCSS, for example).
const SIGNATURES = {
    python: [/^\s*(?:async\s+)?def\s+\w+\s*\(.*\)\s*(?:->.*)?:\s*$/m, /^\s*(?:from\s+[\w.]+\s+)?import\s+[\w., ]+$/m, /\bprint\(/, /\bself\./, /^\s*elif\b/m, /:\s*$\n\s{4}\S/m],
    javascript: [/\b(?:const|let|var)\s+\w+\s*=/, /=>\s*[{(\w]/, /\bfunction\s*\w*\s*\(/, /\bconsole\.\w+\(/, /\b(?:require|import)\s*\(?['"]/],
    typescript: [/:\s*(?:string|number|boolean|any|void)\b/, /\binterface\s+\w+\s*\{/, /\btype\s+\w+\s*=/],
    bash: [/^#!.*\b(?:ba|z)?sh\b/m, /^\s*(?:sudo|apt|cd|ls|echo|export|grep|curl|git|npm|docker)\s/m, /\$\{?\w+\}?/, /\|\s*(?:grep|awk|sed|xargs|head|tail)\b/],
    sql: [/\bselect\b[\s\S]+\bfrom\b/i, /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table)\b/i],
    json: [/^\s*[\[{][\s\S]*[\]}]\s*$/, /"[\w-]+"\s*:/],
    xml: [/^\s*<(?:!DOCTYPE|\?xml|html|div|span|svg|[a-z]+[\s>])/im, /<\/[a-z][\w-]*>/i],
    css: [/^[\s\S]*[.#]?[\w-]+\s*\{[\s\S]*:\s*[^;]+;[\s\S]*\}/],
    java: [/\b(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+\w+\s*\(/, /\bSystem\.out\.print/],
    cpp: [/^\s*#include\s*[<"]/m, /\bstd::/, /\bint\s+main\s*\(/],
    c: [/^\s*#include\s*<\w+\.h>/m, /\bprintf\s*\(/],
    go: [/^\s*package\s+\w+/m, /\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\(/, /:=/],
    rust: [/\bfn\s+\w+\s*\(/, /\blet\s+mut\b/, /\bimpl\b/, /println!/],
    php: [/<\?php/, /\$\w+\s*=/],
    ruby: [/^\s*def\s+\w+[^:]*$/m, /^\s*end\s*$/m, /\bputs\b/],
    yaml: [/^\s*[\w-]+:\s*(?:\S.*)?$/m, /^\s*-\s+\w+/m],
    markdown: [/^#{1,6}\s+\S/m, /^\s*[-*]\s+\S/m, /\[[^\]]+\]\([^)]+\)/],
    diff: [/^(?:\+\+\+|---|@@)\s/m],
};

function signatureBonus(lang, text) {
    let sigs = SIGNATURES[lang];
    if (!sigs) return 0;
    let hits = sigs.filter(re => re.test(text)).length;
    return hits * 3;
}

// Same threshold as Copyous (relevance per 100 chars >= 3), with signature tie-breaking.
function detectCode(text) {
    if (!hljs) return null;
    let t = text.trim();
    if (t.length < 8) return null;
    try {
        let sample = t.slice(0, MAX_DETECT_CHARS);
        let r = hljs.highlightAuto(sample);
        if (!r.language) return null;
        if (r.relevance / Math.max(1, t.length / 100) < 3) return null;
        let candidates = new Set([r.language]);
        if (r.secondBest && r.secondBest.language) candidates.add(r.secondBest.language);
        for (let lang of Object.keys(SIGNATURES))
            if (hljs.getLanguage(lang) && signatureBonus(lang, sample) >= 6) candidates.add(lang);
        let best = r.language, bestScore = -1;
        for (let lang of candidates) {
            let rel = lang === r.language ? r.relevance
                : (r.secondBest && lang === r.secondBest.language ? r.secondBest.relevance
                    : hljs.highlight(sample, { language: lang, ignoreIllegals: true }).relevance);
            let score = rel + signatureBonus(lang, sample);
            if (score > bestScore) { bestScore = score; best = lang; }
        }
        let lang = hljs.getLanguage(best);
        return { id: best, name: lang && lang.name ? lang.name : best };
    } catch (e) {
        return null;
    }
}

function escapeMarkup(s) {
    return GLib.markup_escape_text(s, -1);
}

function styleAttrs(classes) {
    let key = classes.replace(/hljs-/g, '').replace(/\s+/g, ' ').trim();
    let style = THEME[key] || THEME[key.split(' ')[0]] || THEME[key.replace(' ', '.')];
    if (!style) return '';
    let a = [];
    if (style.fg) a.push(`foreground="${style.fg}"`);
    if (style.bold) a.push('weight="bold"');
    if (style.italic) a.push('style="italic"');
    if (style.underline) a.push('underline="single"');
    return a.join(' ');
}

// hljs HTML -> Pango markup.
function toPango(html) {
    return html
        .replace(/<span class="([^"]*)">/g, (_, cls) => {
            let attrs = styleAttrs(cls);
            return attrs ? `<span ${attrs}>` : '<span>';
        })
        .replace(/&#x27;/g, '&apos;');
}

// Returns Pango markup for code, with optional line numbers (0-based like Copyous).
function highlight(code, languageId, lineNumbers) {
    let src = code.length > MAX_HIGHLIGHT_CHARS ? code.slice(0, MAX_HIGHLIGHT_CHARS) : code;
    let markup;
    try {
        if (hljs && languageId && hljs.getLanguage(languageId))
            markup = toPango(hljs.highlight(src, { language: languageId, ignoreIllegals: true }).value);
    } catch (e) { markup = null; }
    if (!markup) markup = escapeMarkup(src);
    if (!lineNumbers) return markup;

    // Spans can cross lines: close and reopen them at each line break.
    let lines = [];
    let open = [];
    let current = '';
    let re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
    let m;
    while ((m = re.exec(markup)) !== null) {
        if (m[1]) { open.push(m[1]); current += m[1]; }
        else if (m[2]) { open.pop(); current += m[2]; }
        else if (m[3]) {
            current += '</span>'.repeat(open.length);
            lines.push(current);
            current = open.join('');
        } else current += m[4];
    }
    lines.push(current + '</span>'.repeat(open.length));
    if (lines.length < 2) return lines[0];
    let width = Math.max(2, String(lines.length - 1).length);
    return lines.map((l, i) => `<span foreground="#ffffff" fgalpha="50%">${String(i).padStart(width, ' ')}</span>  ${l}`).join('\n');
}

// Language id for a file extension, if highlight.js knows it.
function languageFor(ext) {
    if (!hljs || !ext) return null;
    let lang = hljs.getLanguage(ext);
    return lang ? ext : null;
}

function isLoaded() { return !!hljs; }
