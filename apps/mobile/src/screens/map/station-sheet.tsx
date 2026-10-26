import { BottomSheet, Column, Host, List, ListItem, Text } from '@expo/ui';
import { useState } from 'react';

import type { ChargeStation, FuelStation } from '@/api/zelo';
import { texte, useTheme, type Couleurs } from '@/theme';
import { formatAgo, formatPrice, FUEL_ORDER, SOCKET_LABEL } from '@/utils/format';

export type Selection = { kind: 'fuel'; station: FuelStation } | { kind: 'charge'; station: ChargeStation };

type Props = { selection: Selection | null; onDismiss: () => void };

export function StationSheet({ selection, onDismiss }: Props) {
  const { c, dark } = useTheme();
  // On garde le dernier contenu affiché pendant l'animation de fermeture.
  const [shown, setShown] = useState(selection);
  if (selection && selection !== shown) setShown(selection);
  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={selection !== null} onDismiss={onDismiss} snapPoints={['half', 'full']}>
        {shown?.kind === 'fuel' && <FuelDetails s={shown.station} c={c} />}
        {shown?.kind === 'charge' && <ChargeDetails s={shown.station} c={c} />}
      </BottomSheet>
    </Host>
  );
}

function Header({ title, subtitle, c }: { title: string; subtitle: string; c: Couleurs }) {
  return (
    <Column spacing={4} style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
      <Text numberOfLines={2} textStyle={{ ...texte.titre, color: c.texte.principal }}>
        {title}
      </Text>
      <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>{subtitle}</Text>
    </Column>
  );
}

function FuelDetails({ s, c }: { s: FuelStation; c: Couleurs }) {
  const fuels = Object.keys(s.prices).sort((a, b) => rank(a) - rank(b));
  return (
    <>
      <Header title={s.address || 'Station-service'} subtitle={`${s.city} · prix mis à jour ${formatAgo(s.updatedAt)}`} c={c} />
      <List>
        {fuels.length === 0 ? (
          <ListItem>
            <Text textStyle={{ ...texte.corps, color: c.texte.secondaire }}>Aucun prix publié</Text>
          </ListItem>
        ) : (
          fuels.map((fuel) => (
            <ListItem
              key={fuel}
              trailing={
                <Text textStyle={{ ...texte.corpsFort, color: c.carburant.texte }}>{formatPrice(s.prices[fuel])}</Text>
              }
            >
              <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>{fuel}</Text>
            </ListItem>
          ))
        )}
      </List>
    </>
  );
}

function ChargeDetails({ s, c }: { s: ChargeStation; c: Couleurs }) {
  const availability =
    s.available === null
      ? 'Disponibilité non publiée'
      : `${s.available} sur ${s.total} point${s.total > 1 ? 's' : ''} libre${s.available > 1 ? 's' : ''}`;
  const color = s.available === null ? c.texte.secondaire : s.available > 0 ? c.recharge.texte : c.alerte.base;
  return (
    <>
      <Header title={s.name || 'Borne de recharge'} subtitle={s.operator || 'Opérateur inconnu'} c={c} />
      <List>
        <ListItem
          supportingText={s.observedAt ? `État relevé ${formatAgo(s.observedAt)}` : undefined}
          trailing={<Text textStyle={{ ...texte.corpsFort, color }}>{availability}</Text>}
        >
          <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>Disponibilité</Text>
        </ListItem>
        <ListItem trailing={<Text textStyle={{ ...texte.corps, color: c.texte.secondaire }}>{`${Math.round(s.maxPowerKw)} kW`}</Text>}>
          <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>Puissance max.</Text>
        </ListItem>
        <ListItem
          trailing={
            <Text textStyle={{ ...texte.corps, color: c.texte.secondaire }}>
              {s.sockets.map((k) => SOCKET_LABEL[k] ?? k).join(', ') || '—'}
            </Text>
          }
        >
          <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>Prises</Text>
        </ListItem>
      </List>
    </>
  );
}

const rank = (fuel: string) => {
  const i = FUEL_ORDER.indexOf(fuel);
  return i === -1 ? FUEL_ORDER.length : i;
};
