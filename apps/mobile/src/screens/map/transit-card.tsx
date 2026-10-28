import { SymbolView } from 'expo-symbols';
import { Fragment } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ParkRide, TransitLine } from '@/api/zelo';
import { useNow } from '@/hooks/use-now';
import { espace, police, rayon, texte, type Couleurs } from '@/theme';
import { formatDistance } from '@/utils/geo';
import { formatClock } from '@/utils/route';
import { nextJourney, rides, titleCase } from '@/utils/transit';

const ios = Platform.OS === 'ios';
const clock = (iso: string) => formatClock(new Date(iso));

type Props = { relay: ParkRide; c: Couleurs; bottomInset: number; onAlighted: () => void; onClose: () => void };

/** Garé au parking relais : les trams et bus à prendre, les correspondances, puis la marche reprend. */
export function TransitCard({ relay, c, bottomInset, onAlighted, onClose }: Props) {
  const now = useNow(10_000);
  const journey = nextJourney(relay.journeys, now);
  const next = journey ? relay.journeys[relay.journeys.indexOf(journey) + 1] : undefined;
  const first = journey ? rides(journey)[0] : undefined;
  const wait = first ? Math.max(0, Math.round((Date.parse(first.depart) - now) / 60_000)) : 0;

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
        <Text numberOfLines={1} style={[texte.corpsFort, styles.flex, { color: c.texte.principal }]}>
          {first ? `${first.line.mode === 'tram' ? 'Tram' : `Bus ${first.line.name}`} vers ${titleCase(first.headsign ?? '')}` : 'Plus de départ dans les deux heures'}
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

      {journey && first && (
        <>
          <Text style={[styles.depart, { color: c.texte.principal }]}>
            {clock(first.depart)}
            <Text style={[styles.wait, { color: `#${first.line.color}` }]}>{wait === 0 ? '  à quai' : `  dans ${wait} min`}</Text>
          </Text>
          <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>
            {`Arrêt ${titleCase(first.from.name)} · ${formatDistance(journey.boardWalk)} à pied`}
            {next ? ` · suivant ${clock(rides(next)[0]?.depart ?? next.legs[0].depart)}` : ''}
          </Text>

          <View style={styles.legs}>
            {journey.legs.map((l, i) => (
              <Fragment key={i}>
                {l.line ? (
                  <View style={styles.leg}>
                    <Badge line={l.line} />
                    <Text numberOfLines={2} style={[texte.secondaire, styles.flex, { color: c.texte.principal }]}>
                      {`${titleCase(l.from.name)} → ${titleCase(l.to.name)}`}
                      <Text style={{ color: c.texte.secondaire }}>{` · ${l.stops} arrêts · ${clock(l.depart)}–${clock(l.arrive)}`}</Text>
                    </Text>
                  </View>
                ) : (
                  <View style={styles.leg}>
                    <SymbolView name={{ ios: 'figure.walk', android: 'directions_walk' }} tintColor={c.texte.secondaire} size={18} />
                    <Text numberOfLines={1} style={[texte.secondaire, styles.flex, { color: c.texte.secondaire }]}>
                      {`Correspondance à pied jusqu'à ${titleCase(l.to.name)}`}
                    </Text>
                  </View>
                )}
              </Fragment>
            ))}
          </View>
          <Text style={[texte.secondaire, { color: c.texte.secondaire }]}>{`Arrivée vers ${clock(journey.arrive)}`}</Text>
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

/** Pastille de ligne aux couleurs du réseau : « TRAM », « O2 ». */
function Badge({ line }: { line: TransitLine }) {
  return (
    <View style={[styles.badge, { backgroundColor: `#${line.color}` }]} accessibilityLabel={line.mode === 'tram' ? 'Tram' : `Bus ${line.name}`}>
      <SymbolView
        name={line.mode === 'tram' ? { ios: 'tram.fill', android: 'tram' } : { ios: 'bus.fill', android: 'directions_bus' }}
        tintColor={`#${line.textColor || 'FFFFFF'}`}
        size={13}
      />
      {line.mode === 'bus' && <Text style={[styles.badgeText, { color: `#${line.textColor || 'FFFFFF'}` }]}>{line.name}</Text>}
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: -2 }, elevation: 8 };

const styles = StyleSheet.create({
  cardIos: { marginHorizontal: espace[2], borderRadius: 34, padding: espace[4], ...shadow },
  cardAndroid: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: espace[4], ...shadow },
  header: { flexDirection: 'row', alignItems: 'center', gap: espace[3] },
  flex: { flex: 1 },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  depart: { fontFamily: police, fontSize: 34, lineHeight: 40, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: espace[3] },
  wait: { fontSize: 20, fontWeight: '600' },
  legs: { gap: espace[2], marginVertical: espace[3] },
  leg: { flexDirection: 'row', alignItems: 'center', gap: espace[2] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, minWidth: 30, paddingHorizontal: 6, borderRadius: 6, justifyContent: 'center' },
  badgeText: { fontFamily: police, fontSize: 13, fontWeight: '700' },
  button: { height: 50, borderRadius: rayon.pilule, alignItems: 'center', justifyContent: 'center', marginTop: espace[2] },
});
