import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Speech from 'expo-speech';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow } from '@/hooks/use-now';
import { useStored } from '@/hooks/use-stored';
import { areaFuel, areaName, nextArea } from '@/utils/areas';
import type { TripTarget } from '@/hooks/use-trip';
import { espace, police, rayon, type Couleurs } from '@/theme';
import { course, distance, formatDistance, keepFix, type Fix, type LatLon, type TimedFix } from '@/utils/geo';
import {
  arrival,
  cumulative,
  deviation,
  formatClock,
  formatDuration,
  progress,
  segmentBearing,
  voiceDue,
  type Lane,
  type Progress,
  type Route,
} from '@/utils/route';

import { laneIcon, maneuverIcon, maneuverSide } from './maneuver';

const ios = Platform.OS === 'ios';

const REROUTE_EVERY_MS = 15_000;
/** Au départ, le tracé peut commencer par un demi-tour : le contresens ne compte qu'ensuite (m parcourus). */
const WRONG_WAY_AFTER_M = 100;

/** Position précise pendant le guidage seulement (la carte d'accueil se contente d'une précision moyenne). */
function useNavigationFix() {
  const [fix, setFix] = useState<TimedFix | null>(null);
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 }, (l) => {
      const next = {
        lat: l.coords.latitude,
        lon: l.coords.longitude,
        heading: course(l.coords),
        accuracy: l.coords.accuracy,
        at: l.timestamp,
      };
      // Même objet si la position est écartée : rien ne se recalcule.
      setFix((prev) => keepFix(prev, next));
    })
      .then((s) => (cancelled ? s.remove() : (sub = s)))
      .catch(() => {
        // Localisation coupée : le bandeau garde la dernière manœuvre connue.
      });
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return fix;
}

type Props = {
  route: Route;
  phase: 'drive' | 'walk';
  target: TripTarget;
  c: Couleurs;
  top: number;
  bottomInset: number;
  rerouting: boolean;
  /** Tracé calculé pour un départ plus tard : recalculé dès la première position. */
  stale: boolean;
  onReroute: (from: Fix) => void;
  /** Chaque position retenue : les signalements partent d'ici, pas d'une position d'avant le départ. */
  onFix: (at: Fix) => void;
  onArrive: (at: LatLon) => void;
  onClose: () => void;
};

