import { GeoJSONSource, Layer, ViewAnnotation } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { police, type Couleurs } from '@/theme';
import { cumulative, formatDuration, pointAt, type Route } from '@/utils/route';

const line = (coords: [number, number][], props: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: props,
});

type Props = {
  routes: Route[];
  selected: number;
  walk: Route | null;
  c: Couleurs;
  /** En aperçu : durée posée sur chaque itinéraire, touchable pour le choisir. */
  badges?: boolean;
  onSelect?: (i: number) => void;
};

/** Itinéraires des maquettes 03/04 : le choisi en bleu par-dessus les alternatives, la marche en pointillés. */
export function RouteLayer({ routes, selected, walk, c, badges, onSelect }: Props) {
  const drive = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      // Le choisi en dernier : dessiné au-dessus.
      features: routes
        .map((r, i) => line(r.coordinates, { selected: i === selected ? 1 : 0, i }))
        .sort((a, b) => Number(a.properties?.selected) - Number(b.properties?.selected)),
    }),
    [routes, selected],
  );
  const foot = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: walk ? [line(walk.coordinates, {})] : [] }),
    [walk],
  );
  const labels = useMemo(
    // Durées réparties le long des tracés pour qu'elles ne se chevauchent pas.
    () => routes.map((r, i) => pointAt(r.coordinates, cumulative(r.coordinates), 0.35 + 0.15 * i)),
    [routes],
  );

  return (
    <>
      <GeoJSONSource id="trajet" data={drive} onPress={onSelect ? (e) => onSelect(Number(e.nativeEvent.features[0]?.properties?.i ?? 0)) : undefined}>
        <Layer
          id="trajet-bord"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 17, 14] as never }}
        />
        <Layer
          id="trajet-ligne"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': ['case', ['==', ['get', 'selected'], 1], c.action, c.texte.tertiaire] as never,
            'line-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.55] as never,
            'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9] as never,
          }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="trajet-pied" data={foot}>
        <Layer
          id="trajet-pied-ligne"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': c.action, 'line-width': 4, 'line-dasharray': [0, 2] }}
        />
      </GeoJSONSource>
      {badges &&
        routes.map((r, i) => (
          <ViewAnnotation key={`duree-${i}`} id={`duree-${i}`} lngLat={labels[i]} anchor="bottom">
            <Pressable
              onPress={() => onSelect?.(i)}
              accessibilityRole="button"
              accessibilityLabel={`Itinéraire de ${formatDuration(r.duration)}`}
              style={[styles.badge, { backgroundColor: i === selected ? c.action : c.fond.surface }]}
            >
              <Text style={[styles.time, { color: i === selected ? '#FFFFFF' : c.texte.principal }]}>{formatDuration(r.duration)}</Text>
              {i === 0 && routes.length > 1 && (
                <Text style={[styles.hint, { color: i === selected ? '#FFFFFF' : c.texte.secondaire }]}>Plus rapide</Text>
              )}
            </Pressable>
          </ViewAnnotation>
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  time: { fontFamily: police, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hint: { fontFamily: police, fontSize: 11, fontWeight: '500' },
});
