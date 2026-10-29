import { useEffect, useMemo, useState } from 'react';

import { Icon, type IconName } from '../components/icon';
import { PageHeader, Panel, Tile, ui } from '../components/ui';
import { api, CENTRE, GRAND_REIMS, type ChargeStation, type Parking, type Report, type ReportKind, streetAt } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { ago, formatCents, formatLitre, formatNumber, formatPercent, parkingName, today, updated } from '../lib/format';
import { useNow, usePoll } from '../lib/use-poll';
import { chargeSummary, cheapest, hourPrice, operatedParkings, recentReports, REPORT_LABEL, reportSummary } from '../lib/stats';
import { CityMap, type Pin } from '../map/city-map';
import s from './overview.module.css';

const MINUTE = 60_000;

const REPORT_STYLE: Record<ReportKind, { icon: IconName; color: string }> = {
  accident: { icon: 'warning', color: '#d7263d' },
  travaux: { icon: 'construction', color: '#e8a100' },
  borne_hs: { icon: 'recharge', color: '#6e6a63' },
  obstacle: { icon: 'warning', color: '#8e5a2b' },
  bouchon: { icon: 'warning', color: '#d9480f' },
  route_fermee: { icon: 'warning', color: '#7a1e12' },
  place_liberee: { icon: 'parking', color: '#1d5fd1' },
};

