import { Camera, Map, UserLocation, type CameraRef, type GeoJSONSourceProps, type TrackUserLocation } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Place } from '@/api/geocode';
import { getChargeStations, getParkings, type BBox } from '@/api/zelo';
import { useLive } from '@/hooks/use-live';
import { useMapData, type DataStatus } from '@/hooks/use-map-data';
import { useParkedCar } from '@/hooks/use-parked-car';
import { useStored } from '@/hooks/use-stored';
import { useTrip } from '@/hooks/use-trip';
import { useUserLocation } from '@/hooks/use-user-location';
import { espace, rayon, texte, useTheme, type Couleurs } from '@/theme';
import type { LatLon } from '@/utils/geo';
import { pushRecent } from '@/utils/recents';
import { bounds } from '@/utils/route';
import { targets } from '@/utils/targets';

import { CarSheet } from './car-sheet';
import { Filters } from './filters';
import { Guidance } from './guidance';
import { HomePanel } from './home-panel';
import { ChargeLayer, FuelLayer, ParkingLayer, ReportLayer } from './layers';
import { mapStyle } from './map-style';
import { CarMarker, DestinationMarker, StopMarker } from './markers';
import { PIN_MIN_ZOOM, Pins, type Category } from './pins';
import { PlaceSheet, type Selection } from './place-sheet';
import { ReportDetailSheet } from './report-detail-sheet';
import { ReportSheet } from './report-sheet';
import { RouteLayer } from './route-layer';
import { TripPanel } from './trip-panel';

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
  const [carOpen, setCarOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** En guidage, la carte suit la voiture tant qu'on ne la déplace pas à la main. */
  const [following, setFollowing] = useState(true);
  /** Hors guidage, le bouton de position fait comme Plans : centrer et suivre, puis orienter selon la boussole. */
  const [homeTracking, setHomeTracking] = useState<TrackUserLocation | null>(null);
  const parked = useParkedCar();
  const trips = useTrip();
  const trip = trips.trip;
  const guiding = trip !== null && trip.phase !== 'preview';
  // En voiture, le cap GPS (le téléphone est fixé n'importe comment) ; à pied, la boussole (le cap GPS est trop bruité à 5 km/h).
  const tracking: TrackUserLocation | undefined = guiding
    ? following
      ? trip.phase === 'walk'
        ? 'heading'
        : 'course'
      : undefined
    : trip
      ? undefined
      : (homeTracking ?? undefined);

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
    if (guiding) return setFollowing(true);
    if (homeTracking === 'heading') {
      setHomeTracking('default');
      return void camera.current?.setStop({ bearing: 0, duration: 400 });
    }
    if (homeTracking) return setHomeTracking('heading');
    if (await location.locate().catch(() => null)) setHomeTracking('default');
  };

  const here = location.position
    ? { ...location.position, source: 'gps' as const }
    : { lat: center[1], lon: center[0], source: 'carte' as const };

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((n) => (n === message ? null : n)), 4000);
  };

  /** Destination choisie : aperçu du trajet, avec les parkings et bornes autour d'elle. */
  const goTo = async (place: Place) => {
    setRecents((list) => pushRecent(list, place));
    setHomeTracking(null);
    const from = await location.locate().catch(() => null);
    if (!from) return flash('Active la localisation pour calculer un itinéraire');
    const box = around(place, 0.012);
    const [parkings, charge] = await Promise.all([getParkings(box).catch(() => []), getChargeStations(box).catch(() => [])]);
    trips.start({ ...from, heading: location.heading() }, place, targets(place, parkings, charge));
  };

  // Aperçu : la carte cadre tous les itinéraires au-dessus de la feuille.
  const routesKey = trip?.phase === 'preview' ? trip.routes.length + ':' + (trip.routes[0]?.distance ?? 0) : '';
  useEffect(() => {
    if (!trip || trip.phase !== 'preview' || trip.routes.length === 0) return;
    const lines = [...trip.routes.map((r) => r.coordinates), ...(trip.walk ? [trip.walk.coordinates] : [])];
    camera.current?.fitBounds(bounds(...lines), {
      padding: { top: insets.top + 80, bottom: panelHeight + 40, left: 48, right: 48 },
      pitch: 0,
      duration: 700,
    });
    // Recadrage quand les itinéraires changent, pas à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesKey]);

  // Guidage : vue inclinée qui suit la voiture.
  useEffect(() => {
    if (guiding) void camera.current?.setStop({ zoom: 17, pitch: 55, duration: 600 });
  }, [guiding, trip?.phase]);

  const arrive = (at: LatLon) => {
    if (!trip) return;
    if (trip.phase === 'drive' && trip.target.kind !== 'dropoff') {
      parked.park(at);
      trips.parked();
      if (!trip.walk) flash('Tu es arrivé. Ta voiture est enregistrée.');
      return;
    }
    trips.end();
    flash('Tu es arrivé');
  };

  const top = insets.top + espace[2];
  const route = trip?.routes[trip.selected];

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
        <Camera
          ref={camera}
          initialViewState={{ center: REIMS, zoom: 15, pitch: 50 }}
          minZoom={5}
          maxZoom={19}
          trackUserLocation={tracking}
          onTrackUserLocationChange={(e) => {
            // La carte déplacée à la main : on arrête de suivre.
            if (e.nativeEvent.trackUserLocation !== null) return;
            if (guiding) setFollowing(false);
            else setHomeTracking(null);
          }}
        />
        {!trip && category === 'stationnement' && <ParkingLayer parkings={data.parkings} c={c} onPress={select('parking')} />}
        {!trip && category === 'carburant' && <FuelLayer stations={data.fuel} c={c} onPress={select('fuel')} />}
        {!trip && category === 'recharge' && <ChargeLayer stations={data.charge} c={c} onPress={select('charge')} />}
        {trip && route && (
          <RouteLayer
            routes={trip.phase === 'preview' ? trip.routes : [route]}
            selected={trip.phase === 'preview' ? trip.selected : 0}
            walk={trip.phase === 'drive' || trip.phase === 'preview' ? trip.walk : null}
            c={c}
            badges={trip.phase === 'preview' && trip.routes.length > 1}
            onSelect={trip.phase === 'preview' ? trips.select : undefined}
          />
        )}
        <ReportLayer
          reports={data.reports}
          onPress={(e) => {
            e.stopPropagation();
            const id = e.nativeEvent.features[0]?.properties?.id;
            if (typeof id === 'number') setReportId(id);
          }}
        />
        {location.granted && <UserLocation accuracy heading={trip?.phase !== 'drive'} />}
        {!trip && view && zoom >= PIN_MIN_ZOOM && <Pins category={category} data={data} view={view} c={c} onSelect={setSelection} />}
        {trip && trip.target.kind !== 'dropoff' && trip.phase !== 'walk' && <StopMarker target={trip.target} c={c} />}
        {trip && <DestinationMarker at={trip.destination} c={c} />}
        {parked.car && <CarMarker at={parked.car} c={c} onPress={() => setCarOpen(true)} />}
      </Map>

      {!guiding && <StatusPill status={data.status} live={live} notice={notice} c={c} top={top} onRetry={data.reload} />}
      {!trip && <Filters value={category} onChange={setCategory} c={c} top={top} />}

      <View style={[styles.mapButtons, { bottom: (guiding ? 96 + insets.bottom : panelHeight) + espace[3] }]} pointerEvents="box-none">
        {trip?.phase !== 'preview' && (
          <MapButton c={c} label="Signaler un événement" onPress={() => setReporting(true)}>
            <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning' }} tintColor="#E8A10C" size={22} />
          </MapButton>
        )}
        {(!guiding || !following) && (
          <MapButton c={c} label={guiding ? 'Reprendre le suivi' : LOCATE[homeTracking ?? 'none'].label} onPress={locate}>
            <SymbolView name={guiding ? LOCATE.none.icon : LOCATE[homeTracking ?? 'none'].icon} tintColor={c.action} size={22} />
          </MapButton>
        )}
      </View>

      {guiding && route && trip ? (
        <Guidance
          route={route}
          phase={trip.phase === 'walk' ? 'walk' : 'drive'}
          target={trip.target}
          c={c}
          top={top}
          bottomInset={insets.bottom}
          rerouting={trip.loading}
          onReroute={trips.reroute}
          onArrive={arrive}
          onClose={trips.end}
        />
      ) : (
        <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={styles.panelMeasure} pointerEvents="box-none">
          {trip ? (
            <TripPanel
              trip={trip}
              reports={data.reports}
              c={c}
              bottomInset={insets.bottom}
              avoid={trips.avoid}
              onSelect={trips.select}
              onGo={(i) => {
                setFollowing(true);
                trips.go(i);
              }}
              onChange={async (change) => {
                const from = await location.locate().catch(() => null);
                if (from) trips.update({ ...from, heading: location.heading() }, change);
              }}
              onClose={trips.end}
            />
          ) : (
            <HomePanel
              c={c}
              bottomInset={insets.bottom}
              near={{ lat: center[1], lon: center[0] }}
              recents={recents}
              carParked={parked.car !== null}
              onSelect={goTo}
              onCar={() => setCarOpen(true)}
            />
          )}
        </View>
      )}

      <PlaceSheet selection={selection} onDismiss={() => setSelection(null)} />
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

/** Zone carrée de ±`d` degrés autour d'un point. */
const around = (p: LatLon, d: number): BBox => [p.lon - d, p.lat - d * 0.66, p.lon + d, p.lat + d * 0.66];

function pick<K extends Selection['kind']>(kind: K, list: { id: string }[], id: unknown) {
  const item = list.find((x) => x.id === id);
  return item ? ({ kind, item } as Extract<Selection, { kind: K }>) : null;
}

const MESSAGES: Partial<Record<DataStatus, string>> = {
  loading: 'Chargement…',
  error: 'Connexion impossible · Réessayer',
  'zoom-out': 'Zoome pour voir les stations',
};

function StatusPill(props: { status: DataStatus; live: boolean; notice: string | null; c: Couleurs; top: number; onRetry: () => void }) {
  const { status, live, notice, c, top, onRetry } = props;
  const message = notice ?? MESSAGES[status] ?? (live ? null : 'Signalements en direct indisponibles');
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

/** Bouton de position : état actuel → icône et action proposée. */
const LOCATE = {
  none: { icon: { ios: 'location', android: 'location_searching' }, label: 'Centrer sur ma position' },
  default: { icon: { ios: 'location.fill', android: 'my_location' }, label: 'Orienter selon la boussole' },
  heading: { icon: { ios: 'location.north.line.fill', android: 'explore' }, label: 'Garder le nord en haut' },
  course: { icon: { ios: 'location.fill', android: 'my_location' }, label: 'Centrer sur ma position' },
} as const;

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
