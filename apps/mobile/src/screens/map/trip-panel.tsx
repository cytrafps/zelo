import { MenuView } from '@expo/ui/community/menu';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import type { Avoid, Parking, Report, Vehicle } from '@/api/zelo';
import { useNow } from '@/hooks/use-now';
import { useStored } from '@/hooks/use-stored';
import type { Trip, TripTarget } from '@/hooks/use-trip';
import { espace, police, rayon, REPORT_META, texte, type Couleurs } from '@/theme';
import { areaCharge, areaFuel, areaName, areaServices } from '@/utils/areas';
import { linesLabel, relayDuration, stopName } from '@/utils/transit';
import { formatCents, formatStay } from '@/utils/format';
import { formatDistance, walkingMinutes } from '@/utils/geo';
import { along, cumulative, formatClock, formatDuration, type Area, type Route } from '@/utils/route';
import { forVehicle, sameTarget, targetPoint } from '@/utils/targets';
import { CRITAIR, critairLabel, localDay, refused, zoneAt, type Critair, type Zone } from '@/utils/zfe';

const ios = Platform.OS === 'ios';

/** Signalements qui comptent pour choisir un itinéraire. */
const BLOCKING = new Set<Report['kind']>(['accident', 'bouchon', 'travaux', 'obstacle', 'route_fermee']);

type Props = {
  trip: Trip;
  reports: Report[];
  c: Couleurs;
  bottomInset: number;
  onSelect: (i: number) => void;
  onGo: (i: number) => void;
  avoid: readonly Avoid[];
  vehicle: Vehicle;
  /** Zones à faibles émissions autour de la destination. */
  zones: readonly Zone[];
  onChange: (change: { target?: TripTarget; depart?: number | null; avoid?: Avoid[]; vehicle?: Vehicle }) => void;
  onClose: () => void;
};

/** Départs proposés, en minutes à partir de maintenant (0 : maintenant). */
const DEPARTS = [0, 15, 30, 60, 120];

