import * as Location from 'expo-location';
import { useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { carBluetoothAvailable, carDevice, pairedDevices, setCarDevice, type PairedDevice } from '../../modules/zelo-auto';

/**
 * « Retenir où je me gare » (Android) : la place est notée quand le téléphone quitte le
 * Bluetooth de la voiture, même app fermée. Il faut la position en arrière-plan et l'accès au
 * Bluetooth ; ils ne sont demandés qu'à l'activation.
 */
export function useParkingMemory() {
  const [device, setDevice] = useState(carDevice);
  /** Appareils à choisir quand aucun ne ressemble à coup sûr à la voiture. */
  const [choices, setChoices] = useState<PairedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (d: PairedDevice) => {
    setCarDevice(d.address);
    setDevice(d.address);
    setChoices(null);
  };

  const enable = async () => {
    setError(null);
    if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted')
      return setError('Zelo a besoin de ta position pour noter la place.');
    if ((await Location.requestBackgroundPermissionsAsync()).status !== 'granted')
      return setError('Choisis « Toujours autoriser » pour la position : la place est notée app fermée.');
    // Android 12 et plus : lire les appareils appairés demande une permission à part.
    const bt = Number(Platform.Version) >= 31 ? await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) : 'granted';
    if (bt !== PermissionsAndroid.RESULTS.GRANTED)
      return setError('Zelo a besoin du Bluetooth pour savoir quand tu quittes la voiture.');
    const all = pairedDevices();
    const cars = all.filter((d) => d.car);
    if (cars.length === 1) return choose(cars[0]);
    if (all.length === 0) return setError("Aucun appareil Bluetooth appairé : connecte d'abord ton téléphone à la voiture.");
    setChoices(all);
  };

  const disable = () => {
    setCarDevice(null);
    setDevice(null);
    setChoices(null);
  };

  const name = device ? (pairedDevices().find((d) => d.address === device)?.name ?? 'Voiture') : null;
  const change = () => setChoices(pairedDevices());
  return { available: carBluetoothAvailable, on: device !== null, name, choices, error, enable, disable, choose, change };
}
