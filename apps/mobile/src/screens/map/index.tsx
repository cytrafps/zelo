import { Camera, Map, UserLocation, type CameraRef, type GeoJSONSourceProps } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Place } from '@/api/geocode';
import type { BBox } from '@/api/zelo';
import { useLive } from '@/hooks/use-live';
import { useMapData, type DataStatus } from '@/hooks/use-map-data';
import { useParkedCar } from '@/hooks/use-parked-car';
import { useUserLocation } from '@/hooks/use-user-location';
import { espace, rayon, texte, useTheme, type Couleurs } from '@/theme';

import { CarSheet } from './car-sheet';
import { ChargeLayer, FuelLayer, ParkingLayer, ReportLayer } from './layers';
import { CarMarker, DestinationMarker } from './markers';
import { NearbySheet } from './nearby-sheet';
import { PlaceSheet, type Selection } from './place-sheet';
import { ReportDetailSheet } from './report-detail-sheet';
import { ReportSheet } from './report-sheet';
import { SEARCH_BAR_HEIGHT, SearchBar } from './search-bar';

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
  const [destination, setDestination] = useState<Place | null>(null);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  /** La fiche ouverte depuis « Autour de ta destination » y ramène à sa fermeture. */
  const [fromNearby, setFromNearby] = useState(false);
  const [carOpen, setCarOpen] = useState(false);
  const parked = useParkedCar();

  const data = useMapData(view);
  const live = useLive(data.upsertReport, data.removeReport, data.reload);
  const [reportId, setReportId] = useState<number | null>(null);
  const openReport = data.reports.find((r) => r.id === reportId) ?? null;
  const location = useUserLocation();

  const select =
    (kind: Selection['kind']): NonNullable<GeoJSONSourceProps['onPress']> =>
    (e) => {
      e.stopPropagation();
      const id = e.nativeEvent.features[0]?.properties?.id;
      const next =
        kind === 'fuel'
          ? pick(kind, data.fuel, id)
          : kind === 'charge'
            ? pick(kind, data.charge, id)
            : pick(kind, data.parkings, id);
      if (next) setSelection(next);
    };

  const locate = async () => {
    const p = await location.locate().catch(() => null);
    if (p) camera.current?.flyTo({ center: [p.lon, p.lat], zoom: 15, duration: 800 });
  };

  const here = location.position
    ? { ...location.position, source: 'gps' as const }
    : { lat: center[1], lon: center[0], source: 'carte' as const };

  const goTo = (place: Place) => {
    setDestination(place);
    setNearbyOpen(true);
    camera.current?.flyTo({ center: [place.lon, place.lat], zoom: 15.5, duration: 900 });
  };

  const clearDestination = () => {
    setDestination(null);
    setNearbyOpen(false);
  };

  // Les données « autour » ne valent que si la zone chargée contient la destination.
  const nearbyLoading =
    destination !== null &&
    (data.area === null ||
      destination.lon < data.area[0] ||
      destination.lat < data.area[1] ||
      destination.lon > data.area[2] ||
      destination.lat > data.area[3]);

  const searchTop = insets.top + espace[2];

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
        <ParkingLayer parkings={data.parkings} c={c} onPress={select('parking')} />
        <FuelLayer stations={data.fuel} c={c} onPress={select('fuel')} />
        <ChargeLayer stations={data.charge} c={c} onPress={select('charge')} />
        <ReportLayer
          reports={data.reports}
          onPress={(e) => {
            e.stopPropagation();
            const id = e.nativeEvent.features[0]?.properties?.id;
            if (typeof id === 'number') setReportId(id);
          }}
        />
        {location.granted && <UserLocation accuracy />}
        {destination && <DestinationMarker at={destination} c={c} />}
        {parked.car && <CarMarker at={parked.car} c={c} onPress={() => setCarOpen(true)} />}
      </Map>

      <StatusPill
        status={data.status}
        live={live}
        c={c}
        top={searchTop + SEARCH_BAR_HEIGHT + espace[2]}
        onRetry={data.reload}
      />
      <SearchBar
        c={c}
        top={searchTop}
        near={{ lat: center[1], lon: center[0] }}
        destination={destination}
        onSelect={goTo}
        onClear={clearDestination}
      />

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
        <View style={styles.roundGroup}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={parked.car ? 'Ma voiture' : 'Enregistrer où je me suis garé'}
            onPress={() => setCarOpen(true)}
            style={({ pressed }) => [styles.roundButton, { backgroundColor: c.fond.surface, opacity: pressed ? 0.85 : 1 }]}
          >
            <SymbolView
              name={{ ios: parked.car ? 'car.fill' : 'car', android: 'directions_car' }}
              tintColor={parked.car ? c.action : c.texte.secondaire}
              size={22}
            />
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
      </View>

      <PlaceSheet
        selection={selection}
        onDismiss={() => {
          setSelection(null);
          if (fromNearby) setNearbyOpen(true);
          setFromNearby(false);
        }}
      />
      <NearbySheet
        destination={destination}
        isPresented={nearbyOpen && selection === null}
        onDismiss={() => setNearbyOpen(false)}
        parkings={data.parkings}
        charge={data.charge}
        fuel={data.fuel}
        loading={nearbyLoading}
        onPick={(s) => {
          setFromNearby(true);
          setNearbyOpen(false);
          setSelection(s);
        }}
      />
      <CarSheet
        isPresented={carOpen}
        onDismiss={() => setCarOpen(false)}
        car={parked.car}
        me={location.position}
        here={here}
        onPark={parked.park}
        onForget={parked.forget}
        onShow={(car) => {
          setCarOpen(false);
          camera.current?.flyTo({ center: [car.lon, car.lat], zoom: 17, duration: 800 });
        }}
      />
      <ReportSheet isPresented={reporting} onDismiss={() => setReporting(false)} position={here} onCreated={data.upsertReport} />
      <ReportDetailSheet
        report={openReport}
        onDismiss={() => setReportId(null)}
        onVoted={(r, removed) => (removed ? data.removeReport(r.id) : data.upsertReport(r))}
      />
    </View>
  );
}

function pick<K extends Selection['kind']>(kind: K, list: { id: string }[], id: unknown) {
  const item = list.find((x) => x.id === id);
  return item ? ({ kind, item } as Extract<Selection, { kind: K }>) : null;
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
  roundGroup: { flexDirection: 'row', gap: espace[3] },
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
