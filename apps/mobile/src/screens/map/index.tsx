import { Camera, Map, UserLocation, type CameraRef, type GeoJSONSourceProps, type TrackUserLocation } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Place } from '@/api/geocode';
import { getChargeStations, getParkings, getParkRides, getZones, type BBox, type ReportKind } from '@/api/zelo';
import { Glass } from '@/components/glass';
import { useLive } from '@/hooks/use-live';
import { useMapData, type DataStatus, type Place as DataPlace } from '@/hooks/use-map-data';
import { useCarEvents } from '@/hooks/use-car-events';
import { useNow } from '@/hooks/use-now';
import { useOutbox } from '@/hooks/use-outbox';
import { useParkedCar } from '@/hooks/use-parked-car';
import { useStored } from '@/hooks/use-stored';
import { useTrip, type TripTarget } from '@/hooks/use-trip';
import { useUserLocation } from '@/hooks/use-user-location';
import { espace, rayon, texte, useTheme, type Couleurs } from '@/theme';
import { FREED_FOR_MS } from '@/utils/car-events';
import type { Zone } from '@/utils/zfe';
import { distance, type LatLon } from '@/utils/geo';
import { pushRecent } from '@/utils/recents';
import { bounds, segmentBearing } from '@/utils/route';
import { targets } from '@/utils/targets';

import { CarSheet } from './car-sheet';
import { Filters } from './filters';
import { Guidance } from './guidance';
import { HomePanel } from './home-panel';
import { ChargeLayer, FuelLayer, ParkingLayer, ReportLayer } from './layers';
import { mapStyle } from './map-style';
import { CarMarker, DestinationMarker, StopMarker } from './markers';
import { PinImages, type Category } from './pins';
import { PlaceSheet, type Selection } from './place-sheet';
import { ReportDetailSheet } from './report-detail-sheet';
import { ReportSheet } from './report-sheet';
import { TransitCard } from './transit-card';
import { ControlLayer, DrivingPuck, RouteLayer } from './route-layer';
import { TripPanel } from './trip-panel';

const REIMS: [number, number] = [4.0317, 49.2583];

