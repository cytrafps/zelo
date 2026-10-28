import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNow } from '@/hooks/use-now';
import type { Phase, TripTarget } from '@/hooks/use-trip';
import { espace, police, rayon, type Couleurs } from '@/theme';
import { course, formatDistance, type Fix, type LatLon } from '@/utils/geo';
import { cumulative, formatClock, formatDuration, progress, type Progress, type Route } from '@/utils/route';

import { maneuverIcon } from './maneuver';

const ios = Platform.OS === 'ios';

/** Au-delà, on considère qu'on a quitté l'itinéraire (deux positions de suite, pour ignorer un saut GPS). */
const OFF_ROUTE_M = 50;
const REROUTE_EVERY_MS = 15_000;
/** Arrivé quand il reste moins que ça. */
const ARRIVED_M = { drive: 30, walk: 15 } as const;

/** Position précise pendant le guidage seulement (la carte d'accueil se contente d'une précision moyenne). */
function useNavigationFix() {
  const [fix, setFix] = useState<Fix | null>(null);
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 }, (l) =>
      setFix({ lat: l.coords.latitude, lon: l.coords.longitude, heading: course(l.coords) }),
    )
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
  phase: Exclude<Phase, 'preview'>;
  target: TripTarget;
  c: Couleurs;
  top: number;
  bottomInset: number;
  rerouting: boolean;
  onReroute: (from: Fix) => void;
  onArrive: (at: LatLon) => void;
  onClose: () => void;
};

/** Guidage (maquettes 04 et 05c) : prochaine manœuvre en haut, temps restant en bas. */
export function Guidance({ route, phase, target, c, top, bottomInset, rerouting, onReroute, onArrive, onClose }: Props) {
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

  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const arrived = useRef<Route | null>(null);

  useEffect(() => {
    if (!fix || !p) return;
    if (p.remaining < ARRIVED_M[phase] && arrived.current !== route) {
      arrived.current = route;
      onArrive(fix);
      return;
    }
    offCount.current = p.offRoute > OFF_ROUTE_M ? offCount.current + 1 : 0;
    if (offCount.current >= 2 && Date.now() - lastReroute.current > REROUTE_EVERY_MS) {
      offCount.current = 0;
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

  return (
    <>
      <View style={[styles.banner, { top }]} accessibilityLiveRegion="polite">
        <View style={styles.bannerRow}>
          <SymbolView name={maneuverIcon(step?.type ?? 0)} tintColor="#FFFFFF" size={40} />
          <View style={styles.flex}>
            <Text style={styles.distance}>{rerouting ? 'Nouvel itinéraire…' : formatDistance(p?.toNext ?? step?.distance ?? 0)}</Text>
            <Text numberOfLines={2} style={styles.street}>
              {step?.street ?? step?.instruction ?? ''}
            </Text>
          </View>
        </View>
      </View>
      {then && !rerouting && (
        <View style={[styles.then, { top: top + 118 }]}>
          <Text style={styles.thenLabel}>Puis</Text>
          <SymbolView name={maneuverIcon(then.type)} tintColor="#FFFFFF" size={16} />
          <Text numberOfLines={1} style={styles.thenStreet}>
            {then.street ?? then.instruction}
          </Text>
        </View>
      )}

      <View style={[styles.bar, { backgroundColor: c.fond.surface, bottom: bottomInset + espace[3] }]}>
        <View style={styles.flex}>
          <Text style={[styles.remaining, { color: c.recharge.base }]}>{formatDuration(remaining)}</Text>
          <Text style={[styles.eta, { color: c.texte.secondaire }]}>{`${eta} · ${km}`}</Text>
        </View>
        <View style={[styles.sep, { backgroundColor: c.fond.separateur }]} />
        <Stop phase={phase} target={target} c={c} />
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
      <View style={[styles.tile, { backgroundColor: target.kind === 'parking' ? c.stationnement.base : c.recharge.base }]}>
        {target.kind === 'parking' ? (
          <Text style={styles.tileLetter}>P</Text>
        ) : (
          <SymbolView name={{ ios: 'bolt.fill', android: 'bolt' }} tintColor="#FFFFFF" size={13} />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.stopText, { color: c.texte.principal }]}>
        {target.item.name || (target.kind === 'parking' ? 'Parking' : 'Borne')}
      </Text>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6 };

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
