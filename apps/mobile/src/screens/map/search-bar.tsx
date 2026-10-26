import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Place } from '@/api/geocode';
import { useGeocode } from '@/hooks/use-geocode';
import { espace, rayon, texte, type Couleurs } from '@/theme';

type Props = {
  c: Couleurs;
  top: number;
  near: { lat: number; lon: number };
  destination: Place | null;
  onSelect: (place: Place) => void;
  onClear: () => void;
};

export const SEARCH_BAR_HEIGHT = 52;

/** Champ « Où vas-tu ? » flottant en haut de la carte, avec suggestions d'adresses. */
export function SearchBar({ c, top, near, destination, onSelect, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const { places, loading, failed } = useGeocode(focused ? query : '', near);

  const choose = (place: Place) => {
    Keyboard.dismiss();
    setQuery('');
    setFocused(false);
    onSelect(place);
  };

  const clear = () => {
    setQuery('');
    onClear();
  };

  const showing = focused && query.trim().length >= 3;
  const value = focused ? query : (destination?.label ?? '');

  return (
    <View style={[styles.wrap, { top }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: c.fond.surface }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search' }} tintColor={c.texte.tertiaire} size={18} />
        <TextInput
          value={value}
          onChangeText={setQuery}
          onFocus={() => {
            setFocused(true);
            setQuery('');
          }}
          onBlur={() => setFocused(false)}
          placeholder="Où vas-tu ?"
          placeholderTextColor={c.texte.tertiaire}
          returnKeyType="search"
          onSubmitEditing={() => places[0] && choose(places[0])}
          autoCorrect={false}
          style={[texte.corps, styles.input, { color: c.texte.principal }]}
          accessibilityLabel="Rechercher une destination"
        />
        {loading && <ActivityIndicator size="small" color={c.texte.tertiaire} />}
        {(destination || query) && !loading ? (
          <Pressable onPress={clear} hitSlop={12} accessibilityRole="button" accessibilityLabel="Effacer la destination">
            <SymbolView name={{ ios: 'xmark.circle.fill', android: 'close' }} tintColor={c.texte.tertiaire} size={18} />
          </Pressable>
        ) : null}
      </View>

      {showing && (places.length > 0 || failed || !loading) && (
        <View style={[styles.results, { backgroundColor: c.fond.surface }]}>
          {places.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => choose(p)}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.fond.separateur },
                pressed && { backgroundColor: c.fond.attenue },
              ]}
              accessibilityRole="button"
            >
              <SymbolView name={{ ios: 'mappin.circle.fill', android: 'location_on' }} tintColor={c.action} size={22} />
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[texte.corps, { color: c.texte.principal }]}>
                  {p.name}
                </Text>
                {p.detail ? (
                  <Text numberOfLines={1} style={[texte.secondaire, { color: c.texte.secondaire }]}>
                    {p.detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {places.length === 0 && (
            <Text style={[texte.secondaire, styles.empty, { color: failed ? c.alerte.base : c.texte.secondaire }]}>
              {failed ? 'Recherche indisponible, vérifie ta connexion.' : 'Aucune adresse trouvée.'}
            </Text>
          )}
        </View>
      )}
    </View>
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
  wrap: { position: 'absolute', left: espace[4], right: espace[4] },
  bar: {
    height: SEARCH_BAR_HEIGHT,
    borderRadius: rayon.bouton,
    paddingHorizontal: espace[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: espace[3],
    ...shadow,
  },
  input: { flex: 1, paddingVertical: 0 },
  results: { marginTop: espace[2], borderRadius: rayon.l, overflow: 'hidden', ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: espace[3], paddingHorizontal: espace[4], paddingVertical: espace[3] },
  rowText: { flex: 1 },
  empty: { padding: espace[4] },
});
