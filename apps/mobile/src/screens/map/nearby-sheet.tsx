import { BottomSheet, Column, FieldGroup, Host, ListItem, Row, Text } from '@expo/ui';
import { useMemo, useState } from 'react';

import type { Place } from '@/api/geocode';
import type { ChargeStation, FuelStation, Parking } from '@/api/zelo';
import { texte, useTheme, type Couleurs } from '@/theme';
import { formatDistance, nearest, walkingMinutes } from '@/utils/geo';
import { FUEL_ORDER, formatPrice } from '@/utils/format';

import type { Selection } from './place-sheet';

/** Au-delà, on ne propose plus : personne ne fait 20 minutes à pied depuis son parking. */
const RADIUS_M = 1500;
const PER_SECTION = 3;

type Props = {
  destination: Place | null;
  isPresented: boolean;
  onDismiss: () => void;
  parkings: Parking[];
  charge: ChargeStation[];
  fuel: FuelStation[];
  loading: boolean;
  onPick: (s: Selection) => void;
};

type NearbyItem = { key: string; title: string; detail: string; meters: number; color: string; pick: Selection };

export function NearbySheet({ destination, isPresented, onDismiss, parkings, charge, fuel, loading, onPick }: Props) {
  const { c, dark } = useTheme();
  // Garde le contenu pendant l'animation de fermeture.
  const [shown, setShown] = useState(destination);
  if (destination && destination !== shown) setShown(destination);

  const sections = useMemo(() => {
    if (!shown) return [];
    const around = <T extends { lat: number; lon: number }>(items: T[]) =>
      nearest(items, shown, PER_SECTION).filter((x) => x.meters <= RADIUS_M);
    return [
      {
        title: 'Parkings',
        empty: 'Aucun parking public connu à moins de 1,5 km',
        rows: around(parkings).map(({ item: p, meters }): NearbyItem => ({
          key: p.id,
          title: p.name || 'Parking',
          detail: [p.capacity !== null ? `${p.capacity} places` : null, p.fee === false ? 'gratuit' : p.fee ? 'payant' : null]
            .filter(Boolean)
            .join(' · '),
          meters,
          color: c.stationnement.base,
          pick: { kind: 'parking', item: p },
        })),
      },
      {
        title: 'Bornes de recharge',
        empty: 'Aucune borne à moins de 1,5 km',
        rows: around(charge).map(({ item: s, meters }): NearbyItem => ({
          key: s.id,
          title: s.name || s.operator || 'Borne de recharge',
          detail:
            s.available === null
              ? `${Math.round(s.maxPowerKw)} kW · disponibilité inconnue`
              : `${s.available} sur ${s.total} libre${s.available > 1 ? 's' : ''} · ${Math.round(s.maxPowerKw)} kW`,
          meters,
          color: s.available === 0 ? c.alerte.base : s.available === null ? c.indisponible : c.recharge.base,
          pick: { kind: 'charge', item: s },
        })),
      },
      {
        title: 'Stations-service',
        empty: 'Aucune station à moins de 1,5 km',
        rows: around(fuel).map(({ item: s, meters }): NearbyItem => {
          const f = FUEL_ORDER.find((x) => x in s.prices);
          return {
            key: s.id,
            title: s.address || 'Station-service',
            detail: f ? `${f} ${formatPrice(s.prices[f])}` : 'Prix non publiés',
            meters,
            color: c.carburant.base,
            pick: { kind: 'fuel', item: s },
          };
        }),
      },
    ];
  }, [shown, parkings, charge, fuel, c]);

  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss} snapPoints={['half', 'full']}>
        {shown && (
          <>
            <Column spacing={4} style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
              <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>Autour de ta destination</Text>
              <Text numberOfLines={1} textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
                {shown.label}
              </Text>
            </Column>
            <FieldGroup>
              {sections.map((s) => (
                <FieldGroup.Section key={s.title} title={s.title}>
                  {s.rows.length === 0 ? (
                    <ListItem>
                      <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
                        {loading ? 'Chargement…' : s.empty}
                      </Text>
                    </ListItem>
                  ) : (
                    s.rows.map((r) => <NearbyRow key={r.key} r={r} c={c} onPress={() => onPick(r.pick)} />)
                  )}
                </FieldGroup.Section>
              ))}
            </FieldGroup>
          </>
        )}
      </BottomSheet>
    </Host>
  );
}

function NearbyRow({ r, c, onPress }: { r: NearbyItem; c: Couleurs; onPress: () => void }) {
  return (
    <ListItem
      onPress={onPress}
      leading={<Row style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: r.color }} />}
      supportingText={r.detail || undefined}
      trailing={
        <Column alignment="end">
          <Text textStyle={{ ...texte.corpsFort, color: c.texte.principal, textAlign: 'right' }}>{formatDistance(r.meters)}</Text>
          <Text textStyle={{ ...texte.petit, color: c.texte.tertiaire, textAlign: 'right' }}>
            {`${walkingMinutes(r.meters)} min à pied`}
          </Text>
        </Column>
      }
    >
      <Text numberOfLines={1} textStyle={{ ...texte.corps, color: c.texte.principal }}>
        {r.title}
      </Text>
    </ListItem>
  );
}
