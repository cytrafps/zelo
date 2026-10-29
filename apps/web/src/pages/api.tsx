import { useEffect, useState } from 'react';

import { Panel, PageHeader, ui } from '../components/ui';
import { CENTRE } from '../lib/api';
import { preview } from '../lib/preview';
import s from './api.module.css';

type Endpoint = {
  path: string;
  params: string;
  desc: string;
  fresh: string;
  /** Requête d'exemple, envoyée telle quelle quand on choisit le point d'accès ; absent : non essayable ici. */
  example?: string;
  ws?: boolean;
};

const box = CENTRE.join(',');

/** Les routes publiques de l'API (services/api/internal/httpapi), avec la fréquence de mise à jour de leur source. */
const ENDPOINTS: Endpoint[] = [
  { path: '/v1/parkings', params: '?bbox=', desc: 'Parkings publics : places, PMR, hauteur, tarifs relevés', fresh: '1 j', example: `/v1/parkings?bbox=${box}` },
  { path: '/v1/charge-stations', params: '?bbox=', desc: 'Bornes : points libres, puissance, prix au kWh', fresh: '5 min', example: `/v1/charge-stations?bbox=${box}` },
  { path: '/v1/fuel-stations', params: '?bbox=', desc: 'Prix des carburants par station', fresh: '10 min', example: `/v1/fuel-stations?bbox=${box}` },
  { path: '/v1/fuel-trend', params: '?bbox=&fuel=', desc: 'Prix moyen, min et max par jour (35 jours)', fresh: '10 min', example: `/v1/fuel-trend?bbox=${box}&fuel=E10&days=7` },
  { path: '/v1/reports', params: '?bbox=', desc: 'Signalements des conducteurs, avec leurs votes', fresh: 'Temps réel', example: `/v1/reports?bbox=${box}` },
  { path: '/v1/live', params: '', desc: 'Flux WebSocket des nouveaux signalements', fresh: 'Temps réel', ws: true },
  { path: '/v1/closures', params: '?bbox=', desc: 'Fermetures de rues publiées dans DiaLog', fresh: '1 j', example: `/v1/closures?bbox=${box}` },
  { path: '/v1/zfe', params: '?bbox=', desc: 'Zones à faibles émissions et vignettes Crit’Air', fresh: '1 j', example: `/v1/zfe?bbox=${box}` },
  { path: '/v1/weather', params: '?at=lat,lon', desc: 'Pluie, froid et vigilance Météo-France', fresh: '15 min', example: '/v1/weather?at=49.2535,4.0341' },
  { path: '/v1/park-ride', params: '?to=lat,lon', desc: 'Parkings relais et prochains trams vers une destination', fresh: 'Temps réel', example: '/v1/park-ride?to=49.2535,4.0341' },
];

type Result = { status: number; ms: number; body: string } | { error: string };