export function MapScreen() {
  const { c, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  /** Centre de la carte, à 300 m près : il ne sert qu'à orienter la recherche et à défaut de GPS. */
  const [center, setCenter] = useState(REIMS);
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
  /** Place quittée en se reconnectant à Android Auto : à signaler libre tant qu'elle est récente. */
  const [freed, setFreed] = useStored<(LatLon & { since: number }) | null>('zelo.place-liberee', null);
  const now = useNow(60_000);
  /** Zones à faibles émissions autour de la destination du trajet en cours. */
  const [zones, setZones] = useState<Zone[]>([]);
  const destination = trip?.destination;
  useEffect(() => {
    if (!destination) return;
    const ctl = new AbortController();
    getZones(around(destination, 0.05), ctl.signal).then(setZones, () => setZones([]));
    return () => ctl.abort();
  }, [destination]);
  // Guidage sur la carte en voiture et à pied ; en tram, une carte d'horaires suffit.
  const guiding = trip !== null && (trip.phase === 'drive' || trip.phase === 'walk');
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

  const data = useMapData(trip ? null : PLACE[category]);
  const live = useLive(data.upsertReport, data.removeReport, data.reloadReports);
  const [reportId, setReportId] = useState<number | null>(null);
  const openReport = data.reports.find((r) => r.id === reportId) ?? null;
  // Pendant le guidage, la position vient du suivi précis de Guidance : pas de second abonnement.
  const location = useUserLocation(!guiding);
  /** Dernière position du guidage (un ref : la carte ne se redessine pas à chaque position). */
  const guideFix = useRef<LatLon | null>(null);
  /** Position figée à l'ouverture de la feuille de signalement, prise du guidage s'il est en cours. */
  const [reportFrom, setReportFrom] = useState<LatLon | null>(null);

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

  useCarEvents(parked.car, (a) => {
    if (a.kind === 'freed') {
      parked.forget();
      setFreed({ ...a.at, since: a.since });
      return;
    }
    // Pendant le guidage (et à pied ou en tram après l'arrivée), l'arrivée enregistre déjà la
    // voiture au bon endroit : la déconnexion ne doit ni la déplacer ni ouvrir une feuille.
    const phase = trips.trip?.phase;
    if (phase && phase !== 'preview') return;
    if (a.kind === 'park') {
      parked.park(a.at);
      flash('Android Auto déconnecté : ta voiture est enregistrée ici.');
    } else {
      flash('Android Auto déconnecté : où es-tu garé ?');
      setCarOpen(true);
    }
  });

  const outbox = useOutbox(data.upsertReport);
  /** Signalement envoyé, ou gardé jusqu'au retour du réseau. */
  const sendReport = async (kind: ReportKind, lat: number, lon: number) => {
    const r = await outbox.send(kind, lat, lon);
    if (r) data.upsertReport(r);
    else flash('Pas de réseau : ton signalement partira dès que possible.');
    return r;
  };

  const reportFreed = (at: LatLon) =>
    sendReport('place_liberee', at.lat, at.lon).then(
      (r) => {
        setFreed(null);
        if (r) flash('Merci, ta place est signalée libre.');
      },
      () => flash('Signalement refusé, réessaie dans un instant.'),
    );

  /** Destination choisie : aperçu du trajet, avec les parkings et bornes autour d'elle. */
  const goTo = (place: Place) => {
    setRecents((list) => pushRecent(list, place));
    const box = around(place, 0.012);
    // Tous véhicules : changer de véhicule dans l'aperçu ne relance pas la recherche des arrêts.
    const options = Promise.all([
      getParkings(box).catch(() => []),
      getParkings(box, undefined, 'moto').catch(() => []),
      getParkings(box, undefined, 'bike').catch(() => []),
      getChargeStations(box).catch(() => []),
      getParkRides(place, location.position).catch(() => []),
    ]).then(([cars, motos, bikes, charge, relays]) =>
      // Une borne réservée aux clients n'est pas un arrêt à proposer.
      targets(place, [...cars, ...motos, ...bikes], charge.filter((b) => !b.reserved), relays),
    );
    return startTrip(place, options);
  };

  /** « Y aller » depuis la fiche d'un lieu : on s'y arrête, sans proposer d'autre parking. */
  const goToSelection = (s: Selection) => {
    setSelection(null);
    const place = { id: `${s.kind}-${s.item.id}`, lat: s.item.lat, lon: s.item.lon, detail: '' };
    if (s.kind === 'fuel') {
      const name = s.item.address || 'Station-service';
      return startTrip({ ...place, name, label: name, detail: s.item.city }, [{ kind: 'dropoff' }]);
    }
    const name = s.item.name || (s.kind === 'parking' ? 'Parking' : 'Borne de recharge');
    const stop: TripTarget = s.kind === 'parking' ? { kind: 'parking', item: s.item, walk: 0 } : { kind: 'charge', item: s.item, walk: 0 };
    return startTrip({ ...place, name, label: name }, [stop]);
  };

  /** L'aperçu s'ouvre aussitôt ; position et arrêts possibles sont cherchés en même temps. */
  const startTrip = async (place: Place, options: TripTarget[] | Promise<TripTarget[]>) => {
    setHomeTracking(null);
    const token = trips.open(place);
    const [from, stops] = await Promise.all([location.locate().catch(() => null), options]);
    if (!from) {
      trips.cancel(token);
      return flash('Position introuvable : vérifie que la localisation est activée');
    }
    trips.start(token, { ...from, heading: location.heading() }, place, stops);
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

  // Guidage : vue inclinée prise derrière la voiture, qui se trouve aux trois quarts bas de l'écran
  // pour montrer la route devant ; la marge haute décale le point suivi vers le bas.
  // En sortant du guidage, la marge est retirée (l'aperçu cadre avec la sienne).
  const { height } = useWindowDimensions();
  const wasGuiding = useRef(false);
  useEffect(() => {
    if (guiding) {
      const zoom = trip?.phase === 'walk' ? 18 : 17.5;
      void camera.current?.setStop({ zoom, pitch: 60, padding: { ...NO_PADDING, top: Math.round(height * 0.45) }, duration: 600 });
    } else if (wasGuiding.current) {
      void camera.current?.setStop({ padding: NO_PADDING, duration: 300 });
    }
    wasGuiding.current = guiding;
  }, [guiding, trip?.phase, height]);

  const arrive = (at: LatLon) => {
    if (!trip) return;
    if (trip.phase === 'drive' && trip.target.kind !== 'dropoff') {
      // Seule la voiture est retenue : un vélo ou une moto garés ne la remplacent pas.
      const car = trips.vehicle === 'car';
      if (car) parked.park(at);
      trips.parked();
      if (!trip.walk && trip.target.kind !== 'parkride') flash(car ? 'Tu es arrivé. Ta voiture est enregistrée.' : 'Tu es arrivé');
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
          // Aucun état React à chaque mouvement : la carte qui suit la voiture ne redessine pas l'écran.
          const { bounds, center: next } = e.nativeEvent;
          data.look(bounds);
          if (distance(at(center), at(next)) > 300) setCenter(next);
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
        {trip && route?.controls && (trip.phase === 'preview' || trip.phase === 'drive') && <ControlLayer controls={route.controls} />}
        <ReportLayer
          reports={data.reports}
          onPress={(e) => {
            e.stopPropagation();
            const id = e.nativeEvent.features[0]?.properties?.id;
            if (typeof id === 'number') setReportId(id);
          }}
        />
        <PinImages dark={dark} />
        {/* En voiture, la flèche 3D au-dessus du tracé et des panneaux ; sinon le point bleu. */}
        {location.granted &&
          (trip?.phase === 'drive' && route ? (
            <DrivingPuck initialCourse={segmentBearing(route.coordinates, 0) ?? 0} />
          ) : (
            <UserLocation accuracy heading />
          ))}
        {trip && trip.target.kind !== 'dropoff' && (trip.phase === 'preview' || trip.phase === 'drive') && (
          <StopMarker target={trip.target} c={c} />
        )}
        {trip && <DestinationMarker at={trip.destination} c={c} />}
        {parked.car && <CarMarker at={parked.car} c={c} onPress={() => setCarOpen(true)} />}
      </Map>

      {!guiding && <StatusPill status={data.status} live={live} notice={notice} c={c} top={top} onRetry={data.reload} />}
      {!trip && <Filters value={category} onChange={setCategory} c={c} top={top} />}

      <View style={[styles.mapButtons, { bottom: (guiding ? 96 + insets.bottom : panelHeight) + espace[3] }]} pointerEvents="box-none">
        {trip?.phase !== 'preview' && (
          <MapButton
            c={c}
            label="Signaler un événement"
            onPress={() => {
              setReportFrom(guiding ? guideFix.current : null);
              setReporting(true);
            }}
          >
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
          stale={trip.stale}
          onReroute={trips.reroute}
          onFix={(f) => (guideFix.current = f)}
          onArrive={arrive}
          onClose={trips.end}
        />
      ) : (
        <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={styles.panelMeasure} pointerEvents="box-none">
          {trip?.phase === 'transit' && trip.target.kind === 'parkride' ? (
            <TransitCard relay={trip.target.relay} c={c} bottomInset={insets.bottom} onAlighted={trips.alighted} onClose={trips.end} />
          ) : trip ? (
            <TripPanel
              trip={trip}
              reports={data.reports}
              c={c}
              bottomInset={insets.bottom}
              avoid={trips.avoid}
              vehicle={trips.vehicle}
              zones={zones}
              onSelect={trips.select}
              onGo={(i) => {
                guideFix.current = null;
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

      <PlaceSheet selection={selection} onDismiss={() => setSelection(null)} onGo={goToSelection} />
      <CarSheet
        isPresented={carOpen}
        onDismiss={() => setCarOpen(false)}
        car={parked.car}
        me={location.position}
        here={here}
        onPark={parked.park}
        onForget={parked.forget}
        freed={freed && now - freed.since < FREED_FOR_MS ? freed : null}
        onReportFreed={reportFreed}
        onShow={(car) => {
          setCarOpen(false);
          camera.current?.flyTo({ center: [car.lon, car.lat], zoom: 17, duration: 800 });
        }}
      />
      <ReportSheet
        isPresented={reporting}
        onDismiss={() => setReporting(false)}
        position={reportFrom ? { ...reportFrom, source: 'gps' } : here}
        send={sendReport}
      />
      <ReportDetailSheet
        report={openReport}
        onDismiss={() => setReportId(null)}
        onVoted={(r, removed) => (removed ? data.removeReport(r.id) : data.upsertReport(r))}
      />
    </View>
  );
}

const PLACE: Record<Category, DataPlace> = { carburant: 'fuel', recharge: 'charge', stationnement: 'parkings' };

const at = ([lon, lat]: [number, number]): LatLon => ({ lat, lon });

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
      style={[styles.pillPosition, { top }]}
      accessibilityRole={status === 'error' ? 'button' : 'text'}
    >
      <Glass style={styles.pill}>
        <Text style={[texte.petit, { color: status === 'error' ? c.alerte.base : c.texte.secondaire }]}>{message}</Text>
      </Glass>
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
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Glass interactive style={styles.mapButton}>
        {props.children}
      </Glass>
    </Pressable>
  );
}

const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

const styles = StyleSheet.create({
  fill: { flex: 1 },
  mapButtons: { position: 'absolute', right: espace[4], gap: espace[3] },
  mapButton: { width: 48, height: 48, borderRadius: rayon.m, alignItems: 'center', justifyContent: 'center' },
  panelMeasure: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  pillPosition: { position: 'absolute', alignSelf: 'center' },
  pill: { paddingHorizontal: espace[4], paddingVertical: espace[2], borderRadius: rayon.pilule },
});
