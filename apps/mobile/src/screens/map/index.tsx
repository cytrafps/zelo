import { Camera, Map, UserLocation, type CameraRef, type GeoJSONSourceProps } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BBox } from '@/api/zelo';
import { useLive } from '@/hooks/use-live';
import { useMapData, type DataStatus } from '@/hooks/use-map-data';
import { useUserLocation } from '@/hooks/use-user-location';
import { espace, rayon, texte, useTheme, type Couleurs } from '@/theme';

import { ChargeLayer, FuelLayer, ReportLayer } from './layers';
import { ReportSheet } from './report-sheet';
import { StationSheet, type Selection } from './station-sheet';

// Fond de carte OpenStreetMap gratuit et sans clé (OpenFreeMap) pour le prototype ;
// à remplacer par nos tuiles PMTiles auto-hébergées.
const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const REIMS: [number, number] = [4.0317, 49.2583];

export function MapScreen() {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const [view, setView] = useState<BBox | null>(null);
  const [center, setCenter] = useState(REIMS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [reporting, setReporting] = useState(false);

  const data = useMapData(view);
  const live = useLive(data.addReport, data.reload);
  const location = useUserLocation();

  const select =
    (kind: Selection['kind']): NonNullable<GeoJSONSourceProps['onPress']> =>
    (e) => {
      e.stopPropagation();
      const id = e.nativeEvent.features[0]?.properties?.id;
      if (kind === 'fuel') {
        const station = data.fuel.find((s) => s.id === id);
        if (station) setSelection({ kind, station });
      } else {
        const station = data.charge.find((s) => s.id === id);
        if (station) setSelection({ kind, station });
      }
    };

  const locate = async () => {
    const p = await location.locate().catch(() => null);
    if (p) camera.current?.flyTo({ center: [p.lon, p.lat], zoom: 15, duration: 800 });
  };

  const reportPosition = location.position
    ? { ...location.position, source: 'gps' as const }
    : { lat: center[1], lon: center[0], source: 'carte' as const };

  return (
    <View style={styles.fill}>
      <Map
        style={styles.fill}
        mapStyle={dark ? STYLE.dark : STYLE.light}
        logo={false}
        compass
        onRegionDidChange={(e) => {
          setView(e.nativeEvent.bounds);
          setCenter(e.nativeEvent.center);
        }}
      >
        <Camera ref={camera} initialViewState={{ center: REIMS, zoom: 13.5 }} minZoom={5} maxZoom={19} />
        <FuelLayer stations={data.fuel} c={c} onPress={select('fuel')} />
        <ChargeLayer stations={data.charge} c={c} onPress={select('charge')} />
        <ReportLayer reports={data.reports} />
        {location.granted && <UserLocation accuracy />}
      </Map>

      <StatusPill status={data.status} live={live} c={c} top={insets.top + espace[2]} onRetry={data.reload} />

      <View style={[styles.bottomBar, { bottom: insets.bottom + espace[4] }]} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Signaler un événement"
          onPress={() => setReporting(true)}
          style={({ pressed }) => [styles.reportButton, { backgroundColor: c.action, opacity: pressed ? 0.85 : 1 }]}
        >
          <SymbolView name={{ ios: 'exclamationmark.bubble.fill', android: 'campaign' }} tintColor="#FFFFFF" size={20} />
          <Text style={[texte.corpsFort, { color: '#FFFFFF' }]}>Signaler</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrer sur ma position"
          onPress={locate}
          style={({ pressed }) => [styles.roundButton, { backgroundColor: c.fond.surface, opacity: pressed ? 0.85 : 1 }]}
        >
          <SymbolView name={{ ios: 'location.fill', android: 'my_location' }} tintColor={c.action} size={22} />
        </Pressable>
      </View>

      <StationSheet selection={selection} onDismiss={() => setSelection(null)} />
      <ReportSheet
        isPresented={reporting}
        onDismiss={() => setReporting(false)}
        position={reportPosition}
        onCreated={data.addReport}
      />
    </View>
  );
}

const MESSAGES: Partial<Record<DataStatus, string>> = {
  loading: 'Chargement…',
  error: 'Connexion impossible · Réessayer',
  'zoom-out': 'Zoome pour voir les stations',
};

function StatusPill(props: { status: DataStatus; live: boolean; c: Couleurs; top: number; onRetry: () => void }) {
  const { status, live, c, top, onRetry } = props;
  const message = MESSAGES[status] ?? (live ? null : 'Signalements en direct indisponibles');
  if (!message) return null;
  return (
    <Pressable
      disabled={status !== 'error'}
      onPress={onRetry}
      style={[styles.pill, { top, backgroundColor: c.fond.surface }]}
      accessibilityRole={status === 'error' ? 'button' : 'text'}
    >
      <Text style={[texte.petit, { color: status === 'error' ? c.alerte.base : c.texte.secondaire }]}>{message}</Text>
    </Pressable>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottomBar: {
    position: 'absolute',
    left: espace[4],
    right: espace[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportButton: {
    height: rayon.hauteurBouton,
    borderRadius: rayon.bouton,
    paddingHorizontal: espace[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[2],
    ...shadow,
  },
  roundButton: {
    width: rayon.hauteurBouton,
    height: rayon.hauteurBouton,
    borderRadius: rayon.pilule,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: espace[4],
    paddingVertical: espace[2],
    borderRadius: rayon.pilule,
    ...shadow,
  },
});
