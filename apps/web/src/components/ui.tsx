import type { ReactNode } from 'react';

import s from './ui.module.css';

export { s as ui };

export type Period = 'jour' | 'semaine' | 'mois';

/** Titre de page, sous-titre, période et export (en-tête des maquettes Web 1 à 6). */
export function PageHeader(props: { title: string; subtitle: string; onExport?: () => void; history?: boolean; noPeriod?: boolean }) {
  return (
    <header className={s.header}>
      <div className={s.titles}>
        <h1 className={s.title}>{props.title}</h1>
        <p className={s.subtitle}>{props.subtitle}</p>
      </div>
      {/* Semaine et mois demandent un historique : l'API ne garde que l'état en cours. */}
      {!props.noPeriod && <div className={s.segmented} role="group" aria-label="Période">
        <button type="button" className={s.segment} aria-pressed="true">
          Jour
        </button>
        <button type="button" className={s.segment} aria-pressed="false" disabled={!props.history} title="Historique à venir">
          Semaine
        </button>
        <button type="button" className={s.segment} aria-pressed="false" disabled={!props.history} title="Historique à venir">
          Mois
        </button>
      </div>}
      {props.onExport && (
        <button type="button" className={s.button} onClick={props.onExport}>
          Exporter
        </button>
      )}
    </header>
  );
}

export function Tile(props: { label: string; value: ReactNode; note: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'muted' }) {
  return (
    <section className={s.tile} aria-label={props.label}>
      <p className={s.tileLabel}>{props.label}</p>
      <p className={s.tileValue}>{props.value}</p>
      <p className={`${s.tileNote} ${props.tone ? s[props.tone] : ''}`}>{props.note}</p>
    </section>
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
