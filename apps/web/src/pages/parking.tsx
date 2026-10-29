import { PageHeader, Panel, Tile, ui } from '../components/ui';
import { api, CENTRE, GRAND_REIMS, type Parking } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { formatCents, formatNumber, parkingName, updated } from '../lib/format';
import { capacitySummary, hourPrice, parkingTable } from '../lib/stats';
import { useNow, usePoll } from '../lib/use-poll';
import t from '../components/table.module.css';
import s from './parking.module.css';

const HOUR = 3_600_000;
const MAPRAID = 'https://github.com/cytrafps/zelo/blob/main/docs/mapraid.md';

/** Web 3 · Stationnement : les parkings du centre et les P+R, d'après OpenStreetMap et les grilles des exploitants. */
export function ParkingPage() {
  const now = useNow();
  const centre = usePoll(api.parkings(CENTRE), HOUR, 'parkings-centre');
  const all = usePoll(api.parkings(GRAND_REIMS), HOUR, 'parkings-agglo');

  const cap = centre.data ? capacitySummary(centre.data) : null;
  const relays = all.data?.filter((p) => p.parkRide) ?? [];
  const relayPlaces = relays.reduce((n, p) => n + (p.capacity ?? 0), 0);
  const rows = centre.data && all.data ? parkingTable(centre.data, all.data, 12) : [];
  const agglo = all.data ? capacitySummary(all.data) : null;

  return (
    <main className={ui.page}>
      <PageHeader
        title="Stationnement"
        subtitle={`${rows.length ? `${rows.length} parkings du centre et P+R` : 'Parkings du centre'} · ${updated(centre.at, now)}`}
        onExport={rows.length ? () => exportParkings(rows) : undefined}
        noPeriod
      />

      <div className={ui.tiles}>
        <Tile
          label="Places (centre)"
          value={cap ? formatNumber(cap.places) : '…'}
          note={cap ? `dans ${plural(cap.total - cap.unknown, 'parking renseigné', 'parkings renseignés')}` : ''}
        />
        <Tile
          label="Places PMR"
          value={cap ? formatNumber(cap.disabled) : '…'}
          note={cap ? `relevées dans ${plural(cap.withDisabled, 'parking', 'parkings')}` : ''}
        />
        <Tile label="Places libres" value="—" note="Comptages pas encore publiés" tone="muted" />
        <Tile
          label="Parkings relais (P+R)"
          value={all.data ? formatNumber(relayPlaces) : '…'}
          note={all.data ? `places dans ${plural(relays.length, 'P+R', 'P+R')} du Grand Reims` : ''}
          tone="good"
        />
      </div>

      <div className={ui.row}>
        <section className={`${ui.card} ${ui.main} ${t.tableCard}`}>
          <h2 className={`${ui.panelTitle} ${t.tableTitle}`}>Parkings</h2>
          <div className={t.scroll}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th scope="col">Parking</th>
                  <th scope="col">Places</th>
                  <th scope="col">PMR</th>
                  <th scope="col">Tarif 1 h</th>
                  <th scope="col">Hauteur max.</th>
                  <th scope="col">Exploitant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <ParkingRow key={p.id} p={p} />
                ))}
              </tbody>
            </table>
            {!rows.length && <p className={s.text} style={{ padding: '12px 24px' }}>{centre.error ? 'Parkings indisponibles.' : 'Chargement…'}</p>}
          </div>
        </section>

        <Panel title="Données à compléter" className={ui.side}>
          {agglo && (
            <>
              <p className={s.lead}>
                {agglo.unknown === 1 ? '1 parking' : `${formatNumber(agglo.unknown)} parkings`} sur {formatNumber(agglo.total)}{' '}
                {agglo.unknown === 1 ? 'n’a' : 'n’ont'} pas de nombre de places.
              </p>
              <div className={s.gauge} aria-hidden="true">
                <span style={{ width: `${Math.round((agglo.unknown / Math.max(1, agglo.total)) * 100)}%` }} />
              </div>
              <p className={s.text}>
                Zelo lit les parkings dans OpenStreetMap. Un mapraid d’une après-midi suffit à les compléter : places, PMR,
                payant ou gratuit, hauteur. Chaque ajout apparaît ici le lendemain.
              </p>
              <a className={s.action} href={MAPRAID} target="_blank" rel="noreferrer">
                Voir le plan du mapraid
              </a>
            </>
          )}
          <p className={ui.footnote}>Tarifs relus chaque jour sur les sites de Champagne Parc Auto et d’Effia.</p>
        </Panel>
      </div>

      <p className={ui.footnote}>Données agrégées et anonymisées. Aucun trajet individuel n’est visible.</p>
    </main>
  );
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

const height = (m: number | null) => (m === null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(m)} m`);

function ParkingRow({ p }: { p: Parking }) {
  const cents = hourPrice(p);
  const tarif = cents !== null ? `${formatCents(cents)}/h` : p.fee === false || p.parkRide ? 'Gratuit' : '—';
  return (
    <tr>
      <th scope="row" className={t.name}>
        {parkingName(p.name)}
        {p.parkRide && <span className={t.tag}>P+R</span>}
      </th>
      <td>{p.capacity === null ? '—' : formatNumber(p.capacity)}</td>
      <td>{p.disabled === null ? '—' : formatNumber(p.disabled)}</td>
      <td>{tarif}</td>
      <td>{height(p.maxHeight)}</td>
      <td>{p.operator || '—'}</td>
    </tr>
  );
}

function exportParkings(rows: Parking[]) {
  downloadCsv(`zelo-stationnement-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['parking', 'exploitant', 'latitude', 'longitude', 'places', 'pmr', 'tarif_1h_euros', 'hauteur_max_m', 'p+r'],
    ...rows.map((p) => {
      const cents = hourPrice(p);
      return [p.name, p.operator, p.lat, p.lon, p.capacity ?? '', p.disabled ?? '', cents === null ? '' : cents / 100, p.maxHeight ?? '', p.parkRide ? 'oui' : 'non'];
    }),
  ]);
}
