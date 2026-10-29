import t from '../components/table.module.css';
import { PageHeader, Panel, Tile, ui } from '../components/ui';
import { api, type Closure, GRAND_REIMS, type Report } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { ago, formatNumber, formatPercent, period, updated, within } from '../lib/format';
import { REPORT_LABEL, reportState, type ReportState, reportSummary } from '../lib/stats';
import { useNow, usePoll } from '../lib/use-poll';
import { useStreet } from '../lib/use-street';
import s from './reports.module.css';

const MINUTE = 60_000;
const DIALOG = 'https://dialog.beta.gouv.fr';

const STATE: Record<ReportState, { label: string; cls: string }> = {
  confirme: { label: 'Confirmé', cls: t.pillGood! },
  verifier: { label: 'À vérifier', cls: t.pillWarn! },
  nouveau: { label: 'Nouveau', cls: t.pillMuted! },
};

/** Web 6 · Signalements : ce que signalent les conducteurs, et les fermetures publiées par la collectivité. */
export function ReportsPage() {
  const now = useNow();
  const reports = usePoll(api.reports(GRAND_REIMS), 30_000, 'signalements');
  const closures = usePoll(api.closures(GRAND_REIMS), 10 * MINUTE, 'fermetures');

  const list = reports.data ? [...reports.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const sum = reports.data ? reportSummary(reports.data) : null;
  const confirmed = list.filter((r) => reportState(r) === 'confirme').length;
  const doubtful = list.filter((r) => reportState(r) === 'verifier').length;
  const temporary = (closures.data ?? []).filter((c) => c.to !== null);
  // Sans date de fin : zones piétonnes à heures fixes, ou fermetures permanentes.
  const lasting = (closures.data ?? []).filter((c) => c.to === null).length;
  const closedNow = (closures.data ?? []).filter((c) => c.active).length;

  return (
    <main className={ui.page}>
      <PageHeader
        title="Signalements"
        subtitle={`${sum ? `${formatNumber(sum.count)} actifs · confirmés ou infirmés par les conducteurs` : 'Signalements des conducteurs'} · ${updated(reports.at, now, reports.error)}`}
        onExport={reports.data ? () => exportReports(list) : undefined}
        noPeriod
      />

      <div className={ui.tiles}>
        <Tile
          label="Actifs" source={reports}
          value={sum ? formatNumber(sum.count) : '…'}
          note={sum?.top ? `dont ${formatNumber(sum.top.count)} ${REPORT_LABEL[sum.top.kind].toLowerCase()}` : sum ? 'aucun en ce moment' : ''}
        />
        <Tile
          label="Confirmés" source={reports}
          value={sum ? (list.length ? formatPercent(confirmed / list.length) : '—') : '…'}
          note="par d’autres conducteurs"
          tone="good"
        />
        <Tile label="À vérifier" source={reports} value={sum ? formatNumber(doubtful) : '…'} note="infirmés une fois sur deux ou plus" tone={doubtful ? 'warn' : 'muted'} />
        <Tile
          label="Rues fermées" source={closures}
          value={closures.data ? formatNumber(closedNow) : '…'}
          note={closures.data ? 'en ce moment, d’après DiaLog' : ''}
          tone="muted"
        />
      </div>

      <div className={ui.row}>
        <section className={`${ui.card} ${ui.main} ${t.tableCard}`}>
          <h2 className={`${ui.panelTitle} ${t.tableTitle}`}>Signalements en cours</h2>
          <div className={t.scroll}>
            <table className={t.table}>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Lieu</th>
                  <th scope="col">Avis</th>
                  <th scope="col">Depuis</th>
                  <th scope="col">Reste</th>
                  <th scope="col">État</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 14).map((r) => (
                  <ReportLine key={r.id} report={r} now={now} />
                ))}
              </tbody>
            </table>
            {!list.length && (
              <p className={s.text} style={{ padding: '12px 24px' }}>
                {reports.error ? 'Signalements indisponibles.' : reports.data ? 'Aucun signalement en cours sur le Grand Reims.' : 'Chargement…'}
              </p>
            )}
          </div>
        </section>

        <Panel title="Fermetures de rues" className={ui.side}>
          {closures.data && temporary.length === 0 && <p className={s.text}>Aucune fermeture temporaire publiée.</p>}
          {temporary.slice(0, 5).map((c) => (
            <ClosureLine key={c.id} closure={c} now={now} />
          ))}
          {lasting > 0 && (
            <p className={s.text}>
              Et {formatNumber(lasting)} rue{lasting > 1 ? 's' : ''} fermée{lasting > 1 ? 's' : ''} sans date de fin (zones piétonnes à heures fixes…).
            </p>
          )}
          <a className={s.action} href={DIALOG} target="_blank" rel="noreferrer">
            Publier un arrêté sur DiaLog
          </a>
          <p className={s.text}>
            Les fermetures publiées sur DiaLog, la base nationale des arrêtés de circulation, apparaissent ici le lendemain et
            les itinéraires Zelo les contournent pendant qu’elles s’appliquent.
          </p>
        </Panel>
      </div>

      <p className={ui.footnote}>Signalements anonymes : ni leurs auteurs ni les votants ne sont visibles. Un signalement s’allonge à chaque confirmation et disparaît à son échéance.</p>
    </main>
  );
}

function ReportLine({ report, now }: { report: Report; now: Date }) {
  const street = useStreet(report);
  const state = STATE[reportState(report)];
  return (
    <tr>
      <th scope="row" className={t.name}>
        {REPORT_LABEL[report.kind]}
      </th>
      <td className={s.place} title={street ?? undefined}>{street === undefined ? '…' : (street ?? `${report.lat.toFixed(4)}, ${report.lon.toFixed(4)}`)}</td>
      <td className={s.votes}>
        <b>{formatNumber(report.confirmations)}</b> oui · <b>{formatNumber(report.denials)}</b> non
      </td>
      <td>{ago(new Date(report.createdAt), now)}</td>
      <td>{within(new Date(report.expiresAt), now)}</td>
      <td>
        <span className={`${t.pill} ${state.cls}`}>{state.label}</span>
      </td>
    </tr>
  );
}

function ClosureLine({ closure, now }: { closure: Closure; now: Date }) {
  // « Rue Buirette, de la place Drouet d'Erlon jusqu'à la rue Jeanne d'Arc » : la rue, puis le tronçon.
  const [street, ...rest] = closure.name.split(', ');
  const when = [closure.active ? 'en cours' : null, period(closure.from, closure.to, now), closure.periodic ? 'à heures fixes' : null, rest.join(', ') || null].filter(Boolean).join(' · ');
  return (
    <div className={s.closure}>
      {closure.url ? (
        <a className={s.closureName} href={closure.url} target="_blank" rel="noreferrer">
          {street || 'Fermeture'}
        </a>
      ) : (
        <span className={s.closureName}>{street || 'Fermeture'}</span>
      )}
      <span className={s.closureWhen}>{when}</span>
    </div>
  );
}

function exportReports(reports: Report[]) {
  downloadCsv(`zelo-signalements-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['type', 'latitude', 'longitude', 'cree_le', 'expire_le', 'confirmations', 'infirmations', 'etat'],
    ...reports.map((r) => [REPORT_LABEL[r.kind], r.lat, r.lon, r.createdAt, r.expiresAt, r.confirmations, r.denials, STATE[reportState(r)].label]),
  ]);
}
