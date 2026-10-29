import t from '../components/table.module.css';
import { PageHeader, Panel, Tile, ui } from '../components/ui';
import { api, type ChargeStation, GRAND_REIMS, type Report } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { formatNumber, formatPercent, since, updated } from '../lib/format';
import { brokenStations, chargeOffer, chargeSummary, nearestStation, stationState, type StationState } from '../lib/stats';
import { useNow, usePoll } from '../lib/use-poll';
import s from './parking.module.css';

const MINUTE = 60_000;

const STATE: Record<StationState, { label: string; cls: string }> = {
  service: { label: 'En service', cls: t.pillGood! },
  complet: { label: 'Complet', cls: t.pillWarn! },
  panne: { label: 'Panne signalée', cls: t.pillBad! },
  inconnu: { label: 'Sans donnée', cls: t.pillMuted! },
};

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const price = (st: ChargeStation) =>
  !st.price ? '—' : st.price.free ? 'Gratuit' : `${st.price.from ? 'dès ' : ''}${euro.format(st.price.kwh)}/kWh`;

/** Web 4 · Recharge : bornes du Grand Reims, état publié par les opérateurs et pannes signalées. */
export function ChargePage() {
  const now = useNow();
  const charge = usePoll(api.chargeStations(GRAND_REIMS), MINUTE, 'bornes');
  const reports = usePoll(api.reports(GRAND_REIMS), 30_000, 'signalements');

  const stations = charge.data ?? [];
  const broken = (reports.data ?? []).filter((r) => r.kind === 'borne_hs');
  const down = brokenStations(broken, stations);
  const sum = charge.data ? chargeSummary(stations) : null;
  const offer = charge.data ? chargeOffer(stations) : null;
  const points = stations.reduce((n, st) => n + st.total, 0);
  // Les stations signalées en panne d'abord : c'est ce que la ville doit voir.
  const isDown = (st: ChargeStation) => (down.has(st.id) ? 1 : 0);
  const rows = [...stations].sort((a, b) => isDown(b) - isDown(a) || b.total - a.total || b.maxPowerKw - a.maxPowerKw).slice(0, 12);

  return (
    <main className={ui.page}>
      <PageHeader
        title="Recharge"
        subtitle={`${charge.data ? `${formatNumber(points)} points de charge sur le Grand Reims` : 'Bornes du Grand Reims'} · ${updated(charge.at, now, charge.error)}`}
        onExport={charge.data ? () => exportStations(stations, down) : undefined}
        noPeriod
      />

      <div className={ui.tiles}>
        <Tile
          label="Points libres" source={charge}
          value={sum ? `${formatNumber(sum.free)} / ${formatNumber(sum.known)}` : '…'}
          note={sum?.ratio != null ? `${formatPercent(sum.ratio)} disponibles` : ''}
          tone="good"
        />
        <Tile label="Pannes signalées" source={reports} value={reports.data ? formatNumber(broken.length) : '…'} note="par les conducteurs Zelo" tone={broken.length ? 'bad' : 'muted'} />
        <Tile
          label="Recharge rapide" source={charge}
          value={offer ? formatNumber(offer.fast) : '…'}
          note={offer ? `points de 50 kW et plus, dans ${formatNumber(offer.fastStations)} stations` : ''}
        />
        <Tile
          label="Prix moyen du kWh" source={charge}
          value={offer?.avgKwh != null ? euro.format(offer.avgKwh) : offer ? '—' : '…'}
          note={offer ? `prix ferme annoncé par ${formatNumber(offer.priced)} stations` : ''}
        />
      </div>

      <div className={ui.row}>
        <section className={`${ui.card} ${ui.main} ${t.tableCard}`}>
          <h2 className={`${ui.panelTitle} ${t.tableTitle}`}>Stations</h2>
          <div className={t.scroll}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th scope="col">Station</th>
                  <th scope="col">Opérateur</th>
                  <th scope="col">Points libres</th>
                  <th scope="col">Puissance</th>
                  <th scope="col">État</th>
                  <th scope="col">Prix</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((st) => {
                  const state = STATE[stationState(st, down)];
                  return (
                    <tr key={st.id}>
                      <th scope="row" className={t.name}>
                        {st.name || 'Sans nom'}
                      </th>
                      <td>{st.operator || '—'}</td>
                      <td>{st.available === null ? `— / ${st.total}` : `${Math.min(st.available, st.total)} / ${st.total}`}</td>
                      <td>{formatNumber(Math.round(st.maxPowerKw))} kW</td>
                      <td>
                        <span className={`${t.pill} ${state.cls}`}>{state.label}</span>
                      </td>
                      <td>{price(st)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <p className={s.text} style={{ padding: '12px 24px' }}>{charge.error ? 'Bornes indisponibles.' : 'Chargement…'}</p>}
          </div>
        </section>

        <Panel title="Pannes signalées" className={ui.side}>
          {reports.data && broken.length === 0 && <p className={s.text}>Aucune panne signalée en ce moment.</p>}
          {broken.map((r) => (
            <Broken key={r.id} report={r} stations={stations} now={now} />
          ))}
          <p className={ui.footnote}>
            Un conducteur signale une borne en panne depuis l’app ; le signalement dure 6 h et s’allonge à chaque confirmation.
            L’état des points vient des opérateurs (fichier national IRVE).
          </p>
        </Panel>
      </div>

      <p className={ui.footnote}>Données agrégées et anonymisées. Aucun trajet individuel n’est visible.</p>
    </main>
  );
}

function Broken({ report, stations, now }: { report: Report; stations: ChargeStation[]; now: Date }) {
  const st = nearestStation(report, stations);
  const confirmed = report.confirmations > 0 ? ` · ${formatNumber(report.confirmations)} confirmation${report.confirmations > 1 ? 's' : ''}` : '';
  return (
    <div>
      <p className={s.lead} style={{ fontSize: 14 }}>
        {st ? `${st.name || 'Station sans nom'} · ${st.total} point${st.total > 1 ? 's' : ''}` : 'Borne hors station connue'}
      </p>
      <p className={s.text} style={{ fontSize: 13 }}>
        Signalé {since(new Date(report.createdAt), now)}
        {confirmed}
      </p>
    </div>
  );
}

function exportStations(stations: ChargeStation[], down: Set<string>) {
  downloadCsv(`zelo-recharge-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['station', 'operateur', 'latitude', 'longitude', 'points', 'libres', 'puissance_kw', 'etat', 'prix_kwh_euros'],
    ...stations.map((st) => [
      st.name,
      st.operator,
      st.lat,
      st.lon,
      st.total,
      st.available ?? '',
      st.maxPowerKw,
      STATE[stationState(st, down)].label,
      st.price && !st.price.free ? st.price.kwh : st.price?.free ? 0 : '',
    ]),
  ]);
}
