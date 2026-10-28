import { BottomSheet, Button, Column, Host, List, ListItem, Text } from '@expo/ui';
import { useState } from 'react';

import type { ChargeStation, FuelStation, Parking } from '@/api/zelo';
import { texte, useTheme, type Couleurs } from '@/theme';
import { formatAgo, formatCents, formatPrice, formatStay, FUEL_ORDER, SOCKET_LABEL } from '@/utils/format';

export type Selection =
  | { kind: 'fuel'; item: FuelStation }
  | { kind: 'charge'; item: ChargeStation }
  | { kind: 'parking'; item: Parking };

type Props = { selection: Selection | null; onDismiss: () => void; onGo: (s: Selection) => void };

export function PlaceSheet({ selection, onDismiss, onGo }: Props) {
  const { c, dark } = useTheme();
  // On garde le dernier contenu affiché pendant l'animation de fermeture.
  const [shown, setShown] = useState(selection);
  if (selection && selection !== shown) setShown(selection);
  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={selection !== null} onDismiss={onDismiss} snapPoints={['half', 'full']}>
        {shown?.kind === 'fuel' && <FuelDetails s={shown.item} c={c} onGo={() => onGo(shown)} />}
        {shown?.kind === 'charge' && <ChargeDetails s={shown.item} c={c} onGo={() => onGo(shown)} />}
        {shown?.kind === 'parking' && <ParkingDetails p={shown.item} c={c} onGo={() => onGo(shown)} />}
      </BottomSheet>
    </Host>
  );
}

function Header({ title, subtitle, c, onGo }: { title: string; subtitle: string; c: Couleurs; onGo: () => void }) {
  return (
    <Column spacing={12} style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
      <Column spacing={4}>
        <Text numberOfLines={2} textStyle={{ ...texte.titre, color: c.texte.principal }}>
          {title}
        </Text>
        <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>{subtitle}</Text>
      </Column>
      <Button label="Y aller" onPress={onGo} />
    </Column>
  );
}

function FuelDetails({ s, c, onGo }: { s: FuelStation; c: Couleurs; onGo: () => void }) {
  const fuels = Object.keys(s.prices).sort((a, b) => rank(a) - rank(b));
  return (
    <>
      <Header title={s.address || 'Station-service'} subtitle={`${s.city} · prix mis à jour ${formatAgo(s.updatedAt)}`} c={c} onGo={onGo} />
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

function ChargeDetails({ s, c, onGo }: { s: ChargeStation; c: Couleurs; onGo: () => void }) {
  const availability =
    s.available === null
      ? 'Disponibilité non publiée'
      : `${s.available} sur ${s.total} point${s.total > 1 ? 's' : ''} libre${s.available > 1 ? 's' : ''}`;
  const color = s.available === null ? c.texte.secondaire : s.available > 0 ? c.recharge.texte : c.alerte.base;
  return (
    <>
      <Header title={s.name || 'Borne de recharge'} subtitle={s.operator || 'Opérateur inconnu'} c={c} onGo={onGo} />
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

const PARKING_KIND = {
  surface: 'Parking en surface',
  'multi-storey': 'Parking à étages',
  underground: 'Parking souterrain',
  street: 'Stationnement le long de la voie',
} as const;

const meters = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ParkingDetails({ p, c, onGo }: { p: Parking; c: Couleurs; onGo: () => void }) {
  const rows: [label: string, value: string][] = [
    ['Places', p.capacity === null ? 'Non renseigné' : String(p.capacity)],
  ];
  if (p.tariff) {
    if (p.tariff.free > 0) rows.push([formatStay(p.tariff.free), 'Offertes']);
    for (const { minutes, cents } of p.tariff.prices) rows.push([formatStay(minutes), formatCents(cents)]);
  } else rows.push(['Tarif', p.fee === null ? 'Non renseigné' : p.fee ? 'Payant' : 'Gratuit']);
  if (p.maxHeight !== null) rows.push(['Hauteur max.', `${meters.format(p.maxHeight)} m`]);
  if (p.disabled !== null) rows.push(['Places PMR', String(p.disabled)]);
  if (p.charging !== null) rows.push(['Places avec recharge', String(p.charging)]);
  if (p.openingHours) rows.push(['Horaires', p.openingHours === '24/7' ? '24 h/24, 7 j/7' : p.openingHours]);

  const subtitle = [p.operator || null, p.parkRide ? 'Parc relais' : null, p.name ? PARKING_KIND[p.kind] : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Header title={p.name || PARKING_KIND[p.kind]} subtitle={subtitle || 'Parking public'} c={c} onGo={onGo} />
      <List>
        {rows.map(([label, value]) => (
          <ListItem key={label} trailing={<Text textStyle={{ ...texte.corps, color: c.texte.secondaire }}>{value}</Text>}>
            <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>{label}</Text>
          </ListItem>
        ))}
      </List>
      <Column style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
        <Text textStyle={{ ...texte.petit, color: c.texte.tertiaire }}>
          {p.tariff
            ? `Tarifs relevés le ${checkedDate(p.tariff.checked)} sur le site de l'exploitant ; seuls ceux affichés sur place font foi. Données © contributeurs OpenStreetMap`
            : 'Données © contributeurs OpenStreetMap'}
        </Text>
      </Column>
    </>
  );
}

const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const checkedDate = (iso: string) => day.format(new Date(`${iso}T12:00:00`));

const rank = (fuel: string) => {
  const i = FUEL_ORDER.indexOf(fuel);
  return i === -1 ? FUEL_ORDER.length : i;
};