/** Web 2 · API & données ouvertes : les routes de l'API, essayées en direct. */
export function ApiPage() {
  const [selected, setSelected] = useState(ENDPOINTS[0]!);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<'ok' | 'echec' | null>(null);
  const base = `${window.location.origin}/v1`;

  useEffect(() => {
    if (!selected.example) {
      setResult(null);
      return;
    }
    const ctl = new AbortController();
    const t0 = performance.now();
    setResult(null);
    fetch(selected.example, { signal: ctl.signal, headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const text = await res.text();
        setResult({ status: res.status, ms: Math.round(performance.now() - t0), body: preview(text) });
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setResult({ error: e instanceof Error ? e.message : 'requête impossible' });
      });
    return () => ctl.abort();
  }, [selected]);

  // Presse-papiers refusé (adresse en http, permission) : on le dit au lieu de ne rien faire.
  const copy = () => {
    const done = (ok: boolean) => {
      setCopied(ok ? 'ok' : 'echec');
      setTimeout(() => setCopied(null), 2000);
    };
    if (!navigator.clipboard) return done(false);
    navigator.clipboard.writeText(base).then(() => done(true), () => done(false));
  };

  return (
    <main className={ui.page}>
      <PageHeader title="API & données ouvertes" subtitle="Les mêmes données que l’app, en temps réel, pour vos outils et vos panneaux" />

      <div className={ui.row}>
        <section className={`${s.base} ${ui.main}`}>
          <div className={s.baseText}>
            <span className={s.label}>Adresse de l’API</span>
            <span className={s.url}>{base}</span>
            <span className={s.note}>Accès libre, sans clé ni compte · réponses JSON · coordonnées en WGS 84</span>
          </div>
          <button type="button" className={ui.button} onClick={copy}>
            {copied === 'ok' ? 'Copié' : copied === 'echec' ? 'Copie impossible' : 'Copier'}
          </button>
        </section>
        <section className={`${s.limits} ${ui.side}`} aria-label="Limites">
          <span className={s.label}>Limites par adresse IP</span>
          <span>
            <b>Lecture</b> : sans limite, réponses mises en cache
          </span>
          <span>
            <b>Itinéraires</b> : 1 par seconde · <b>signalements</b> : 1 toutes les 12 s
          </span>
        </section>
      </div>

      <div className={ui.row}>
        <section className={`${s.list} ${ui.main}`}>
          <div className={s.listHead}>
            <h2 className={ui.panelTitle}>Points d’accès</h2>
            <span>Mise à jour de la source</span>
          </div>
          {ENDPOINTS.map((e) => (
            <button key={e.path} type="button" className={s.endpoint} aria-pressed={e === selected} onClick={() => setSelected(e)}>
              <span className={`${s.method} ${e.ws ? s.ws : ''}`}>{e.ws ? 'WS' : 'GET'}</span>
              <span className={s.what}>
                <span className={s.path}>
                  {e.path}
                  <span style={{ color: 'var(--texte-3)' }}>{e.params}</span>
                </span>
                <span className={s.desc}>{e.desc}</span>
              </span>
              <span className={s.fresh}>{e.fresh}</span>
            </button>
          ))}
        </section>

        <section className={`${s.console} ${ui.side}`} aria-label="Réponse d’exemple">
          {/* Seul l'état est annoncé : la réponse JSON entière serait lue à chaque clic. */}
          <div className={s.consoleHead} aria-live="polite">
            <code>
              {selected.ws ? 'WS' : 'GET'} {selected.path}
            </code>
            {result && 'status' in result && (
              <span className={`${s.status} ${result.status >= 400 ? s.err : ''}`}>
                {result.status} · {result.ms} ms
              </span>
            )}
            {result && 'error' in result && <span className={`${s.status} ${s.err}`}>échec</span>}
          </div>
          {selected.ws ? (
            <pre className={s.json}>{wsExample()}</pre>
          ) : (
            <pre className={s.json}>{!result ? 'Requête en cours…' : 'error' in result ? result.error : result.body}</pre>
          )}
          {selected.example && (
            <p className={s.consoleNote}>
              Réponse réelle, raccourcie au premier élément ·{' '}
              <a href={selected.example} target="_blank" rel="noreferrer">
                ouvrir la réponse complète
              </a>
            </p>
          )}
        </section>
      </div>

      <Panel title="Sources">
        <p className={s.note}>
          Prix des carburants et bornes de recharge (data.gouv.fr), fermetures de rues (DiaLog), zones à faibles émissions et
          vigilance (Météo-France) : Licence Ouverte. Parkings, feux et stops : OpenStreetMap, ODbL. Météo : Open-Meteo,
          CC BY 4.0. Tarifs des parkings relevés chez les exploitants. Signalements : conducteurs Zelo, anonymes.
        </p>
      </Panel>

      <p className={ui.footnote}>Aucune donnée personnelle : ni trajet, ni position, ni identifiant d’usager ne sort de l’API.</p>
    </main>
  );
}

const wsExample = () => `// Chaque nouveau signalement, dès qu'il est créé :
const ws = new WebSocket('${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/v1/live');
ws.onmessage = (e) => console.log(JSON.parse(e.data));`;
