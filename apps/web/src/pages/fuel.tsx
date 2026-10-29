import t from '../components/table.module.css';
import { PageHeader, Panel, Tile, ui } from '../components/ui';
import { api, type FuelDay, type FuelStation, GRAND_REIMS } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { address, dayStamp, formatLitre, formatNumber, since, updated } from '../lib/format';
import { completeDays, freshFuel, fuelStats, weekChange } from '../lib/stats';
import { useNow, usePoll } from '../lib/use-poll';
import s from './fuel.module.css';

const MINUTE = 60_000;
/** Colonnes de la maquette ; le SP95-E10 est le carburant le plus vendu en station. */
const COLUMNS = [
  { fuel: 'E10', label: 'SP95-E10' },
  { fuel: 'Gazole', label: 'Gazole' },
  { fuel: 'E85', label: 'E85' },
] as const;
const ROWS = 14;

const dayLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const cents = (euros: number) => Math.round(euros * 100);

function change(days: FuelDay[] | null) {
  if (!days) return '';
  const d = weekChange(days);
  if (d === null) return 'tendance dès 7 jours d’historique';
  const c = cents(d);
  return c === 0 ? 'stable sur 7 jours' : `${c > 0 ? '+' : '−'}${Math.abs(c)} ct${Math.abs(c) > 1 ? 's' : ''} sur 7 jours`;
}
const changeTone = (days: FuelDay[] | null) => {
  const d = days && weekChange(days);
  return d == null || cents(d) === 0 ? undefined : d < 0 ? ('good' as const) : ('bad' as const);
};

