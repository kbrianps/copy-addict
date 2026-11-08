// Code detection and highlighting on top of highlight.js (same file Copyous uses).
// Evaluated as an expression: a function that takes hljs (or null) and returns the helpers.
(function (hljs) {
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
        const sigs = SIGNATURES[lang];
        if (!sigs) return 0;
        return sigs.filter(re => re.test(text)).length * 3;
    }

    // Same threshold as Copyous (relevance per 100 chars >= 3), with signature tie-breaking.
    function detect(text) {
        if (!hljs) return null;
        const t = text.trim();
        if (t.length < 8) return null;
        try {
            const sample = t.slice(0, MAX_DETECT_CHARS);
            const r = hljs.highlightAuto(sample);
            if (!r.language) return null;
            if (r.relevance / Math.max(1, t.length / 100) < 3) return null;
            const candidates = new Set([r.language]);
            if (r.secondBest && r.secondBest.language) candidates.add(r.secondBest.language);
            for (const lang of Object.keys(SIGNATURES))
                if (hljs.getLanguage(lang) && signatureBonus(lang, sample) >= 6) candidates.add(lang);
            let best = r.language, bestScore = -1;
            for (const lang of candidates) {
                const rel = lang === r.language ? r.relevance
                    : (r.secondBest && lang === r.secondBest.language ? r.secondBest.relevance
                        : hljs.highlight(sample, { language: lang, ignoreIllegals: true }).relevance);
                const score = rel + signatureBonus(lang, sample);
                if (score > bestScore) { bestScore = score; best = lang; }
            }
            const l = hljs.getLanguage(best);
            return { id: best, name: l && l.name ? l.name : best };
        } catch (e) {
            return null;
        }
    }

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function styleFor(classes) {
        const key = classes.replace(/hljs-/g, '').replace(/\s+/g, ' ').trim();
        const st = THEME[key] || THEME[key.split(' ')[0]] || THEME[key.replace(' ', '.')];
        if (!st) return '';
        const a = [];
        if (st.fg) a.push(`color:${st.fg}`);
        if (st.bold) a.push('font-weight:bold');
        if (st.italic) a.push('font-style:italic');
        if (st.underline) a.push('text-decoration:underline');
        return a.join(';');
    }

    // hljs HTML -> Qt rich text (inline styles instead of classes).
    function toQt(html) {
        return html.replace(/<span class="([^"]*)">/g, (m, cls) => {
            const s = styleFor(cls);
            return s ? `<span style="${s}">` : '<span>';
        });
    }

    // Highlighted code with optional line numbers (0-based like Copyous).
    function highlight(code, languageId, lineNumbers) {
        const src = code.length > MAX_HIGHLIGHT_CHARS ? code.slice(0, MAX_HIGHLIGHT_CHARS) : code;
        let markup = null;
        try {
            if (hljs && languageId && hljs.getLanguage(languageId))
                markup = toQt(hljs.highlight(src, { language: languageId, ignoreIllegals: true }).value);
        } catch (e) { markup = null; }
        if (markup === null) markup = escapeHtml(src);
        const multi = src.includes('\n');
        if (!lineNumbers || !multi)
            return `<pre style="margin:0;white-space:${multi ? 'pre' : 'pre-wrap'}">${markup}</pre>`;

        // Spans can cross lines: close and reopen them at each line break.
        const lines = [];
        const open = [];
        let current = '';
        const re = /(<span[^>]*>)|(<\/span>)|(\n)|([^<\n]+|<)/g;
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
        const width = Math.max(2, String(lines.length - 1).length);
        const body = lines.map((l, i) => `<span style="color:#8e8e93">${String(i).padStart(width, ' ')}</span>  ${l}`).join('\n');
        return `<pre style="margin:0;white-space:pre">${body}</pre>`;
    }

    // Language id for a file extension, if highlight.js knows it.
    function languageFor(ext) {
        if (!hljs || !ext) return '';
        return hljs.getLanguage(ext) ? ext : '';
    }

    return {
        detect: detect,
        highlight: highlight,
        languageFor: languageFor,
        count: hljs ? hljs.listLanguages().length : 0,
    };
})
