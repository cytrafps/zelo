import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Keyboard, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import type { Place } from '@/api/geocode';
import { useGeocode } from '@/hooks/use-geocode';
import { espace, rayon, texte, type Couleurs } from '@/theme';

const ios = Platform.OS === 'ios';
const FIELD_HEIGHT = ios ? 52 : 56;

/** Hauteurs de la feuille : le champ seul, avec les récents en pastilles, ou en liste. */
type Detent = 'reduit' | 'normal' | 'grand';
const DETENTS: Detent[] = ['reduit', 'normal', 'grand'];
/** L'app est affichée bord à bord : hauteur totale du clavier, barres système comprises. */
const EDGE_TO_EDGE = { isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true };

/** Glissement (pt) sur la poignée qui fait changer de hauteur. */
const SWIPE = 24;

type Props = {
  c: Couleurs;
  bottomInset: number;
  near: { lat: number; lon: number };
  recents: Place[];
  carParked: boolean;
  onSelect: (place: Place) => void;
  onCar: () => void;
};

/**
 * Feuille d'accueil des maquettes (01 · Accueil, 02 · Recherche) : « Où vas-tu ? », bouton
 * Ma voiture et destinations récentes. La saisie fait monter la feuille au-dessus du clavier ; la
 * poignée se glisse (ou se touche) pour passer d'une hauteur à l'autre.
 */
export function HomePanel({ c, bottomInset, near, recents, carParked, onSelect, onCar }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [detent, setDetent] = useState<Detent>('normal');
  const { places, loading, failed } = useGeocode(focused ? query : '', near);

  // Le clavier, suivi image par image côté natif (y compris en plein écran sur Android, où la
  // fenêtre ne se redimensionne plus) : la feuille monte de ce qu'il recouvre.
  const keyboard = useAnimatedKeyboard(EDGE_TO_EDGE);
  // Android : la marge basse de la carte (barre de gestes) passe sous le clavier. iOS : la carte
  // flotte, à espace[2] au-dessus du clavier comme au-dessus du bord.
  const rest = ios ? (bottomInset > 0 ? bottomInset - espace[3] : espace[2]) : 0;
  const reach = ios ? rest - espace[2] : bottomInset;
  const lift = useAnimatedStyle(() => {
    const k = keyboard.height.value;
    return { transform: [{ translateY: k > 0 ? -Math.max(0, k - reach) : 0 }] };
  });

  const handle = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderRelease: (_, g) => {
          const step = g.dy < -SWIPE ? 1 : g.dy > SWIPE ? -1 : 0;
          setDetent((d) => {
            const i = DETENTS.indexOf(d);
            // Une simple touche agrandit, ou revient à la hauteur normale.
            if (step === 0) return d === 'normal' ? 'grand' : 'normal';
            return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, i + step))];
          });
        },
      }),
    [],
  );

  const choose = (place: Place) => {
    Keyboard.dismiss();
    setQuery('');
    setFocused(false);
    onSelect(place);
  };

  const searching = focused && query.trim().length >= 3;

  return (
    <Animated.View style={[styles.avoid, lift]} pointerEvents="box-none">
      <Animated.View
        layout={LinearTransition.duration(220)}
        style={[
          ios ? styles.cardIos : styles.cardAndroid,
          { backgroundColor: c.fond.surface, paddingBottom: (ios ? espace[4] : espace[4] + bottomInset) },
          ios && { marginBottom: rest },
        ]}
      >
        <View
          {...handle.panHandlers}
          style={styles.handleArea}
          accessibilityRole="adjustable"
          accessibilityLabel="Taille du panneau"
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            setDetent((d) => DETENTS[Math.min(2, Math.max(0, DETENTS.indexOf(d) + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))])
          }
        >
          <View style={[styles.handle, { backgroundColor: c.fond.separateur }]} />
        </View>

        {searching && (
          <Results places={places} loading={loading} failed={failed} c={c} onChoose={choose} />
        )}
        {(focused ? !searching : detent === 'grand') && recents.length > 0 && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.section}>
            <Text style={[texte.corpsFort, styles.sectionTitle, { color: c.texte.principal }]}>Récents</Text>
            {recents.map((p) => (
              <Row key={p.id} place={p} icon={{ ios: 'clock', android: 'history' }} c={c} onPress={() => choose(p)} />
            ))}
          </Animated.View>
        )}

        <View style={styles.searchRow}>
          <View style={[styles.field, { backgroundColor: c.fond.attenue }]}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search' }} tintColor={c.texte.secondaire} size={20} />
            <TextInput
              value={query}
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
            {query && !loading ? (
              <Pressable onPress={() => setQuery('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Effacer">
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

        {!focused && detent === 'normal' && recents.length > 0 && (
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
      </Animated.View>
    </Animated.View>
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
  // Zone tactile de 28 pt autour de la poignée de 5 pt.
  handleArea: { alignSelf: 'stretch', alignItems: 'center', paddingTop: espace[2], paddingBottom: espace[3] },
  handle: { width: 36, height: 5, borderRadius: 3 },
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
