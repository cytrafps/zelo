import { Storage } from 'expo-sqlite/kv-store';

const KEY = 'zelo.appareil';

/**
 * Identifiant anonyme de l'appareil, tiré au hasard au premier lancement et gardé localement.
 * Il sert seulement à compter un vote par appareil et par signalement (le serveur n'en garde
 * qu'une empreinte) ; il n'est lié à aucun compte ni à aucune donnée personnelle.
 */
export function deviceId(): string {
  let id = Storage.getItemSync(KEY);
  if (!id) {
    // Pas besoin d'aléa cryptographique : l'identifiant n'est pas un secret.
    id = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    Storage.setItemSync(KEY, id);
  }
  return id;
}