export function Overview() {
  const now = useNow();
  const charge = usePoll(api.chargeStations(GRAND_REIMS), MINUTE, 'bornes');
  const reports = usePoll(api.reports(GRAND_REIMS), 30_000, 'signalements');
  const fuel = usePoll(api.fuelStations(GRAND_REIMS), 10 * MINUTE, 'carburant');
  const parkings = usePoll(api.parkings(CENTRE), 60 * MINUTE, 'parkings');

  const bornes = charge.data ? chargeSummary(charge.data) : null;
  const signalements = reports.data ? reportSummary(reports.data) : null;
  const gazole = fuel.data ? cheapest(fuel.data, 'Gazole', now) : null;
  const exploited = useMemo(() => (parkings.data ? operatedParkings(parkings.data, 5) : []), [parkings.data]);
  const pins = useMemo<Pin[]>(
    () =>
      exploited.map((p) => {
        const cents = hourPrice(p);
        return {
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          label: cents === null ? `${formatNumber(p.capacity ?? 0)} pl.` : `${formatCents(cents)} / h`,
          title: p.name,
        };
      }),
    [exploited],
  );
  const freshest = [charge.at, reports.at].filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return (
    <main className={ui.page}>
      <PageHeader
        title="Vue d’ensemble"
        subtitle={`${today(now)} · ${updated(freshest, now)}`}
        onExport={charge.data && parkings.data ? () => exportOverview(charge.data!, parkings.data!) : undefined}
      />

      <div className={ui.tiles}>
        <Tile label="Occupation des parkings" value="—" note="Comptages pas encore publiés" tone="muted" />
        <Tile
          label="Bornes libres"
          value={bornes ? `${formatNumber(bornes.free)} / ${formatNumber(bornes.known)}` : '…'}
          note={bornes?.ratio != null ? `${formatPercent(bornes.ratio)} disponibles` : 'État des points en cours de chargement'}
          tone={bornes?.ratio != null ? 'good' : 'muted'}
        />
        <Tile
          label="Signalements actifs"
          value={signalements ? formatNumber(signalements.count) : '…'}
          note={
            signalements?.top
              ? `dont ${formatNumber(signalements.top.count)} ${REPORT_LABEL[signalements.top.kind].toLowerCase()}`
              : signalements
                ? 'Aucun en ce moment'
                : ''
          }
        />
        <Tile
          label="Gazole le moins cher"
          value={gazole ? formatLitre(gazole.price) : fuel.data ? '—' : '…'}
          note={gazole ? `${gazole.station.city} · ${gazole.station.address}` : ''}
        />
      </div>

      <div className={ui.row}>
        <section className={`${ui.card} ${ui.main} ${s.mapCard}`}>
          <div className={s.mapHead}>
            <h2 className={ui.panelTitle} style={{ flex: 1 }}>
              Stationnement au centre
            </h2>
            <span className={s.legend}>Tarif d’une heure, relevé aujourd’hui</span>
          </div>
          <CityMap pins={pins} label="Carte des parkings du centre de Reims" />
        </section>

        <Panel title="Parkings exploités" className={ui.side}>
          {exploited.length === 0 && <p className={s.empty}>{parkings.error ? 'Parkings indisponibles.' : 'Chargement…'}</p>}
          {exploited.map((p) => (
            <ParkingRow key={p.id} parking={p} largest={exploited[0]?.capacity ?? 1} />
          ))}
        </Panel>
      </div>

      <div className={ui.row}>
        <Panel title="Occupation des parkings du centre" className={ui.main}>
          <div className={s.awaiting} aria-hidden="false">
            {AWAITING.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
            <div className={s.awaitingText}>
              <p className={s.awaitingTitle}>Pas encore de comptage en temps réel à Reims</p>
              <p className={s.awaitingSub}>
                Champagne Parc Auto compte déjà les entrées et les sorties de ses parkings. Dès qu’une convention les rend
                disponibles, la courbe de la journée et le pic prévu s’affichent ici.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Signalements récents" className={ui.side}>
          {reports.data?.length === 0 && <p className={s.empty}>Aucun signalement en cours.</p>}
          {reports.data && recentReports(reports.data, 4).map((r) => <ReportRow key={r.id} report={r} now={now} />)}
          {!reports.data && <p className={s.empty}>{reports.error ? 'Signalements indisponibles.' : 'Chargement…'}</p>}
        </Panel>
      </div>

      <p className={ui.footnote}>
        Données agrégées et anonymisées. Aucun trajet individuel n’est visible. Sources : fichier national IRVE, prix des
        carburants (data.gouv.fr), OpenStreetMap, signalements des conducteurs Zelo.
      </p>
    </main>
  );
}

/** Silhouette d'une journée de parking (6 h – 23 h), seulement en fond du message d'attente. */
const AWAITING = [24, 32, 50, 74, 88, 82, 78, 84, 90, 88, 80, 74, 76, 84, 92, 98, 66, 42];

function ParkingRow({ parking, largest }: { parking: Parking; largest: number }) {
  const cents = hourPrice(parking);
  return (
    <div className={s.parking}>
      <div className={s.parkingLine}>
        <span className={s.parkingName} title={parking.name}>
          {parkingName(parking.name)}
        </span>
        {parking.capacity !== null && <span className={s.parkingInfo}>{formatNumber(parking.capacity)} places</span>}
        <span className={s.parkingValue}>{cents === null ? '—' : `${formatCents(cents)} / h`}</span>
      </div>
      {/* Jauge de capacité, relative au plus grand : l'occupation n'est pas encore publiée. */}
      <div className={s.gauge} aria-hidden="true">
        <span style={{ width: `${Math.round(((parking.capacity ?? 0) / largest) * 100)}%` }} />
      </div>
    </div>
  );
}

function ReportRow({ report, now }: { report: Report; now: Date }) {
  const street = useStreet(report);
  const style = REPORT_STYLE[report.kind];
  const where = [street, report.confirmations > 0 ? `${formatNumber(report.confirmations)} confirmation${report.confirmations > 1 ? 's' : ''}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={s.report}>
      <span className={s.reportTile} style={{ background: style.color }}>
        <Icon name={style.icon} size={17} />
      </span>
      <span className={s.reportText}>
        <span className={s.reportKind}>{REPORT_LABEL[report.kind]}</span>
        <span className={s.reportWhere}>{where || 'Position du signalement'}</span>
      </span>
      <span className={s.reportAge}>{ago(new Date(report.createdAt), now)}</span>
    </div>
  );
}

// Rue de chaque signalement, demandée une fois (les signalements ne bougent pas).
const streets = new Map<number, Promise<string | null>>();

function useStreet(r: Report) {
  const [street, setStreet] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let p = streets.get(r.id);
    if (!p) {
      p = streetAt(r.lat, r.lon).catch(() => null);
      streets.set(r.id, p);
    }
    void p.then((v) => live && setStreet(v));
    return () => {
      live = false;
    };
  }, [r.id, r.lat, r.lon]);
  return street;
}

function exportOverview(stations: ChargeStation[], parkings: Parking[]) {
  downloadCsv(`zelo-grand-reims-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['type', 'nom', 'latitude', 'longitude', 'capacite', 'libres', 'tarif_1h_euros'],
    ...stations.map((st) => ['borne', st.name, st.lat, st.lon, st.total, st.available ?? '', '']),
    ...parkings.map((p) => {
      const cents = hourPrice(p);
      return ['parking', p.name, p.lat, p.lon, p.capacity ?? '', '', cents === null ? '' : (cents / 100).toFixed(2)];
    }),
  ]);
}