/** Web 5 · Carburant : prix officiels des stations du Grand Reims et leur tendance. */
export function FuelPage() {
  const now = useNow();
  const fuel = usePoll(api.fuelStations(GRAND_REIMS), 10 * MINUTE, 'carburant');
  const e10Trend = usePoll(api.fuelTrend(GRAND_REIMS, 'E10'), 30 * MINUTE, 'tendance-e10');
  const gazoleTrend = usePoll(api.fuelTrend(GRAND_REIMS, 'Gazole'), 30 * MINUTE, 'tendance-gazole');

  const stations = fuel.data ? freshFuel(fuel.data, now) : [];
  const stats = Object.fromEntries(COLUMNS.map((c) => [c.fuel, fuelStats(stations, c.fuel)]));
  const e10 = stats.E10;
  // Moyennes de la zone : celles de la tendance (même calcul que la courbe et l'évolution), à défaut
  // celles des stations listées.
  const e10Avg = e10Trend.data?.at(-1)?.avg ?? e10?.avg;
  const gazoleAvg = gazoleTrend.data?.at(-1)?.avg ?? stats.Gazole?.avg;
  const latest = stations.reduce<Date | null>((m, st) => {
    const d = new Date(st.updatedAt);
    return !m || d > m ? d : m;
  }, null);
  const rows = [...stations]
    .sort((a, b) => (a.prices.E10 ?? Infinity) - (b.prices.E10 ?? Infinity) || (a.prices.Gazole ?? Infinity) - (b.prices.Gazole ?? Infinity))
    .slice(0, ROWS);

  return (
    <main className={ui.page}>
      <PageHeader
        title="Carburant"
        subtitle={`${fuel.data ? `${formatNumber(stations.length)} stations · prix officiels, ` : ''}${updated(fuel.data ? latest : null, now, fuel.error)}`}
        onExport={fuel.data ? () => exportFuel(stations) : undefined}
      />

      <div className={ui.tiles}>
        <Tile label="SP95-E10 moyen" source={fuel} value={e10Avg !== undefined ? formatLitre(e10Avg) : fuel.data ? '—' : '…'} note={change(e10Trend.data)} tone={changeTone(e10Trend.data)} />
        <Tile label="Gazole moyen" source={fuel} value={gazoleAvg !== undefined ? formatLitre(gazoleAvg) : fuel.data ? '—' : '…'} note={change(gazoleTrend.data)} tone={changeTone(gazoleTrend.data)} />
        <Tile
          label="Écart moins cher / plus cher" source={fuel}
          value={e10 ? `${formatNumber(cents(e10.max - e10.min))} cts` : fuel.data ? '—' : '…'}
          note={e10 ? `sur le SP95-E10, ${formatNumber(e10.count)} stations` : ''}
          tone="warn"
        />
        <Tile
          label="Prix à jour" source={fuel}
          value={fuel.data ? `${formatNumber(stations.filter((st) => now.getTime() - Date.parse(st.updatedAt) < 86_400_000).length)} / ${formatNumber(stations.length)}` : '…'}
          note="relevées depuis moins de 24 h"
          tone="muted"
        />
      </div>

      <div className={ui.row}>
        <section className={`${ui.card} ${ui.main} ${t.tableCard}`}>
          <h2 className={`${ui.panelTitle} ${t.tableTitle}`}>Stations les moins chères en SP95-E10</h2>
          <div className={t.scroll}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  {COLUMNS.map((c) => (
                    <th scope="col" key={c.fuel}>
                      {c.label}
                    </th>
                  ))}
                  <th scope="col">Mis à jour</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((st) => (
                  <tr key={st.id}>
                    <th scope="row" className={t.name}>
                      <span className={s.station}>
                        {address(st.address) || 'Adresse inconnue'}
                        <span className={s.city}>{address(st.city)}</span>
                      </span>
                    </th>
                    {COLUMNS.map((c) => {
                      const p = st.prices[c.fuel];
                      const range = stats[c.fuel];
                      const rank = p === undefined || !range || range.min === range.max ? null : p === range.min ? 'low' : p === range.max ? 'high' : null;
                      // La couleur ne suffit pas (daltonisme, lecteur d'écran) : une flèche et un texte la doublent.
                      return (
                        <td key={c.fuel} className={rank ? s[rank] : ''}>
                          {p === undefined ? '—' : formatLitre(p)}
                          {rank && (
                            <>
                              <span aria-hidden="true">{rank === 'low' ? ' ↓' : ' ↑'}</span>
                              <span className="sr-only">{rank === 'low' ? ' (le moins cher)' : ' (le plus cher)'}</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td>{since(new Date(st.updatedAt), now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className={s.text} style={{ padding: '12px 24px' }}>{fuel.error ? 'Prix indisponibles.' : 'Chargement…'}</p>}
          </div>
        </section>

        <Panel title="Tendance sur 30 jours" className={ui.side}>
          <Trend days={e10Trend.data} error={e10Trend.error} />
          <p className={s.text}>
            En vert (↓) le prix le plus bas de la zone, en rouge (↑) le plus haut. Les prix viennent du flux officiel des stations
            (data.gouv.fr), relu toutes les 10 minutes. Zelo n’influence aucun prix.
          </p>
        </Panel>
      </div>

      <p className={ui.footnote}>Données agrégées et anonymisées. Aucun trajet individuel n’est visible.</p>
    </main>
  );
}

/** Barres du SP95-E10 moyen ; les jours d'avant l'historique complet restent hachurés. */
function Trend({ days, error }: { days: FuelDay[] | null; error: boolean }) {
  if (!days) return <p className={s.text}>{error ? 'Tendance indisponible.' : 'Chargement…'}</p>;
  const ok = new Set(completeDays(days).map((d) => d.day));
  const shown = days.filter((d) => ok.has(d.day));
  const first = shown[0];
  const last = shown.at(-1);
  // Échelle resserrée sur la plage des prix : quelques centimes doivent se voir.
  const lo = Math.min(...shown.map((d) => d.avg));
  const hi = Math.max(...shown.map((d) => d.avg));
  const height = (v: number) => (hi - lo < 0.005 ? 70 : 30 + ((v - lo) / (hi - lo)) * 70);
  const missing = Math.max(0, 30 - shown.length);

  return (
    <>
      <div className={s.bars} role="img" aria-label={first && last ? `SP95-E10 moyen de ${formatLitre(first.avg)} à ${formatLitre(last.avg)}` : 'Historique en cours'}>
        {Array.from({ length: missing }, (_, i) => (
          <i key={`p${i}`} className={s.pending} />
        ))}
        {shown.map((d, i) => (
          <i key={d.day} className={i === shown.length - 1 ? s.today : ''} style={{ height: `${height(d.avg)}%` }} title={`${d.day} · ${formatLitre(d.avg)}`} />
        ))}
      </div>
      {first && last && first !== last ? (
        <p className={s.trendLine}>
          SP95-E10 moyen · {formatLitre(first.avg)} → {formatLitre(last.avg)}
          {missing > 0 && ` · historique depuis le ${dayLabel.format(new Date(`${first.day}T12:00:00Z`))}`}
        </p>
      ) : (
        <p className={s.trendLine}>Historique en cours : Zelo garde les prix depuis sa mise en service, la courbe se remplit jour après jour.</p>
      )}
    </>
  );
}

function exportFuel(stations: FuelStation[]) {
  downloadCsv(`zelo-carburant-${dayStamp(new Date())}.csv`, [
    ['adresse', 'ville', 'latitude', 'longitude', 'gazole', 'sp95', 'sp98', 'e10', 'e85', 'gplc', 'mis_a_jour'],
    ...stations.map((st) => [
      st.address,
      st.city,
      st.lat,
      st.lon,
      ...['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'].map((f) => st.prices[f] ?? ''),
      st.updatedAt,
    ]),
  ]);
}
