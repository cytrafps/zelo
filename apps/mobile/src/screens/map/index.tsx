import { Camera, Map, UserLocation, type CameraRef, type GeoJSONSourceProps } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Place } from '@/api/geocode';
import type { BBox } from '@/api/zelo';
import { useLive } from '@/hooks/use-live';
import { useMapData, type DataStatus } from '@/hooks/use-map-data';
import { useParkedCar } from '@/hooks/use-parked-car';
import { useStored } from '@/hooks/use-stored';
import { useUserLocation } from '@/hooks/use-user-location';
import { espace, rayon, texte, useTheme, type Couleurs } from '@/theme';
import { pushRecent } from '@/utils/recents';

import { CarSheet } from './car-sheet';
import { Filters } from './filters';
import { HomePanel } from './home-panel';
import { ChargeLayer, FuelLayer, ParkingLayer, ReportLayer } from './layers';
import { mapStyle } from './map-style';
import { CarMarker, DestinationMarker } from './markers';
import { NearbySheet } from './nearby-sheet';
import { PIN_MIN_ZOOM, Pins, type Category } from './pins';
import { PlaceSheet, type Selection } from './place-sheet';
import { ReportDetailSheet } from './report-detail-sheet';
import { ReportSheet } from './report-sheet';

const REIMS: [number, number] = [4.0317, 49.2583];

export function MapScreen() {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const [view, setView] = useState<BBox | null>(null);
  const [center, setCenter] = useState(REIMS);
  const [zoom, setZoom] = useState(15);
  const [category, setCategory] = useStored<Category>('zelo.categorie', 'stationnement');
  const [recents, setRecents] = useStored<Place[]>('zelo.recents', []);
  const [panelHeight, setPanelHeight] = useState(0);
  const style = useMemo(() => mapStyle(dark), [dark]);
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
    setRecents((list) => pushRecent(list, place));
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

  const top = insets.top + espace[2];

  return (
    <View style={styles.fill}>
      <Map
        style={styles.fill}
        mapStyle={style}
        logo={false}
        compass
        compassPosition={{ top: top + 172, right: espace[4] }}
        onRegionDidChange={(e) => {
          setView(e.nativeEvent.bounds);
          setCenter(e.nativeEvent.center);
          setZoom(e.nativeEvent.zoom);
        }}
      >
        <Camera ref={camera} initialViewState={{ center: REIMS, zoom: 15, pitch: 50 }} minZoom={5} maxZoom={19} />
        {category === 'stationnement' && <ParkingLayer parkings={data.parkings} c={c} onPress={select('parking')} />}
        {category === 'carburant' && <FuelLayer stations={data.fuel} c={c} onPress={select('fuel')} />}
        {category === 'recharge' && <ChargeLayer stations={data.charge} c={c} onPress={select('charge')} />}
        <ReportLayer
          reports={data.reports}
          onPress={(e) => {
            e.stopPropagation();
            const id = e.nativeEvent.features[0]?.properties?.id;
            if (typeof id === 'number') setReportId(id);
          }}
        />
        {location.granted && <UserLocation accuracy />}
        {view && zoom >= PIN_MIN_ZOOM && <Pins category={category} data={data} view={view} c={c} onSelect={setSelection} />}
        {destination && <DestinationMarker at={destination} c={c} />}
        {parked.car && <CarMarker at={parked.car} c={c} onPress={() => setCarOpen(true)} />}
      </Map>

      <StatusPill status={data.status} live={live} c={c} top={top} onRetry={data.reload} />
      <Filters value={category} onChange={setCategory} c={c} top={top} />

      <View style={[styles.mapButtons, { bottom: panelHeight + espace[3] }]} pointerEvents="box-none">
        <MapButton c={c} label="Signaler un événement" onPress={() => setReporting(true)}>
          <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning' }} tintColor="#E8A10C" size={22} />
        </MapButton>
        <MapButton c={c} label="Centrer sur ma position" onPress={locate}>
          <SymbolView name={{ ios: 'location.fill', android: 'navigation' }} tintColor={c.action} size={22} />
        </MapButton>
      </View>

      <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={styles.panelMeasure} pointerEvents="box-none">
        <HomePanel
          c={c}
          bottomInset={insets.bottom}
          near={{ lat: center[1], lon: center[0] }}
          destination={destination}
          recents={recents}
          carParked={parked.car !== null}
          onSelect={goTo}
          onClear={clearDestination}
          onCar={() => setCarOpen(true)}
        />
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

function MapButton(props: { c: Couleurs; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={({ pressed }) => [styles.mapButton, { backgroundColor: props.c.fond.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      {props.children}
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
  mapButtons: { position: 'absolute', right: espace[4], gap: espace[3] },
  mapButton: { width: 48, height: 48, borderRadius: rayon.m, alignItems: 'center', justifyContent: 'center', ...shadow },
  panelMeasure: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: espace[4],
    paddingVertical: espace[2],
    borderRadius: rayon.pilule,
    ...shadow,
  },
});
