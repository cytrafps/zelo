import type { Polled } from '../lib/use-poll';
import { type ReactNode, useEffect, useRef } from 'react';

import { navigated } from '../lib/router';

import s from './ui.module.css';

export { s as ui };

/**
 * Titre de page, sous-titre et export. À l'arrivée sur la page, le titre de l'onglet change et le
 * focus va au titre : un lecteur d'écran annonce la nouvelle page au lieu de rester sur le lien.
 */
export function PageHeader(props: { title: string; subtitle: string; onExport?: () => void }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const { title } = props;
  useEffect(() => {
    document.title = `${title} · Zelo Ville`;
    // Pas au premier chargement : le focus resterait sinon sur le titre au lieu du début de page.
    if (navigated()) h1.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <header className={s.header}>
      <div className={s.titles}>
        <h1 ref={h1} tabIndex={-1} className={s.title}>
          {props.title}
        </h1>
        <p className={s.subtitle}>{props.subtitle}</p>
      </div>
      {props.onExport && (
        <button type="button" className={s.button} onClick={props.onExport}>
          Exporter
        </button>
      )}
    </header>
  );
}

/**
 * Chiffre clé. `source` : la requête dont il dépend ; si elle échoue avant toute donnée, la tuile
 * le dit au lieu de rester sur « … » (le chargement est relancé tout seul).
 */
export function Tile(props: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'muted';
  source?: Pick<Polled<unknown>, 'data' | 'error'>;
}) {
  const failed = props.source?.error === true && props.source.data === null;
  const tone = failed ? 'bad' : props.tone;
  return (
    // Un simple bloc, pas un repère : quatre <section> nommées par page encombraient la navigation par repères.
    <div className={s.tile}>
      <p className={s.tileLabel}>{props.label}</p>
      <p className={s.tileValue}>{failed ? '—' : props.value}</p>
      <p className={`${s.tileNote} ${tone ? s[tone] : ''}`}>{failed ? 'Indisponible, nouvel essai automatique' : props.note}</p>
    </div>
  );
}

export function Panel(props: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${s.panel} ${props.className ?? ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className={s.panelTitle} style={{ flex: 1 }}>
          {props.title}
        </h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}
