#!/usr/bin/env python3
"""Create/refresh po/<lang>.po from the .pot and a JSON of translations."""
import json, os, re, sys
lang, src = sys.argv[1], sys.argv[2]
root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'copy-addict@kbrianps'))
uuid = os.path.basename(root)
pot = open(os.path.join(root, 'po', f'{uuid}.pot')).read()
tr = json.load(open(src))
def esc(s): return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
def unesc(s): return s.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
out = [f'''msgid ""
msgstr ""
"Project-Id-Version: copy-addict\\n"
"Language: {lang}\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: nplurals=2; plural=(n > 1);\\n"
''']
missing = []
for m in re.finditer(r'((?:#[^\n]*\n)*)msgid "((?:[^"\\]|\\.)*)"\n(?:msgid_plural "((?:[^"\\]|\\.)*)"\n)?', pot):
    comments, mid, plural = m.group(1), unesc(m.group(2)), m.group(3)
    if not mid: continue
    t = tr.get(mid)
    if t is None: missing.append(mid)
    block = comments + f'msgid "{esc(mid)}"\n'
    if plural is not None:
        forms = t if isinstance(t, list) else ['', '']
        block += f'msgid_plural "{plural}"\nmsgstr[0] "{esc(forms[0])}"\nmsgstr[1] "{esc(forms[1])}"\n'
    else:
        block += f'msgstr "{esc(t or "")}"\n'
    out.append(block)
open(os.path.join(root, 'po', f'{lang}.po'), 'w').write('\n'.join(out))
print('missing:', missing if missing else 'none')
