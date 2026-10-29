type Cell = string | number;

/**
 * Un texte venu des données ouvertes ou d'un signalement peut commencer par
 * « = », « + », « - », « @ » : Excel et LibreOffice l'exécuteraient comme une
 * formule. On le préfixe d'une apostrophe, qui force le texte.
 */
const formula = /^[=+\-@\t\r]/;

const text = (t: string) => {
  const safe = formula.test(t) ? `'${t}` : t;
  return /[;"\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** Virgule décimale : avec le point, Excel français lit 2.5 comme du texte ou une date. */
const number = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');

/** CSV séparé par des points-virgules (Excel français), avec BOM pour les accents. */
export function toCsv(rows: Cell[][]) {
  const cell = (v: Cell) => (typeof v === 'number' ? number(v) : text(v));
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(name: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  // Révoquer tout de suite peut annuler le téléchargement (Firefox, Safari).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
