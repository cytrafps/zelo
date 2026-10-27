import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Place } from '@/api/geocode';
import { useGeocode } from '@/hooks/use-geocode';
import { espace, rayon, texte, type Couleurs } from '@/theme';

const ios = Platform.OS === 'ios';
const FIELD_HEIGHT = ios ? 52 : 56;

type Props = {
  c: Couleurs;
  bottomInset: number;
  near: { lat: number; lon: number };
  destination: Place | null;
  recents: Place[];
  carParked: boolean;
  onSelect: (place: Place) => void;
  onClear: () => void;
  onCar: () => void;
};

/**
 * Feuille d'accueil des maquettes (01 · Accueil, 02 · Recherche) : « Où vas-tu ? », bouton
 * Ma voiture et destinations récentes. La saisie fait monter la feuille au-dessus du clavier.
 */
export function HomePanel({ c, bottomInset, near, destination, recents, carParked, onSelect, onClear, onCar }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const { places, loading, failed } = useGeocode(focused ? query : '', near);

  const choose = (place: Place) => {
    Keyboard.dismiss();
    setQuery('');
    setFocused(false);
    onSelect(place);
  };

  const searching = focused && query.trim().length >= 3;
  const value = focused ? query : (destination?.name ?? '');

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.avoid} pointerEvents="box-none">
      <View
        style={[
          ios ? styles.cardIos : styles.cardAndroid,
          { backgroundColor: c.fond.surface, paddingBottom: (ios ? espace[4] : espace[4] + bottomInset) },
          ios && { marginBottom: bottomInset > 0 ? bottomInset - espace[3] : espace[2] },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: c.fond.separateur }]} />

        {searching && (
          <Results places={places} loading={loading} failed={failed} c={c} onChoose={choose} />
        )}
        {focused && !searching && recents.length > 0 && (
          <View style={styles.section}>
            <Text style={[texte.corpsFort, styles.sectionTitle, { color: c.texte.principal }]}>Récents</Text>
            {recents.map((p) => (
              <Row key={p.id} place={p} icon={{ ios: 'clock', android: 'history' }} c={c} onPress={() => choose(p)} />
            ))}
          </View>
        )}

        <View style={styles.searchRow}>
          <View style={[styles.field, { backgroundColor: c.fond.attenue }]}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search' }} tintColor={c.texte.secondaire} size={20} />
            <TextInput
              value={value}
              onChangeText={setQuery}
              onFocus={() => {
                setFocused(true);
                setQuery('');
              }}
              onBlur={() => setFocused(false)}
              placeholder="Où vas-tu ?"
              placeholderTextColor={c.texte.secondaire}
              returnKeyType="search"
              onSubmitEditing={() => places[0] && choose(places[0])}
              autoCorrect={false}
              style={[texte.corps, styles.input, { color: c.texte.principal }]}
              accessibilityLabel="Rechercher une destination"
            />
            {loading && <ActivityIndicator size="small" color={c.texte.tertiaire} />}
            {(destination || query) && !loading ? (
              <Pressable
                onPress={() => {
                  setQuery('');
                  onClear();
                }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Effacer la destination"
              >
                <SymbolView name={{ ios: 'xmark.circle.fill', android: 'close' }} tintColor={c.texte.tertiaire} size={20} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={onCar}
            accessibilityRole="button"
            accessibilityLabel={carParked ? 'Ma voiture' : 'Enregistrer où je me suis garé'}
            style={({ pressed }) => [
              styles.car,
              { borderColor: carParked ? c.action : c.fond.separateur, backgroundColor: c.fond.attenue, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <SymbolView name={{ ios: 'car.fill', android: 'directions_car' }} tintColor={carParked ? c.action : c.texte.principal} size={22} />
          </Pressable>
        </View>

        {!focused && recents.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {recents.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => choose(p)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.chip, { backgroundColor: c.fond.attenue, opacity: pressed ? 0.7 : 1 }]}
              >
                <SymbolView name={{ ios: 'clock', android: 'history' }} tintColor={c.texte.principal} size={16} />
                <Text numberOfLines={1} style={[texte.corpsFort, styles.chipText, { color: c.texte.principal }]}>
                  {p.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Results(props: { places: Place[]; loading: boolean; failed: boolean; c: Couleurs; onChoose: (p: Place) => void }) {
  const { places, loading, failed, c, onChoose } = props;
  if (places.length === 0) {
    if (loading) return null;
    return (
      <Text style={[texte.secondaire, styles.empty, { color: failed ? c.alerte.base : c.texte.secondaire }]}>
        {failed ? 'Recherche indisponible, vérifie ta connexion.' : 'Aucune adresse trouvée.'}
      </Text>
    );
  }
  return (
    <View style={styles.section}>
      {places.slice(0, 5).map((p) => (
        <Row key={p.id} place={p} icon={{ ios: 'mappin.circle.fill', android: 'location_on' }} c={c} onPress={() => onChoose(p)} />
      ))}
    </View>
  );
}

function Row(props: {
  place: Place;
  icon: { ios: 'clock' | 'mappin.circle.fill'; android: 'history' | 'location_on' };
  c: Couleurs;
  onPress: () => void;
}) {
  const { place, icon, c, onPress } = props;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.fond.attenue }]}>
      <View style={[styles.rowIcon, { backgroundColor: c.fond.attenue }]}>
        <SymbolView name={icon} tintColor={c.texte.secondaire} size={18} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[texte.corps, { color: c.texte.principal }]}>
          {place.name}
        </Text>
        {place.detail ? (
          <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire }]}>
            {place.detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.14,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: -2 },
  elevation: 8,
};

const styles = StyleSheet.create({
  avoid: { width: '100%' },
  cardIos: { marginHorizontal: espace[2], borderRadius: 34, paddingHorizontal: espace[4], ...shadow },
  cardAndroid: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: espace[4], ...shadow },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginTop: espace[2], marginBottom: espace[3] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: espace[3] },
  field: {
    flex: 1,
    height: FIELD_HEIGHT,
    borderRadius: rayon.pilule,
    paddingHorizontal: espace[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[3],
  },
  input: { flex: 1, paddingVertical: 0 },
  car: { width: FIELD_HEIGHT, height: FIELD_HEIGHT, borderRadius: rayon.pilule, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: espace[2], paddingTop: espace[3] },
  chip: { height: 44, borderRadius: rayon.pilule, paddingHorizontal: espace[4], flexDirection: 'row', alignItems: 'center', gap: espace[2], maxWidth: 220 },
  chipText: { flexShrink: 1 },
  section: { paddingBottom: espace[3] },
  sectionTitle: { paddingVertical: espace[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: espace[3], paddingVertical: espace[2], borderRadius: rayon.s },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  empty: { paddingVertical: espace[4] },
});