/** Guidage (maquettes 04 et 05c) : prochaine manœuvre en haut, temps restant en bas. */
export function Guidance(props: Props) {
  const { route, phase, target, c, top, bottomInset, rerouting, stale, onReroute, onFix, onArrive, onClose } = props;
  useKeepAwake();
  const fix = useNavigationFix();
  const now = useNow(10_000);
  const cum = useMemo(() => cumulative(route.coordinates), [route]);
  // Chaque position est placée en partant du segment de la précédente (même tracé seulement).
  const [last, setLast] = useState<{ fix: Fix; route: Route; p: Progress } | null>(null);
  const p = !fix
    ? null
    : last?.fix === fix && last.route === route
      ? last.p
      : progress(route, cum, fix, last?.route === route ? last.p.segment : undefined);
  if (fix && p && (last?.fix !== fix || last.route !== route)) setLast({ fix, route, p });
  const end = route.coordinates.at(-1);
  const where = fix && p && end ? arrival(phase, p.remaining, distance(fix, { lat: end[1], lon: end[0] }), fix.accuracy) : 'en-route';
  /** Distance parcourue, sur la même base que `remaining` (le tracé local, pas la distance de Valhalla). */
  const length = cum.at(-1) ?? 0;
  const traveled = length - (p?.remaining ?? length);

  /** Hauteur du bandeau (il grandit avec les voies) : « Puis » se place juste dessous. */
  const [bannerHeight, setBannerHeight] = useState(110);
  const offSince = useRef<number | null>(null);
  const lastReroute = useRef(0);
  const arrived = useRef<Route | null>(null);
  const [voiceOn, setVoiceOn] = useStored('zelo.voix', true);
  /** Annonces déjà traitées pour la manœuvre en cours. */
  const spoken = useRef({ route: null as Route | null, step: -1, done: 0 });
  useEffect(() => () => void Speech.stop(), []);

  useEffect(() => {
    if (!fix || !p) return;
    onFix(fix);
    if (where === 'arrived' && arrived.current !== route) {
      arrived.current = route;
      onArrive(fix);
      return;
    }
    const s = spoken.current;
    const same = s.route === route && s.step === p.next;
    const v = rerouting ? null : voiceDue(route.steps[p.next]?.voice, p.toNext, same ? s.done : 0);
    if (v) {
      spoken.current = { route, step: p.next, done: v.next };
      if (v.text && voiceOn) {
        void Speech.stop();
        Speech.speak(v.text, { language: 'fr-FR' });
      }
    }
    const bearing = traveled > WRONG_WAY_AFTER_M ? segmentBearing(route.coordinates, p.segment) : null;
    const d = deviation(offSince.current, p.offRoute, fix, bearing, Date.now());
    offSince.current = d.since;
    // Près du bout, hors du réseau routier (allées d'un parking), un recalcul échouerait ou tournerait en rond.
    const due = (stale || (d.reroute && where === 'en-route')) && !rerouting;
    if (due && Date.now() - lastReroute.current > REROUTE_EVERY_MS) {
      offSince.current = null;
      lastReroute.current = Date.now();
      onReroute(fix);
    }
    // Recalcul à chaque nouvelle position seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  const step = p ? route.steps[p.next] : route.steps[0];
  const then = p ? route.steps[p.next + 1] : undefined;
  const remaining = p?.remainingTime ?? route.duration;
  const eta = formatClock(new Date(now + remaining * 1000));
  const km = formatDistance(p?.remaining ?? route.distance);
  // Prochaine aire d'autoroute, à moins de 50 km : de quoi décider où s'arrêter.
  const area = phase === 'drive' ? nextArea(route.areas, traveled) : undefined;

  return (
    <>
      <View
        style={[styles.banner, { top }]}
        accessibilityLiveRegion="polite"
        onLayout={(e) => setBannerHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.bannerRow}>
          <SymbolView name={maneuverIcon(step?.type ?? 0)} tintColor="#FFFFFF" size={40} />
          <View style={styles.flex}>
            <Text style={styles.distance}>
              {rerouting ? 'Nouvel itinéraire…' : formatDistance(p?.toNext ?? step?.distance ?? 0)}
              {!rerouting && step?.control && <Text style={styles.control}>{` · ${CONTROL[step.control]}`}</Text>}
            </Text>
            <Text numberOfLines={2} style={styles.street}>
              {step?.street || step?.instruction || ''}
            </Text>
          </View>
        </View>
        {!rerouting && step?.lanes && <Lanes lanes={step.lanes} type={step.type} />}
      </View>
      {then && !rerouting && (
        <View style={[styles.then, { top: top + bannerHeight + espace[2] }]}>
          <Text style={styles.thenLabel}>Puis</Text>
          <SymbolView name={maneuverIcon(then.type)} tintColor="#FFFFFF" size={16} />
          <Text numberOfLines={1} style={styles.thenStreet}>
            {then.street ?? then.instruction}
          </Text>
        </View>
      )}

      {/* Le GPS ne suffit pas toujours à voir qu'on est garé : on peut le dire. */}
      {fix && where === 'near' && phase === 'drive' && target.kind !== 'dropoff' ? (
        <Pressable
          onPress={() => {
            arrived.current = route;
            onArrive(fix);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.area,
            styles.parked,
            { backgroundColor: c.action, bottom: bottomInset + espace[3] + 72 + espace[2], opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <SymbolView name={{ ios: 'parkingsign', android: 'local_parking' }} tintColor="#FFFFFF" size={18} />
          <Text style={styles.parkedText}>Je suis garé</Text>
        </Pressable>
      ) : area && (
        <View
          style={[styles.area, { backgroundColor: c.fond.surface, bottom: bottomInset + espace[3] + 72 + espace[2] }]}
          accessible
          accessibilityLabel={`Prochaine aire : ${areaName(area)}, dans ${formatDistance(area.along - traveled)}`}
        >
          <Text numberOfLines={1} style={[styles.areaName, { color: c.texte.principal }]}>
            {areaName(area)}
          </Text>
          <Text numberOfLines={1} style={[styles.areaFacts, { color: c.texte.secondaire }]}>
            {[formatDistance(area.along - traveled), areaFuel(area)].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      <View style={[styles.bar, { backgroundColor: c.fond.surface, bottom: bottomInset + espace[3] }]}>
        <View style={styles.flex}>
          <Text style={[styles.remaining, { color: c.recharge.base }]}>{formatDuration(remaining)}</Text>
          <Text style={[styles.eta, { color: c.texte.secondaire }]}>{`Vers ${eta} · ${km}`}</Text>
        </View>
        <View style={[styles.sep, { backgroundColor: c.fond.separateur }]} />
        <Stop phase={phase} target={target} c={c} />
        <Pressable
          onPress={() => {
            if (voiceOn) void Speech.stop();
            setVoiceOn(!voiceOn);
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceOn }}
          accessibilityLabel="Annonces vocales"
          hitSlop={8}
          style={({ pressed }) => [styles.close, { backgroundColor: c.fond.attenue, opacity: pressed ? 0.7 : 1 }]}
        >
          <SymbolView
            name={voiceOn ? { ios: 'speaker.wave.2.fill', android: 'volume_up' } : { ios: 'speaker.slash.fill', android: 'volume_off' }}
            tintColor={c.texte.principal}
            size={18}
          />
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Arrêter le guidage"
          hitSlop={8}
          style={({ pressed }) => [styles.close, { backgroundColor: c.fond.attenue, opacity: pressed ? 0.7 : 1 }]}
        >
          <SymbolView name={{ ios: 'xmark', android: 'close' }} tintColor={c.texte.principal} size={18} />
        </Pressable>
      </View>
    </>
  );
}

/** Voies à l'approche (comme sur les panneaux) : celles à prendre en blanc, les autres estompées. */
function Lanes({ lanes, type }: { lanes: Lane[]; type: number }) {
  const toward = maneuverSide(type);
  const take = lanes.filter((l) => l.take).length;
  return (
    <View
      style={styles.lanes}
      accessible
      accessibilityLabel={`${take} voie${take > 1 ? 's' : ''} sur ${lanes.length} pour cette manœuvre`}
    >
      {lanes.map((l, i) => (
        <SymbolView
          key={i}
          name={laneIcon(l.directions, toward)}
          tintColor={l.take ? '#FFFFFF' : 'rgba(255,255,255,0.3)'}
          size={26}
        />
      ))}
    </View>
  );
}

function Stop({ phase, target, c }: { phase: Props['phase']; target: TripTarget; c: Couleurs }) {
  if (phase === 'walk')
    return (
      <View style={styles.stop}>
        <SymbolView name={{ ios: 'figure.walk', android: 'directions_walk' }} tintColor={c.action} size={20} />
        <Text style={[styles.stopText, { color: c.texte.principal }]}>À pied</Text>
      </View>
    );
  if (target.kind === 'dropoff') return null;
  return (
    <View style={styles.stop}>
      <View style={[styles.tile, { backgroundColor: target.kind !== 'charge' ? c.stationnement.base : c.recharge.base }]}>
        {target.kind !== 'charge' ? (
          <Text style={styles.tileLetter}>P</Text>
        ) : (
          <SymbolView name={{ ios: 'bolt.fill', android: 'bolt' }} tintColor="#FFFFFF" size={13} />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.stopText, { color: c.texte.principal }]}>
        {target.item.name || (target.kind !== 'charge' ? 'Parking' : 'Borne')}
      </Text>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 };

const CONTROL = { feu: 'au feu', stop: 'au stop', cédez: 'au cédez-le-passage' } as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  banner: {
    position: 'absolute',
    left: espace[2],
    right: espace[2],
    backgroundColor: '#1C1B19',
    borderRadius: ios ? 28 : 24,
    paddingHorizontal: espace[5],
    paddingVertical: espace[4],
    ...shadow,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: espace[4] },
  distance: { color: '#FFFFFF', fontFamily: police, fontSize: 36, lineHeight: 42, fontWeight: '700', fontVariant: ['tabular-nums'] },
  street: { color: '#FFFFFF', fontFamily: police, fontSize: 20, lineHeight: 26, fontWeight: '500' },
  control: { color: 'rgba(255,255,255,0.7)', fontSize: 24, fontWeight: '600' },
  lanes: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: espace[4],
    marginTop: espace[3],
    paddingTop: espace[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  then: {
    position: 'absolute',
    left: espace[2],
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[2],
    backgroundColor: 'rgba(28,27,25,0.9)',
    borderRadius: rayon.s,
    paddingHorizontal: espace[3],
    paddingVertical: espace[2],
  },
  area: {
    position: 'absolute',
    left: espace[2],
    maxWidth: '80%',
    borderRadius: rayon.m,
    paddingHorizontal: espace[4],
    paddingVertical: espace[2],
    ...shadow,
  },
  parked: { flexDirection: 'row', alignItems: 'center', gap: espace[2], paddingVertical: espace[3] },
  parkedText: { color: '#FFFFFF', fontFamily: police, fontSize: 17, fontWeight: '600' },
  areaName: { fontFamily: police, fontSize: 15, fontWeight: '600' },
  areaFacts: { fontFamily: police, fontSize: 13, fontVariant: ['tabular-nums'] },
  thenLabel: { color: 'rgba(255,255,255,0.7)', fontFamily: police, fontSize: 14 },
  thenStreet: { color: '#FFFFFF', fontFamily: police, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  bar: {
    position: 'absolute',
    left: espace[2],
    right: espace[2],
    borderRadius: ios ? 28 : 24,
    paddingLeft: espace[5],
    paddingRight: espace[3],
    paddingVertical: espace[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[3],
    ...shadow,
  },
  remaining: { fontFamily: police, fontSize: 24, lineHeight: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
  eta: { fontFamily: police, fontSize: 13, fontVariant: ['tabular-nums'] },
  sep: { width: StyleSheet.hairlineWidth, height: 36 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 140 },
  stopText: { fontFamily: police, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  tile: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  tileLetter: { color: '#FFFFFF', fontFamily: police, fontSize: 14, fontWeight: '700' },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
