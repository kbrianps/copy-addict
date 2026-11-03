#!/usr/bin/env python3
"""Build po/<uuid>.pot from the JavaScript sources and settings-schema.json."""
import json, os, subprocess, sys, tempfile

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'copy-addict@kbrianps')
root = os.path.normpath(root)
uuid = os.path.basename(root)
po_dir = os.path.join(root, 'po')
os.makedirs(po_dir, exist_ok=True)
pot = os.path.join(po_dir, f'{uuid}.pot')

js = sorted(f for f in os.listdir(root) if f.endswith('.js'))
subprocess.run(['xgettext', '--language=JavaScript', '--from-code=UTF-8', '--keyword=_', '--keyword=ngettext:1,2',
                '--package-name=copy-addict', '--add-comments=Translators', '-o', pot] + js, cwd=root, check=True)

# Strings shown by Cinnamon's settings window.
schema = json.load(open(os.path.join(root, 'settings-schema.json')))
strings = []
for key, v in schema.items():
    if not isinstance(v, dict):
        continue
    for field in ('title', 'description', 'tooltip', 'units'):
        if isinstance(v.get(field), str) and v[field]:
            strings.append((v[field], f'settings-schema.json->{key}->{field}'))
    if isinstance(v.get('options'), dict):
        for label in v['options']:
            strings.append((label, f'settings-schema.json->{key}->options'))
    if key == 'layout':
        for name, sub in v.items():
            if isinstance(sub, dict) and sub.get('title'):
                strings.append((sub['title'], f'settings-schema.json->layout->{name}'))
meta = json.load(open(os.path.join(root, 'metadata.json')))
strings.append((meta['description'], 'metadata.json->description'))

def esc(s):
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

existing = open(pot).read()
with open(pot, 'a') as f:
    seen = set()
    for text, ref in strings:
        if text in seen or f'msgid "{esc(text)}"' in existing:
            continue
        seen.add(text)
        f.write(f'\n#. {ref}\nmsgid "{esc(text)}"\nmsgstr ""\n')
print(f'wrote {pot}')
