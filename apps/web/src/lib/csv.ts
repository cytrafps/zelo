type Cell = string | number;

/** CSV séparé par des points-virgules (Excel français), avec BOM pour les accents. */
export function toCsv(rows: Cell[][]) {
  const cell = (v: Cell) => {
    const t = String(v);
    return /[;"\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export function downloadCsv(name: string, rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
