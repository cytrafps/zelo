import { GeoJSONSource, Layer, type GeoJSONSourceProps } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';

import type { ChargeStation, FuelStation, Parking, Report } from '@/api/zelo';
import { REPORT_META, type Couleurs } from '@/theme';
import { FUEL_ORDER } from '@/utils/format';

import { chargePin, fuelPin, PIN_MIN_ZOOM, TEXT_OFFSET } from './pins';

type Press = NonNullable<GeoJSONSourceProps['onPress']>;

const point = (lon: number, lat: number, properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

/** Prix affiché sous le point : le carburant le plus courant que la station vend. */
function headlinePrice(prices: Record<string, number>) {
  const fuel = FUEL_ORDER.find((f) => f in prices);
  return fuel ? `${fuel} ${prices[fuel].toFixed(3).replace('.', ',')}` : '';
}

const radius = ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8] as const;
const font = ['Noto Sans Bold'];

/** Prix de la pastille : 2 décimales suffisent à comparer d'un coup d'œil. */
function pinPrice(prices: Record<string, number>) {
  const fuel = FUEL_ORDER.find((f) => f in prices);
  return fuel ? prices[fuel].toFixed(2).replace('.', ',') : '';
}

/**
 * Pastille des maquettes au zoom de rue : image + valeur, dessinée par la carte (pas par React).
 * Toujours affichée, même sur un nom de rue, comme les vues qu'elle remplace ; quand deux
 * pastilles se chevauchent, `sort` met la plus intéressante au-dessus (la plus grande valeur).
 */
function PinLayer({ id, c }: { id: string; c: Couleurs }) {
  return (
    <Layer
      id={`${id}-pin`}
      type="symbol"
      minzoom={PIN_MIN_ZOOM}
      layout={{
        'icon-image': ['get', 'pin'] as never,
        'icon-allow-overlap': true,
        'text-allow-overlap': true,
        'symbol-sort-key': ['get', 'sort'] as never,
        'text-field': ['get', 'pinLabel'] as never,
        'text-font': font,
        'text-size': 15,
        'text-anchor': 'left',
        'text-offset': TEXT_OFFSET as never,
      }}
      paint={{ 'text-color': ['case', ['get', 'muted'], c.texte.secondaire, c.texte.principal] as never }}
    />
  );
}

export function FuelLayer({ stations, c, onPress }: { stations: FuelStation[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        stations.map((s) => {
          const pinLabel = pinPrice(s.prices);
          return point(s.lon, s.lat, {
            id: s.id,
            label: headlinePrice(s.prices),
            pin: fuelPin(pinLabel),
            pinLabel,
            muted: false,
            // La moins chère au-dessus quand les pastilles se chevauchent.
            sort: pinLabel ? -Number(pinLabel.replace(',', '.')) : -99,
          });
        }),
      ),
    [stations],
  );
  return (
    <GeoJSONSource id="fuel" data={data} onPress={onPress}>
      <Layer
        id="fuel-dot"
        type="circle"
        maxzoom={PIN_MIN_ZOOM}
        paint={{
          'circle-radius': radius as never,
          'circle-color': c.carburant.base,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        }}
      />
      <Layer
        id="fuel-price"
        type="symbol"
        minzoom={13.5}
        maxzoom={PIN_MIN_ZOOM}
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.carburant.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
      <PinLayer id="fuel" c={c} />
    </GeoJSONSource>
  );
}

export function ChargeLayer({ stations, c, onPress }: { stations: ChargeStation[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        stations.map((s) => {
          const label = s.available === null ? '' : `${s.available}/${s.total}`;
          return point(s.lon, s.lat, {
            id: s.id,
            // Réservée aux clients : grisée comme une borne sans état, le public ne peut pas s'y fier.
            state: s.reserved || s.available === null ? 'unknown' : s.available > 0 ? 'free' : 'busy',
            label,
            pin: chargePin(label, !s.reserved && (s.available ?? 0) > 0),
            pinLabel: label,
            muted: s.reserved || s.available === 0,
            // Au-dessus : la plus libre, puis sans état publié, les pleines en dessous.
            sort: s.available === null ? 0 : s.available > 0 ? s.available : -100,
          });
        }),
      ),
    [stations],
  );
  return (
    <GeoJSONSource id="charge" data={data} onPress={onPress}>
      <Layer
        id="charge-dot"
        type="circle"
        maxzoom={PIN_MIN_ZOOM}
        paint={{
          'circle-radius': radius as never,
          'circle-color': ['match', ['get', 'state'], 'free', c.recharge.base, 'busy', c.alerte.base, c.indisponible],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        }}
      />
      <Layer
        id="charge-count"
        type="symbol"
        minzoom={13.5}
        maxzoom={PIN_MIN_ZOOM}
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.recharge.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
      <PinLayer id="charge" c={c} />
    </GeoJSONSource>
  );
}

export function ParkingLayer({ parkings, c, onPress }: { parkings: Parking[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        parkings.map((p) =>
          point(p.lon, p.lat, {
            id: p.id,
            label: p.capacity === null ? '' : `${p.capacity} pl.`,
            pin: 'pin-parking',
            pinLabel: '',
            muted: false,
            // Le plus grand parking au-dessus quand les pastilles se chevauchent.
            sort: p.capacity ?? 0,
          }),
        ),
      ),
    [parkings],
  );
  return (
    <GeoJSONSource id="parkings" data={data} onPress={onPress}>
      <Layer
        id="parking-dot"
        type="circle"
        maxzoom={PIN_MIN_ZOOM}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 15, 10] as never,
          'circle-color': c.stationnement.base,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        }}
      />
      <Layer
        id="parking-letter"
        type="symbol"
        minzoom={12.5}
        maxzoom={PIN_MIN_ZOOM}
        layout={{ 'text-field': 'P', 'text-font': font, 'text-size': 11, 'text-allow-overlap': true }}
        paint={{ 'text-color': '#FFFFFF' }}
      />
      <Layer
        id="parking-capacity"
        type="symbol"
        minzoom={PIN_MIN_ZOOM}
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.7], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.stationnement.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
      <PinLayer id="parking" c={c} />
    </GeoJSONSource>
  );
}

export function ReportLayer({ reports, onPress }: { reports: Report[]; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        reports.map((r) =>
          point(r.lon, r.lat, {
            id: r.id,
            color: REPORT_META[r.kind]?.couleur ?? '#5F5B54',
            // Plus un signalement est confirmé, plus son halo est large (plafonné).
            halo: 16 + 2 * Math.min(r.confirmations, 5),
          }),
        ),
      ),
    [reports],
  );
  return (
    <GeoJSONSource id="reports" data={data} onPress={onPress}>
      <Layer
        id="report-halo"
        type="circle"
        paint={{ 'circle-radius': ['get', 'halo'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 }}
      />
      <Layer
        id="report-dot"
        type="circle"
        paint={{ 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 }}
      />
    </GeoJSONSource>
  );
}
