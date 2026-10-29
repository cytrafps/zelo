import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

/**
 * Positions du guidage, y compris quand Zelo passe en arrière-plan (musique, appel, autre app) :
 * service au premier plan avec notification sur Android, mode « location » sur iOS. La permission
 * « pendant l'utilisation » suffit dans les deux cas, le guidage étant lancé par l'utilisateur.
 *
 * La tâche doit être définie au chargement du module, avant tout rendu : `app/_layout` l'importe.
 */
const TASK = 'zelo-guidage';

type Listener = (l: Location.LocationObject) => void;
const listeners = new Set<Listener>();

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data) return;
  for (const l of data.locations) for (const on of listeners) on(l);
});

export function onNavigationFix(on: Listener) {
  listeners.add(on);
  return () => void listeners.delete(on);
}

/**
 * Démarrages et arrêts passent l'un après l'autre : l'arrêt d'un guidage qui se termine ne doit
 * pas couper le suivi du suivant, lancé juste après.
 */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(op: () => Promise<T>): Promise<T> => {
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
};

/** Démarre le suivi ; false s'il n'est pas possible (le guidage s'arrêtera en arrière-plan). */
export const startNavigationUpdates = () => serial(start);

export const stopNavigationUpdates = () => serial(stop);

async function start(): Promise<boolean> {
  try {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      activityType: Location.ActivityType.OtherNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Guidage Zelo en cours',
        notificationBody: 'Ta position sert au guidage jusqu’à l’arrivée.',
        notificationColor: '#1C1B19',
        killServiceOnDestroy: true,
      },
    });
    return true;
  } catch {
    return false;
  }
}

async function stop() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch {
    // Déjà arrêté (app relancée, service tué par le système).
  }
}
