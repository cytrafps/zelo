import { BottomSheet, Column, Host, List, ListItem, Row, Text } from '@expo/ui';
import { useState } from 'react';

import { ApiError, postReport, REPORT_KINDS, type Report, type ReportKind } from '@/api/zelo';
import { REPORT_META, texte, useTheme } from '@/theme';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  /** Position du signalement : celle de l'utilisateur, sinon le centre de la carte. */
  position: { lat: number; lon: number; source: 'gps' | 'carte' };
  onCreated: (r: Report) => void;
};

export function ReportSheet({ isPresented, onDismiss, position, onCreated }: Props) {
  const { c, dark } = useTheme();
  const [sending, setSending] = useState<ReportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (kind: ReportKind) => {
    if (sending) return;
    setSending(kind);
    setError(null);
    try {
      onCreated(await postReport(kind, position.lat, position.lon));
      onDismiss();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Pas de connexion. Réessaie dans un instant.');
    } finally {
      setSending(null);
    }
  };

  const close = () => {
    setError(null);
    onDismiss();
  };

  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={isPresented} onDismiss={close} snapPoints={['half', 'full']}>
        <Column spacing={4} style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
          <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>Signaler</Text>
          <Text textStyle={{ ...texte.secondaire, color: error ? c.alerte.base : c.texte.secondaire }}>
            {error ??
              (position.source === 'gps'
                ? 'À ta position actuelle'
                : 'Au centre de la carte (position non disponible)')}
          </Text>
        </Column>
        <List>
          {REPORT_KINDS.map((kind) => (
            <ListItem
              key={kind}
              onPress={() => send(kind)}
              leading={<Dot color={REPORT_META[kind].couleur} />}
              trailing={sending === kind ? <Text textStyle={{ color: c.texte.tertiaire }}>Envoi…</Text> : undefined}
            >
              <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>{REPORT_META[kind].label}</Text>
            </ListItem>
          ))}
        </List>
      </BottomSheet>
    </Host>
  );
}

function Dot({ color }: { color: string }) {
  return <Row style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />;
}
