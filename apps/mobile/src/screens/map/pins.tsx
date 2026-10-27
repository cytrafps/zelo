import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { BBox, ChargeStation, FuelStation, Parking } from '@/api/zelo';
import { rayon, type Couleurs } from '@/theme';
import { FUEL_ORDER } from '@/utils/format';
import { nearest, type LatLon } from '@/utils/geo';

import type { Selection } from './place-sheet';

export type Category = 'carburant' | 'recharge' | 'stationnement';

/** En dessous de ce zoom, les points restent de simples ronds (couches GeoJSON). */
export const PIN_MIN_ZOOM = 14.5;
/** Au-delà, une vue native par repère coûte cher : on n'affiche que les plus proches du centre. */
const MAX_PINS = 50;

export const CATEGORY_ICON: Record<Category, SymbolViewProps['name']> = {
  carburant: { ios: 'fuelpump.fill', android: 'local_gas_station' },
  recharge: { ios: 'ev.charger.fill', android: 'ev_station' },
  stationnement: { ios: 'parkingsign', android: 'local_parking' },
};

type Pin = LatLon & { id: string; label: string; muted: boolean; select: Selection };

const price = (prices: Record<string, number>) => {
  const fuel = FUEL_ORDER.find((f) => f in prices);
  return fuel ? prices[fuel].toFixed(2).replace('.', ',') : '';
};

function toPins(category: Category, data: { fuel: FuelStation[]; charge: ChargeStation[]; parkings: Parking[] }): Pin[] {
  switch (category) {
    case 'carburant':
      return data.fuel.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, label: price(s.prices), muted: false, select: { kind: 'fuel', item: s } }));
    case 'recharge':
      return data.charge.map((s) => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        label: s.available === null ? '' : `${s.available}/${s.total}`,
        muted: s.available === 0,
        select: { kind: 'charge', item: s },
      }));
    case 'stationnement':
      // Icône seule, comme dans les maquettes : le tarif et la gratuité sont dans la fiche.
      return data.parkings.map((p) => ({
        id: p.id,
        lat: p.lat,
        lon: p.lon,
        label: '',
        muted: false,
        select: { kind: 'parking', item: p },
      }));
  }
}

type Props = {
  category: Category;
  data: { fuel: FuelStation[]; charge: ChargeStation[]; parkings: Parking[] };
  view: BBox;
  c: Couleurs;
  onSelect: (s: Selection) => void;
};

/** Pastilles des maquettes (icône de catégorie + valeur), pour les repères les plus proches du centre. */
export const Pins = memo(function Pins({ category, data, view, c, onSelect }: Props) {
  const [w, s, e, n] = view;
  const center = { lat: (s + n) / 2, lon: (w + e) / 2 };
  const visible = toPins(category, data).filter((p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n);
  const tone = { carburant: c.carburant, recharge: c.recharge, stationnement: c.stationnement }[category];

  return nearest(visible, center, MAX_PINS).map(({ item: p }) => (
    <ViewAnnotation key={p.id} id={`pin-${p.id}`} lngLat={[p.lon, p.lat]} onPress={() => onSelect(p.select)}>
      <View style={[styles.pill, { backgroundColor: c.fond.surface }, !p.label && styles.pillIcon]}>
        <View style={[styles.tile, { backgroundColor: p.muted ? c.indisponible : tone.base }]}>
          {category === 'stationnement' ? (
            <Text style={styles.letter}>P</Text>
          ) : (
            <SymbolView name={CATEGORY_ICON[category]} tintColor="#FFFFFF" size={15} />
          )}
        </View>
        {p.label ? (
          <Text style={[styles.label, { color: p.muted ? c.texte.secondaire : c.texte.principal }]}>{p.label}</Text>
        ) : null}
      </View>
    </ViewAnnotation>
  ));
});

const styles = StyleSheet.create({
  pill: {
    height: 32,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: rayon.pilule,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pillIcon: { paddingRight: 4 },
  tile: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  letter: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  label: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
