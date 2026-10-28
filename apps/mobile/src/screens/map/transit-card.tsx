import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ParkRide } from '@/api/zelo';
import { useNow } from '@/hooks/use-now';
import { espace, police, rayon, texte, type Couleurs } from '@/theme';
import { formatDistance } from '@/utils/geo';
import { formatClock } from '@/utils/route';
import { nextRide, titleCase } from '@/utils/transit';

const ios = Platform.OS === 'ios';

type Props = { relay: ParkRide; c: Couleurs; bottomInset: number; onAlighted: () => void; onClose: () => void };

/** Garé au parking relais : quel tram prendre, où descendre, puis la marche reprend. */
export function TransitCard({ relay, c, bottomInset, onAlighted, onClose }: Props) {
  const now = useNow(10_000);
  const ride = nextRide(relay.rides, now);
  const after = ride ? relay.rides[relay.rides.indexOf(ride) + 1] : undefined;
  const wait = ride ? Math.max(0, Math.round((Date.parse(ride.depart) - now) / 60_000)) : 0;
  const color = `#${relay.line.color}`;

  return (
    <View
      style={[
        ios ? styles.cardIos : styles.cardAndroid,
        { backgroundColor: c.fond.surface, paddingBottom: espace[4] + (ios ? 0 : bottomInset) },
        ios && { marginBottom: Math.max(espace[2], bottomInset - espace[3]) },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: color }]}>
          <SymbolView name={{ ios: 'tram.fill', android: 'tram' }} tintColor={`#${relay.line.textColor || 'FFFFFF'}`} size={16} />
        </View>
        <Text numberOfLines={1} style={[texte.corpsFort, styles.flex, { color: c.texte.principal }]}>
          {ride ? `Tram vers ${titleCase(ride.headsign)}` : 'Plus de tram dans les deux heures'}
        </Text>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Arrêter le trajet"
          hitSlop={6}
          style={({ pressed }) => [styles.round, { backgroundColor: c.fond.attenue, opacity: pressed ? 0.7 : 1 }]}
        >
          <SymbolView name={{ ios: 'xmark', android: 'close' }} tintColor={c.texte.principal} size={16} />
        </Pressable>
      </View>

      {ride && (
        <>
          <Text style={[styles.depart, { color: c.texte.principal }]}>
            {formatClock(new Date(ride.depart))}
            <Text style={[styles.wait, { color: color }]}>{wait === 0 ? '  à quai' : `  dans ${wait} min`}</Text>
          </Text>
          <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>
            {`Quai ${titleCase(relay.board.name)} · ${formatDistance(relay.board.walk)} à pied`}
            {after ? ` · suivant ${formatClock(new Date(after.depart))}` : ''}
          </Text>
          <Text style={[texte.secondaire, styles.alight, { color: c.texte.secondaire }]}>
            {`Descendre à ${titleCase(relay.alight.name)} · ${ride.stops} arrêts · ${formatClock(new Date(ride.arrive))}`}
          </Text>
        </>
      )}

      <Pressable
        onPress={onAlighted}
        accessibilityRole="button"
        style={({ pressed }) => [styles.button, { backgroundColor: c.texte.principal, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[texte.corpsFort, { color: c.texte.inverse }]}>Je suis descendu</Text>
      </Pressable>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: -2 }, elevation: 8 };

const styles = StyleSheet.create({
  cardIos: { marginHorizontal: espace[2], borderRadius: 34, padding: espace[4], ...shadow },
  cardAndroid: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: espace[4], ...shadow },
  header: { flexDirection: 'row', alignItems: 'center', gap: espace[3] },
  flex: { flex: 1 },
  badge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  depart: { fontFamily: police, fontSize: 34, lineHeight: 40, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: espace[3] },
  wait: { fontSize: 20, fontWeight: '600' },
  alight: { marginTop: espace[1] },
  button: { height: 50, borderRadius: rayon.pilule, alignItems: 'center', justifyContent: 'center', marginTop: espace[4] },
});
