// Jetons de l'interface de l'app (variables Figma « Zelo »).
// La palette de marque (encre + vert) est réservée au logo et aux stores : ne pas l'utiliser ici.
import { Platform, useColorScheme, type TextStyle } from 'react-native';

import type { ReportKind } from '@/api/zelo';

const ios = Platform.OS === 'ios';

const clair = {
  fond: { sol: '#F2EFE9', surface: '#FFFFFF', attenue: '#F6F4F0', separateur: '#EEEAE3' },
  texte: { principal: '#1C1B19', secondaire: '#5F5B54', tertiaire: '#8A857C', inverse: '#FFFFFF' },
  // Bleu système : iOS systemBlue, Android Material 3 primary.
  action: ios ? '#007AFF' : '#0B57D0',
  carburant: { base: '#C2570C', doux: '#FCEFDF', texte: '#9A4508' },
  recharge: { base: '#0B7A61', doux: '#DDF2EA', texte: '#0A6650' },
  stationnement: { base: '#1D5FD1', doux: '#E1EAFB', texte: '#1A4FAF' },
  alerte: { base: '#C8361F', doux: '#FBE4DF' },
  indisponible: '#8A857C',
};

const sombre: typeof clair = {
  fond: { sol: '#121110', surface: '#1C1C1E', attenue: '#2C2C2E', separateur: '#38383A' },
  texte: { principal: '#F2F0EC', secondaire: '#BDB8AE', tertiaire: '#8A857D', inverse: '#1C1B19' },
  action: ios ? '#0A84FF' : '#A8C7FA',
  carburant: { base: '#F97316', doux: '#3A2412', texte: '#FDBA74' },
  recharge: { base: '#2BD46A', doux: '#0F2E25', texte: '#7DDBB6' },
  stationnement: { base: '#5B8DEF', doux: '#16233D', texte: '#A8C2F7' },
  alerte: { base: '#FF6B57', doux: '#3D1A15' },
  indisponible: '#8A857D',
};

export type Couleurs = typeof clair;

export const espace = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

export const rayon = {
  s: 12,
  m: 16,
  l: 20,
  pilule: 999,
  bouton: ios ? 26 : 28,
  hauteurBouton: ios ? 52 : 56,
} as const;

/**
 * Police de l'interface : SF Pro sur iOS (système), Google Sans Flex sur Android, la police
 * d'Android 16 (fichier variable embarqué, voir app.json et assets/fonts).
 */
export const police = ios ? undefined : 'GoogleSansFlex';

export const texte = {
  titre: { fontFamily: police, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  corps: { fontFamily: police, fontSize: ios ? 17 : 16, lineHeight: ios ? 22 : 24, fontWeight: '400' },
  corpsFort: { fontFamily: police, fontSize: ios ? 17 : 16, lineHeight: ios ? 22 : 24, fontWeight: '600' },
  secondaire: { fontFamily: police, fontSize: ios ? 15 : 14, lineHeight: 20, fontWeight: '400' },
  petit: { fontFamily: police, fontSize: ios ? 13 : 12, lineHeight: ios ? 18 : 16, fontWeight: '500' },
} as const satisfies Record<string, TextStyle>;

export const REPORT_META: Record<ReportKind, { label: string; couleur: string }> = {
  accident: { label: 'Accident', couleur: '#C8361F' },
  bouchon: { label: 'Bouchon', couleur: '#D9480F' },
  travaux: { label: 'Travaux', couleur: '#E8A10C' },
  obstacle: { label: 'Obstacle sur la route', couleur: '#B35C00' },
  route_fermee: { label: 'Route fermée', couleur: '#7A1E12' },
  place_liberee: { label: 'Place libérée', couleur: '#1D5FD1' },
  borne_hs: { label: 'Borne hors service', couleur: '#5F5B54' },
};

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return { c: dark ? sombre : clair, dark };
}
