import { GeoJSONSource, Layer, LayerAnnotation, useCurrentPosition, ViewAnnotation } from '@maplibre/maplibre-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { police, type Couleurs } from '@/theme';
import { cumulative, formatDuration, pointAt, type Control, type Route } from '@/utils/route';

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

/**
 * Feux, stops et cédez-le-passage du trajet, debout face à l'écran même carte inclinée. Ils ne
 * s'effacent pas devant les libellés : à un carrefour, le panneau compte plus que le nom de la rue.
 */
export function ControlLayer({ controls }: { controls: Control[] }) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: controls.map((k) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [k.lon, k.lat] },
        properties: { icon: `control-${k.kind}` },
      })),
    }),
    [controls],
  );
  return (
    <GeoJSONSource id="trajet-controles" data={data}>
      <Layer
        id="trajet-controles-icones"
        type="symbol"
        minzoom={13}
        layout={{
          'icon-image': ['get', 'icon'] as never,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.55, 16, 0.85, 18, 1] as never,
          'icon-anchor': 'bottom',
          'icon-pitch-alignment': 'viewport',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
    </GeoJSONSource>
  );
}

/** En dessous (m/s, ~5 km/h), le cap GPS ne veut rien dire : la voiture garde le dernier. */
const MOVING_MS = 1.5;

/**
 * Flèche de navigation en 3D, tournée selon le cap GPS ; sa position glisse d'un relevé à l'autre.
 * L'image est un rendu vu de derrière et d'au-dessus (scripts/nav-arrow), affiché face à l'écran :
 * la caméra du guidage étant derrière la voiture, le relief est juste. Avant de rouler, elle suit
 * le sens du tracé (initialCourse).
 */
export function DrivingPuck({ initialCourse }: { initialCourse: number }) {
  const position = useCurrentPosition();
  const [course, setCourse] = useState(initialCourse);
  const heading = position?.coords.heading;
  if (heading != null && heading >= 0 && (position?.coords.speed ?? 0) > MOVING_MS && heading !== course) {
    setCourse(heading);
  }
  if (!position) return null;
  return (
    <LayerAnnotation id="voiture-position" animated animationDuration={900} lngLat={[position.coords.longitude, position.coords.latitude]}>
      <Layer
        id="voiture-position-icone"
        type="symbol"
        layout={{
          'icon-image': 'puck-arrow',
          'icon-rotate': course,
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'viewport',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.85, 17, 1.25, 19, 1.4] as never,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        }}
      />
    </LayerAnnotation>
  );
}
