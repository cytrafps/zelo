import { PageHeader, Panel, ui } from '../components/ui';
import { today } from '../lib/format';

/** Écrans de la maquette pas encore codés (Web 2 à 6). */
export function Soon({ title }: { title: string }) {
  return (
    <main className={ui.page}>
      <PageHeader title={title} subtitle={today(new Date())} />
      <Panel title="Bientôt">
        <p style={{ color: 'var(--texte-2)', fontSize: 14 }}>Cet écran arrive dans les prochaines versions du tableau de bord.</p>
      </Panel>
    </main>
  );
}
