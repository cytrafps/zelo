/** Tableaux longs (tracés, listes) réduits à leurs premiers éléments, suivis d'un repère « … N de plus ». */
function shorten(v: unknown, keep: number): unknown {
  if (Array.isArray(v)) {
    const head = v.slice(0, keep).map((x) => shorten(x, 2));
    return v.length > keep ? [...head, `… ${v.length - keep} de plus`] : head;
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, keep)]));
  }
  return v;
}

/** Réponse de l'API lisible dans la console : premier élément d'une liste, tableaux imbriqués raccourcis. */
export function preview(text: string) {
  try {
    return JSON.stringify(shorten(JSON.parse(text), 1), null, 2);
  } catch {
    return text.slice(0, 2000);
  }
}
