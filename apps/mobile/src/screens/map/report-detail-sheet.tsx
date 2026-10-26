import { BottomSheet, Button, Column, Host, Row, Text } from '@expo/ui';
import { useState } from 'react';

import { ApiError, voteReport, type Report } from '@/api/zelo';
import { REPORT_META, texte, useTheme } from '@/theme';
import { formatAgo } from '@/utils/format';

type Props = {
  report: Report | null;
  onDismiss: () => void;
  onVoted: (r: Report, removed: boolean) => void;
};

/** Fiche d'un signalement : les autres conducteurs le confirment ou l'infirment, comme sur Waze. */
export function ReportDetailSheet({ report, onDismiss, onVoted }: Props) {
  const { c, dark } = useTheme();
  // Dernier contenu gardé pendant l'animation de fermeture.
  const [shown, setShown] = useState(report);
  if (report && report !== shown) setShown(report);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const vote = async (up: boolean) => {
    if (!shown || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const { report: r, removed } = await voteReport(shown.id, up);
      onVoted(r, removed);
      onDismiss();
    } catch (e) {
      setMessage(
        e instanceof ApiError && e.status === 409
          ? 'C’est ton signalement : les autres conducteurs le confirmeront.'
          : e instanceof ApiError && e.status === 404
            ? 'Ce signalement n’est plus actif.'
            : e instanceof ApiError
              ? e.message
              : 'Pas de connexion. Réessaie dans un instant.',
      );
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    setMessage(null);
    onDismiss();
  };

  const meta = shown ? REPORT_META[shown.kind] : null;
  const confirmations = shown?.confirmations ?? 0;
  const detail = shown
    ? [
        `Signalé ${formatAgo(shown.createdAt)}`,
        confirmations > 0 ? `confirmé ${confirmations} fois` : null,
        `disparaît ${formatAgo(shown.expiresAt)}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={report !== null} onDismiss={close}>
        <Column spacing={16} style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 28 }}>
          <Column spacing={4}>
            <Row spacing={8}>
              <Row style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: meta?.couleur ?? c.indisponible }} />
              <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>{meta?.label ?? 'Signalement'}</Text>
            </Row>
            <Text textStyle={{ ...texte.secondaire, color: message ? c.alerte.base : c.texte.secondaire }}>
              {message ?? detail}
            </Text>
          </Column>
          <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>Est-ce toujours là ?</Text>
          <Row spacing={12}>
            <Button label="Toujours là" variant="filled" disabled={sending} onPress={() => vote(true)} />
            <Button label="Plus là" variant="outlined" disabled={sending} onPress={() => vote(false)} />
          </Row>
        </Column>
      </BottomSheet>
    </Host>
  );
}