/** Aperçu du trajet (maquettes 03 et 03b) : où se garer, puis les itinéraires et « Y aller ». */
export function TripPanel({ trip, reports, c, bottomInset, onSelect, onGo, avoid, vehicle, zones, onChange, onClose }: Props) {
  const bike = vehicle === 'bike';
  // Les arrêts qui valent pour ce véhicule (arceaux à vélo, places motos d'abord à moto).
  const options = forVehicle(trip.options, vehicle);
  const [choosing, setChoosing] = useState(false);
  const now = useNow();
  // Heure de départ : choisie, ou maintenant.
  const start = trip.depart ?? now;
  const walkTime = trip.walk?.duration ?? 0;
  /** Après la conduite : la marche, ou par le relais la marche au quai, l'attente, le tram et la marche finale. */
  const afterDrive = (r: Route) => {
    const t = trip.target;
    if (t.kind !== 'parkride') return walkTime;
    return relayDuration(t.relay.journeys, start + r.duration * 1000, walkTime) ?? walkTime;
  };

  const share = () => {
    const route = trip.routes[trip.selected];
    if (!route) return;
    const eta = formatClock(new Date((trip.depart ?? Date.now()) + (route.duration + afterDrive(route)) * 1000));
    void Share.share({ message: `J'arrive à ${trip.destination.name} vers ${eta}.` });
  };

  return (
    <View
      style={[
        ios ? styles.cardIos : styles.cardAndroid,
        { backgroundColor: c.fond.surface, paddingBottom: espace[4] + (ios ? 0 : bottomInset) },
        ios && { marginBottom: Math.max(espace[2], bottomInset - espace[3]) },
      ]}
    >
      <View style={[styles.handle, { backgroundColor: c.fond.separateur }]} />
      <View style={styles.header}>
        <Text numberOfLines={1} style={[texte.titre, styles.title, { color: c.texte.principal }]}>
          {trip.destination.name}
        </Text>
        <RoundButton c={c} label="Partager mon heure d'arrivée" icon={{ ios: 'square.and.arrow.up', android: 'share' }} onPress={share} />
        <RoundButton c={c} label="Fermer" icon={{ ios: 'xmark', android: 'close' }} onPress={onClose} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
        <MenuView
          title="Véhicule"
          actions={VEHICLES.map(([id, title]) => ({ id, title, state: id === vehicle ? 'on' : 'off' }))}
          onPressAction={(e) => {
            const id = e.nativeEvent.event as Vehicle;
            if (id !== vehicle) onChange({ vehicle: id });
          }}
        >
          <View style={[styles.chip, { borderColor: c.fond.separateur }]} accessibilityRole="button" accessibilityLabel="Véhicule">
            <SymbolView name={VEHICLE_ICON[vehicle]} tintColor={c.texte.principal} size={16} />
            <Text style={[texte.corpsFort, { color: c.texte.principal }]}>{VEHICLES.find(([id]) => id === vehicle)?.[1]}</Text>
            <Chevron c={c} />
          </View>
        </MenuView>

        {/* Sans choix d'arrêt (« Y aller » vers une station, ou rien à proposer), pas de puce. */}
        {(trip.target.kind !== 'dropoff' || options.length > 1) && (
          <Pressable
            onPress={() => setChoosing((v) => !v)}
            disabled={options.length < 2}
            accessibilityRole="button"
            accessibilityLabel="Choisir où se garer"
            style={[styles.chip, { borderColor: c.fond.separateur }]}
          >
            <TargetIcon t={trip.target} c={c} size={16} />
            <Text numberOfLines={1} style={[texte.corpsFort, styles.chipText, { color: c.texte.principal }]}>
              {short(trip.target)}
            </Text>
            {options.length > 1 && <Chevron c={c} />}
          </Pressable>
        )}

        <MenuView
          title="Départ"
          actions={DEPARTS.map((m) => ({
            id: String(m),
            title: m === 0 ? 'Maintenant' : `Dans ${m < 60 ? `${m} min` : `${m / 60} h`}`,
          }))}
          onPressAction={(e) => {
            const m = Number(e.nativeEvent.event);
            onChange({ depart: m === 0 ? null : Date.now() + m * 60_000 });
          }}
        >
          <View style={[styles.chip, { borderColor: c.fond.separateur }]} accessibilityRole="button" accessibilityLabel="Heure de départ">
            <Text style={[texte.corpsFort, { color: c.texte.principal }]}>
              {trip.depart === null ? 'Maintenant' : `Départ ${formatClock(new Date(trip.depart))}`}
            </Text>
            <Chevron c={c} />
          </View>
        </MenuView>

        {!bike && (
          <MenuView
            title="Éviter"
            actions={AVOID.map(([id, title]) => ({ id, title, state: avoid.includes(id) ? 'on' : 'off' }))}
            onPressAction={(e) => {
              const id = e.nativeEvent.event as Avoid;
              onChange({ avoid: avoid.includes(id) ? avoid.filter((a) => a !== id) : [...avoid, id] });
            }}
          >
            <View
              style={[styles.chip, { borderColor: avoid.length ? c.action : c.fond.separateur }]}
              accessibilityRole="button"
              accessibilityLabel="Éviter les péages ou les autoroutes"
            >
              <Text style={[texte.corpsFort, { color: avoid.length ? c.action : c.texte.principal }]}>{avoidLabel(avoid)}</Text>
              <Chevron c={c} />
            </View>
          </MenuView>
        )}
      </ScrollView>

      {!choosing && (
        <ZfeNotice
          zones={zones}
          trip={trip}
          vehicle={vehicle}
          options={options}
          day={localDay(start)}
          c={c}
          onPark={(target) => onChange({ target })}
        />
      )}

      {choosing ? (
        <View style={styles.list}>
          <Text style={[texte.petit, styles.caption, { color: c.texte.secondaire }]}>À l’arrivée</Text>
          {options.map((t) => {
            const on = sameTarget(t, trip.target);
            return (
              <Pressable
                key={t.kind === 'dropoff' ? 'dropoff' : `${t.kind}-${t.item.id}`}
                onPress={() => {
                  setChoosing(false);
                  if (!on) onChange({ target: t });
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.option, (on || pressed) && { backgroundColor: c.fond.attenue }]}
              >
                <TargetIcon t={t} c={c} size={20} />
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={[texte.corps, { color: c.texte.principal }]}>
                    {title(t)}
                  </Text>
                  <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire }]}>
                    {detail(t)}
                  </Text>
                </View>
                {on && <SymbolView name={{ ios: 'checkmark', android: 'check' }} tintColor={c.texte.principal} size={18} />}
              </Pressable>
            );
          })}
        </View>
      ) : trip.error ? (
        <Text style={[texte.corps, styles.message, { color: c.alerte.base }]}>{trip.error}</Text>
      ) : trip.loading && trip.routes.length === 0 ? (
        <ActivityIndicator style={styles.message} color={c.texte.tertiaire} />
      ) : (
        <ScrollView style={styles.routes} bounces={false}>
          {trip.routes.map((r, i) => (
            <RouteRow
              key={i}
              route={r}
              walk={afterDrive(r)}
              now={start}
              reports={reports}
              selected={i === trip.selected}
              first={i === 0}
              c={c}
              onPress={() => onSelect(i)}
              onGo={() => onGo(i)}
            />
          ))}
          <Areas areas={trip.routes[trip.selected]?.areas} c={c} />
        </ScrollView>
      )}
    </View>
  );
}

