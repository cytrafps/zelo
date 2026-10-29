"""Grille Sanef (PDF officiel) → JSON : gares par réseau, tarifs entrée-sortie et péages fixes, par classe.

Usage : python3 extract.py 2026_02-Grille-Sanef.pdf ../../services/api/internal/toll/sanef-2026.json
(pip install pdfplumber). Le PDF : www.autoroutes.sanef.com/fr/grilles-tarifs-de-peage.

La grille est un triangle par réseau : la ligne d'une gare donne son tarif vers chaque gare dont
le nom commence plus à gauche (sa colonne). Une case grise n'a pas de tarif. Quand plusieurs
gares commencent sur la même colonne (Meaux, Saint-Jean, Montreuil), la grille ne dit pas
laquelle elle désigne : ces cases sont écartées plutôt que devinées. Contrôles : mêmes gares
dans les cinq classes, classe 2 ≥ classe 1, moto ≤ voiture ; le script affiche les alertes.
"""
import json, re, sys
import pdfplumber

NUM = re.compile(r'^\d+[,.]\d$')
X0, PITCH = 6.4, 13.9
col = lambda x: round((x - X0) / PITCH - 0.5)       # centre d'une case → colonne
diag = lambda x: round((x - X0) / PITCH)            # début d'un nom → sa colonne
warn = []

def page_rows(page):
    blue = [r for r in page.rects if r['non_stroking_color'] and len(r['non_stroking_color']) == 3 and r['non_stroking_color'][2] > 0.4 and r['non_stroking_color'][0] < 0.2]
    inblue = lambda w: any(b['x0'] - 1 <= w['x0'] and w['x1'] <= b['x1'] + 1 and b['top'] - 1 <= w['top'] <= b['bottom'] + 1 for b in blue)
    words = [w for w in page.extract_words() if w['top'] > 85 and not inblue(w)]
    rows = []
    for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
        if rows and abs(rows[-1][0] - w['top']) < 2.5:
            rows[-1][1].append(w)
        else:
            rows.append([w['top'], [w]])
    return [sorted(ws, key=lambda w: w['x0']) for _, ws in rows]

def parse_page(page):
    blocks, cur = [], None
    for ws in page_rows(page):
        nums = [w for w in ws if NUM.match(w['text'])]
        names = [w for w in ws if not NUM.match(w['text'])]
        if not nums and names and diag(names[0]['x0']) == 0:          # première gare d'un réseau
            cur = dict(gares=[], cols={}, pairs={}, flat={})
            blocks.append(cur)
            cur['gares'].append(' '.join(w['text'] for w in names))
            cur['cols'][0] = [0]
            continue
        if cur is None:
            continue
        if not nums and names[0]['text'].startswith('('):              # suite du nom de la ligne précédente
            cur['gares'][-1] += ' ' + ' '.join(w['text'] for w in names)
            continue
        if not nums:                                                   # gare sans aucun tarif (section gratuite)
            cur['gares'].append(' '.join(w['text'] for w in names))
            cur['cols'].setdefault(diag(names[0]['x0']), []).append(len(cur['gares']) - 1)
            continue
        if names and names[0]['x0'] < nums[0]['x0']:                   # ligne du bas : péages à prix fixe
            name = []
            for w in ws:
                if NUM.match(w['text']):
                    cur['flat'][' '.join(name)] = float(w['text'].replace(',', '.'))
                    name = []
                else:
                    name.append(w['text'])
            continue
        i = len(cur['gares'])
        cur['gares'].append(' '.join(w['text'] for w in names))
        d = diag(names[0]['x0'])
        for w in nums:
            c = col((w['x0'] + w['x1']) / 2)
            if c >= d:
                warn.append(f'{cur["gares"][i]} : case {c} au-delà de la diagonale {d}')
            if c not in cur['cols']:
                warn.append(f'{cur["gares"][i]} : colonne {c} sans gare')
                continue
            if len(cur['cols'][c]) > 1:                                # plusieurs gares sur la même colonne : on ne devine pas
                cur['skipped'] = cur.get('skipped', 0) + 1
                continue
            cur['pairs'][(cur['cols'][c][0], i)] = float(w['text'].replace(',', '.'))
        cur['cols'].setdefault(d, []).append(i)
    return blocks

with pdfplumber.open(sys.argv[1]) as pdf:
    out = {}
    for k in range(1, 6):
        page = pdf.pages[k]
        cls = re.search(r'CLASSE\s*(\d)', page.extract_text())
        cls = int(cls.group(1)) if cls else k
        out[cls] = parse_page(page)

# Contrôles : mêmes gares d'une classe à l'autre ; classe 2 ≥ classe 1 ≥ classe 5 (moto).
ref = out[1]
for cls, blocks in out.items():
    assert [b['gares'] for b in blocks] == [b['gares'] for b in ref], f'gares différentes en classe {cls}'
for bi, b in enumerate(ref):
    for key, v in b['pairs'].items():
        for cls, rel in [(2, 1), (3, 2), (4, 3)]:
            w = out[cls][bi]['pairs'].get(key)
            if w is None:
                warn.append(f'classe {cls} : paire {b["gares"][key[0]]} / {b["gares"][key[1]]} absente')
            elif w < out[rel][bi]['pairs'][key]:
                warn.append(f'classe {cls} < classe {rel} : {b["gares"][key[0]]} / {b["gares"][key[1]]} ({w} < {out[rel][bi]["pairs"][key]})')
        m = out[5][bi]['pairs'].get(key)
        if m is not None and m > v:
            warn.append(f'moto > voiture : {b["gares"][key[0]]} / {b["gares"][key[1]]} ({m} > {v})')

json.dump({'source': 'Sanef, tarifs de péage TTC au 01/02/2026', 'classes': {
    cls: [{'gares': b['gares'], 'pairs': [[i, j, p] for (i, j), p in sorted(b['pairs'].items())], 'flat': b['flat']} for b in blocks]
    for cls, blocks in out.items()}}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)
for b in ref:
    print(len(b['gares']), 'gares,', len(b['pairs']), 'paires, écartées', b.get('skipped', 0), ', fixes', b['flat'], '|', b['gares'][0], '→', b['gares'][-1])
    print('   colonnes partagées :', {c: [b['gares'][i] for i in v] for c, v in b['cols'].items() if len(v) > 1})
print(len(warn), 'alertes'); print('\n'.join(warn[:60]))
