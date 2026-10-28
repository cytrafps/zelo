import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Glass } from '@/components/glass';

import { police, rayon, type Couleurs } from '@/theme';

import { CATEGORY_ICON, type Category } from './pins';

const ORDER: { key: Category; label: string }[] = [
  { key: 'carburant', label: 'Carburant' },
  { key: 'recharge', label: 'Recharge' },
  { key: 'stationnement', label: 'Stationnement' },
];

type Props = { value: Category; onChange: (c: Category) => void; c: Couleurs; top: number };

/** Colonne de filtres en haut à droite : une catégorie à la fois, comme dans les maquettes. */
export function Filters({ value, onChange, c, top }: Props) {
  return (
    <Glass style={[styles.column, { top }]} accessibilityRole="radiogroup">
      {ORDER.map(({ key, label }) => {
        const on = key === value;
        const tone = c[key];
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={[styles.button, on && { backgroundColor: tone.base }]}
          >
            {key === 'stationnement' ? (
              <Text style={[styles.letter, { color: on ? '#FFFFFF' : tone.base }]}>P</Text>
            ) : (
              <SymbolView name={CATEGORY_ICON[key]} tintColor={on ? '#FFFFFF' : tone.base} size={22} />
            )}
          </Pressable>
        );
      })}
    </Glass>
  );
}

const styles = StyleSheet.create({
  column: {
    position: 'absolute',
    right: 16,
    padding: 4,
    gap: 4,
    borderRadius: rayon.pilule,
  },
  button: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: police, fontSize: 22, fontWeight: '700' },
});