/**
 * ZFE : là où la voiture s'arrête (parking, borne, relais, ou la destination pour une dépose)
 * est-il interdit à sa vignette ? On la demande une fois (elle reste sur le téléphone), puis on
 * propose de se garer hors zone.
 */
function ZfeNotice(props: {
  zones: readonly Zone[];
  trip: Trip;
  vehicle: Vehicle;
  options: TripTarget[];
  day: string;
  c: Couleurs;
  onPark: (t: TripTarget) => void;
}) {
  const { zones, trip, vehicle, options, day, c, onPark } = props;
  const [vignette, setVignette] = useStored<Critair | null>('zelo.critair', null);
  const [editing, setEditing] = useState(false);
  if (vehicle === 'bike') return null;
  const zone = zoneAt(zones, targetPoint(trip.target, trip.destination), day);
  const rule = zone?.[vehicle === 'moto' ? 'moto' : 'car'];
  if (!zone || !rule) return null;

  if (!vignette || editing)
    return (
      <View style={styles.zfe}>
        <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>{`Ton arrêt est dans la ${zone.name}. Ta vignette Crit'Air ?`}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {CRITAIR.map((v) => (
            <Pressable
              key={v}
              onPress={() => {
                setVignette(v);
                setEditing(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: v === vignette }}
              style={[styles.chip, { borderColor: v === vignette ? c.action : c.fond.separateur }]}
            >
              <Text style={[texte.corpsFort, { color: c.texte.principal }]}>{v === 'EL' ? 'Électrique' : v === 'NC' ? 'Sans' : v.slice(1)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );

  if (!refused(vignette, rule)) return null;
  const inZone = (t: TripTarget) => zoneAt([zone], targetPoint(t, trip.destination), day) !== undefined;
  // Hors zone : le parking relais d'abord (on finit en tram ou en bus), puis le plus proche.
  const outside = [...options.filter((t) => t.kind === 'parkride'), ...options].find((t) => t.kind !== 'dropoff' && !inZone(t));
  const hours = rule.hours && rule.hours !== '24/7' ? ` (${rule.hours})` : '';
  return (
    <View style={[styles.zfe, { backgroundColor: c.fond.attenue }]}>
      <Text style={[texte.corps, { color: c.alerte.base }]}>
        {`${critairLabel(vignette)} : interdite dans la ${zone.name}${hours}.`}
      </Text>
      <View style={styles.zfeActions}>
        {outside && (
          <Pressable onPress={() => onPark(outside)} accessibilityRole="button" style={[styles.chip, { borderColor: c.action }]}>
            <Text numberOfLines={1} style={[texte.corpsFort, styles.chipText, { color: c.action }]}>{`Me garer hors zone : ${short(outside)}`}</Text>
          </Pressable>
        )}
        {zone.url && (
          <Pressable onPress={() => void Linking.openURL(zone.url!)} accessibilityRole="link" hitSlop={8}>
            <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>Dérogations</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
          <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>Changer de vignette</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RouteRow(props: {
  route: Route;
  walk: number;
  now: number;
  reports: Report[];
  selected: boolean;
  first: boolean;
  c: Couleurs;
  onPress: () => void;
  onGo: () => void;
}) {
  const { route, walk, now, reports, selected, first, c, onPress, onGo } = props;
  // Le premier signalement gênant rencontré sur ce trajet.
  const hit = useMemo(() => {
    const cum = cumulative(route.coordinates);
    return along(route, cum, reports.filter((r) => BLOCKING.has(r.kind))).sort((a, b) => a.along - b.along)[0];
  }, [route, reports]);
  const eta = formatClock(new Date(now + (route.duration + walk) * 1000));
  const km = (route.distance / 1000).toFixed(1).replace('.', ',');

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.route, !first && { borderTopColor: c.fond.separateur, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.flex}>
        <Text style={[styles.duration, { color: c.texte.principal }]}>{formatDuration(route.duration + walk)}</Text>
        <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>{`Arrivée ${eta} · ${km} km`}</Text>
        {!!route.areas?.length && (
          <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire }]}>
            {`${route.areas.length} aire${route.areas.length > 1 ? 's' : ''} · première à ${formatDistance(route.areas[0].along)}`}
          </Text>
        )}
        {hit && (
          <View style={styles.report}>
            <View style={[styles.dot, { backgroundColor: REPORT_META[hit.item.kind].couleur }]} />
            <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire }]}>
              {REPORT_META[hit.item.kind].label + (hit.street ? ` · ${hit.street}` : '')}
            </Text>
          </View>
        )}
      </View>
      <Pressable
        onPress={onGo}
        accessibilityRole="button"
        accessibilityLabel={`Y aller, ${formatDuration(route.duration + walk)}`}
        style={({ pressed }) => [
          styles.go,
          { backgroundColor: selected ? c.texte.principal : c.fond.attenue, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[texte.corpsFort, { color: selected ? c.texte.inverse : c.texte.principal }]}>Y aller</Text>
      </Pressable>
    </Pressable>
  );
}

/** Aires du trajet choisi : où s'arrêter, ce qu'on y trouve, le prix du plein et les bornes libres. */
function Areas({ areas, c }: { areas: Area[] | undefined; c: Couleurs }) {
  if (!areas?.length) return null;
  return (
    <View style={[styles.areas, { borderTopColor: c.fond.separateur }]}>
      <Text style={[texte.petit, styles.caption, { color: c.texte.secondaire }]}>Aires sur le trajet</Text>
      {areas.map((a) => {
        const facts = [formatDistance(a.along), areaFuel(a), areaCharge(a)].filter(Boolean).join(' · ');
        return (
          <View key={a.id} style={styles.area} accessible accessibilityLabel={`${areaName(a)}, ${facts}. ${areaServices(a)}`}>
            <Text numberOfLines={1} style={[texte.corpsFort, { color: c.texte.principal }]}>
              {areaName(a)}
            </Text>
            <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire, fontVariant: ['tabular-nums'] }]}>
              {facts}
            </Text>
            {a.services.length > 0 && (
              <Text numberOfLines={2} style={[texte.secondaire, { color: c.texte.secondaire }]}>
                {areaServices(a)}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Chevron({ c }: { c: Couleurs }) {
  return <SymbolView name={{ ios: 'chevron.down', android: 'expand_more' }} tintColor={c.texte.secondaire} size={14} />;
}

const VEHICLES: [Vehicle, string][] = [
  ['car', 'Voiture'],
  ['moto', 'Moto'],
  ['bike', 'Vélo'],
];

const VEHICLE_ICON: Record<Vehicle, SymbolViewProps['name']> = {
  car: { ios: 'car.fill', android: 'directions_car' },
  moto: { ios: 'motorcycle', android: 'two_wheeler' },
  bike: { ios: 'bicycle', android: 'directions_bike' },
};

const AVOID: [Avoid, string][] = [
  ['tolls', 'Péages'],
  ['highways', 'Autoroutes'],
];

function avoidLabel(avoid: readonly Avoid[]) {
  const tolls = avoid.includes('tolls');
  const highways = avoid.includes('highways');
  if (tolls && highways) return 'Sans péage ni autoroute';
  if (tolls) return 'Sans péage';
  if (highways) return 'Sans autoroute';
  return 'Éviter';
}

function RoundButton(props: { c: Couleurs; label: string; icon: { ios: 'xmark' | 'square.and.arrow.up'; android: 'close' | 'share' }; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={6}
      style={({ pressed }) => [styles.round, { backgroundColor: props.c.fond.attenue, opacity: pressed ? 0.7 : 1 }]}
    >
      <SymbolView name={props.icon} tintColor={props.c.texte.principal} size={16} />
    </Pressable>
  );
}

function TargetIcon({ t, c, size }: { t: TripTarget; c: Couleurs; size: number }) {
  if (t.kind === 'parkride') {
    const first = t.relay.journeys[0]?.legs.find((l) => l.line)?.line;
    const icon = first?.mode === 'bus' ? ({ ios: 'bus.fill', android: 'directions_bus' } as const) : ({ ios: 'tram.fill', android: 'tram' } as const);
    return <SymbolView name={icon} tintColor={first ? `#${first.color}` : c.texte.secondaire} size={size} />;
  }
  if (t.kind === 'parking' && t.item.vehicle === 'bike') return <SymbolView name={{ ios: 'bicycle', android: 'pedal_bike' }} tintColor={c.stationnement.base} size={size} />;
  if (t.kind === 'parking' && t.item.vehicle === 'moto') return <SymbolView name={{ ios: 'motorcycle', android: 'two_wheeler' }} tintColor={c.stationnement.base} size={size} />;
  if (t.kind === 'parking') return <Text style={{ color: c.stationnement.base, fontFamily: police, fontSize: size, fontWeight: '700' }}>P</Text>;
  if (t.kind === 'charge') return <SymbolView name={{ ios: 'bolt.fill', android: 'bolt' }} tintColor={c.recharge.base} size={size} />;
  return <SymbolView name={{ ios: 'car.fill', android: 'directions_car' }} tintColor={c.texte.secondaire} size={size} />;
}

/** Nom d'un parking, ou de ce qu'il est quand OSM ne le nomme pas (arceaux, places motos). */
const parkingName = (p: Parking) => p.name || (p.vehicle === 'bike' ? 'Arceaux vélo' : p.vehicle === 'moto' ? 'Places motos' : 'Parking');

const short = (t: TripTarget) =>
  t.kind === 'dropoff'
    ? 'Dépose'
    : t.kind === 'parkride'
      ? 'Relais + transports'
      : t.kind === 'parking'
        ? parkingName(t.item)
        : t.item.name || 'Borne';

const title = (t: TripTarget) =>
  t.kind === 'dropoff'
    ? 'Me déposer à l’entrée'
    : t.kind === 'parking'
      ? parkingName(t.item)
      : t.kind === 'parkride'
        ? `${t.item.name || 'Parking relais'} + ${t.relay.journeys[0] ? linesLabel(t.relay.journeys[0]).toLowerCase() : 'transports'}`
        : `${t.item.name || 'Borne'} · ${Math.round(t.item.maxPowerKw)} kW`;

function detail(t: TripTarget) {
  if (t.kind === 'dropoff') return 'Pas de stationnement';
  const walk = `${walkingMinutes(t.walk)} min à pied`;
  if (t.kind === 'parkride') {
    const j = t.relay.journeys[0];
    return j ? `${linesLabel(j)} jusqu'à ${stopName(j.legs.at(-1)!.to.name)}, puis ${walk}` : walk;
  }
  if (t.kind === 'charge') return `${t.item.available} libre${(t.item.available ?? 0) > 1 ? 's' : ''} · ${walk}`;
  if (t.kind === 'parking' && t.item.vehicle !== 'car') {
    const places = t.item.capacity ? `${t.item.capacity} places` : null;
    return [places, t.item.covered ? 'Abrité' : null, walk].filter(Boolean).join(' · ');
  }
  const first = t.item.tariff?.prices[0];
  if (first) return `${formatStay(first.minutes)} : ${formatCents(first.cents)} · ${walk}`;
  return t.item.fee === false ? `Gratuit · ${walk}` : walk;
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: -2 }, elevation: 8 };

const styles = StyleSheet.create({
  zfe: { marginHorizontal: espace[4], marginBottom: espace[2], padding: espace[3], borderRadius: rayon.s, gap: espace[2] },
  zfeActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: espace[3] },
  cardIos: { marginHorizontal: espace[2], borderRadius: 34, paddingHorizontal: espace[4], ...shadow },
  cardAndroid: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: espace[4], ...shadow },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: espace[2], marginBottom: espace[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: espace[2] },
  title: { flex: 1 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  chips: { marginTop: espace[3], marginHorizontal: -espace[4], flexGrow: 0 },
  chipsRow: { gap: espace[2], paddingHorizontal: espace[4] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[2],
    height: 36,
    paddingHorizontal: espace[3],
    borderRadius: rayon.s,
    borderWidth: 1,
  },
  chipText: { maxWidth: 200 },
  list: { marginTop: espace[3] },
  caption: { marginBottom: espace[1] },
  option: { flexDirection: 'row', alignItems: 'center', gap: espace[3], paddingHorizontal: espace[3], paddingVertical: espace[2], borderRadius: rayon.s },
  message: { paddingVertical: espace[5] },
  routes: { maxHeight: 360, marginTop: espace[2] },
  areas: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: espace[3], marginTop: espace[1] },
  area: { paddingVertical: espace[2], gap: 2 },
  route: { flexDirection: 'row', alignItems: 'center', gap: espace[3], paddingVertical: espace[3] },
  flex: { flex: 1 },
  duration: { fontFamily: police, fontSize: 22, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] },
  report: { flexDirection: 'row', alignItems: 'center', gap: espace[2], marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  go: { height: 44, paddingHorizontal: espace[5], borderRadius: rayon.pilule, alignItems: 'center', justifyContent: 'center' },
});

