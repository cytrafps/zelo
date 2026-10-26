import { GeoJSONSource, Layer, type GeoJSONSourceProps } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';

import type { ChargeStation, FuelStation, Parking, Report } from '@/api/zelo';
import { REPORT_META, type Couleurs } from '@/theme';
import { FUEL_ORDER } from '@/utils/format';

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

export function FuelLayer({ stations, c, onPress }: { stations: FuelStation[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () => collection(stations.map((s) => point(s.lon, s.lat, { id: s.id, label: headlinePrice(s.prices) }))),
    [stations],
  );
  return (
    <GeoJSONSource id="fuel" data={data} onPress={onPress}>
      <Layer
        id="fuel-dot"
        type="circle"
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
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.carburant.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
    </GeoJSONSource>
  );
}

export function ChargeLayer({ stations, c, onPress }: { stations: ChargeStation[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        stations.map((s) =>
          point(s.lon, s.lat, {
            id: s.id,
            state: s.available === null ? 'unknown' : s.available > 0 ? 'free' : 'busy',
            label: s.available === null ? '' : `${s.available}/${s.total}`,
          }),
        ),
      ),
    [stations],
  );
  return (
    <GeoJSONSource id="charge" data={data} onPress={onPress}>
      <Layer
        id="charge-dot"
        type="circle"
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
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.recharge.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
    </GeoJSONSource>
  );
}

export function ParkingLayer({ parkings, c, onPress }: { parkings: Parking[]; c: Couleurs; onPress: Press }) {
  const data = useMemo(
    () =>
      collection(
        parkings.map((p) => point(p.lon, p.lat, { id: p.id, label: p.capacity === null ? '' : `${p.capacity} pl.` })),
      ),
    [parkings],
  );
  return (
    <GeoJSONSource id="parkings" data={data} onPress={onPress}>
      <Layer
        id="parking-dot"
        type="circle"
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
        layout={{ 'text-field': 'P', 'text-font': font, 'text-size': 11, 'text-allow-overlap': true }}
        paint={{ 'text-color': '#FFFFFF' }}
      />
      <Layer
        id="parking-capacity"
        type="symbol"
        minzoom={14.5}
        layout={{ 'text-field': ['get', 'label'], 'text-font': font, 'text-size': 12, 'text-offset': [0, 1.4], 'text-anchor': 'top' }}
        paint={{ 'text-color': c.stationnement.texte, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
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
