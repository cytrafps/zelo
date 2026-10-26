import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import type { Couleurs } from '@/theme';
import type { LatLon } from '@/utils/geo';

// Deux marqueurs au plus : des vues React suffisent (les centaines de points restent en couches GeoJSON).

export function DestinationMarker({ at, c }: { at: LatLon; c: Couleurs }) {
  return (
    <ViewAnnotation id="destination" lngLat={[at.lon, at.lat]} anchor="bottom">
      <View style={styles.pinWrap}>
        <View style={[styles.pin, { backgroundColor: c.action }]}>
          <SymbolView name={{ ios: 'flag.fill', android: 'flag' }} tintColor="#FFFFFF" size={16} />
        </View>
        <View style={[styles.tip, { borderTopColor: c.action }]} />
      </View>
    </ViewAnnotation>
  );
}

export function CarMarker({ at, c, onPress }: { at: LatLon; c: Couleurs; onPress: () => void }) {
  return (
    <ViewAnnotation id="voiture" lngLat={[at.lon, at.lat]} onPress={onPress}>
      <View style={[styles.car, { backgroundColor: c.fond.surface, borderColor: c.action }]}>
        <SymbolView name={{ ios: 'car.fill', android: 'directions_car' }} tintColor={c.action} size={18} />
      </View>
    </ViewAnnotation>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.2,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  pinWrap: { alignItems: 'center' },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  tip: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  car: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
});
