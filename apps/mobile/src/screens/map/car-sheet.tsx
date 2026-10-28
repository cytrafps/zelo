import { BottomSheet, Button, Column, Host, Text } from '@expo/ui';
import { Linking, Platform } from 'react-native';

import type { ParkedCar } from '@/hooks/use-parked-car';
import { texte, useTheme } from '@/theme';
import { formatAgo } from '@/utils/format';
import { distance, formatDistance, walkingMinutes, type LatLon } from '@/utils/geo';

type Props = {
  isPresented: boolean;
  onDismiss: () => void;
  car: ParkedCar | null;
  /** Position GPS de l'utilisateur ; null si refusée ou pas encore connue. */
  me: LatLon | null;
  /** Où enregistrer la voiture : GPS si dispo, sinon centre de la carte. */
  here: LatLon & { source: 'gps' | 'carte' };
  onPark: (at: LatLon) => void;
  onForget: () => void;
  onShow: (car: ParkedCar) => void;
  /** Place quittée récemment (reconnexion à Android Auto), à signaler libre. */
  freed: LatLon | null;
  onReportFreed: (at: LatLon) => Promise<void>;
};

/** Itinéraire à pied dans l'app de cartes du système (Plans sur iOS, Google Maps ailleurs). */
function walkTo({ lat, lon }: LatLon) {
  const url = Platform.select({
    ios: `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`,
  });
  void Linking.openURL(url);
}

export function CarSheet({ isPresented, onDismiss, car, me, here, onPark, onForget, onShow, freed, onReportFreed }: Props) {
  const { c, dark } = useTheme();
  const meters = car && me ? distance(me, car) : null;

  return (
    <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.action}>
      <BottomSheet isPresented={isPresented} onDismiss={onDismiss}>
        <Column spacing={16} style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32 }}>
          {car ? (
            <>
              <Column spacing={4}>
                <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>Ta voiture</Text>
                <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
                  {`Garée ${formatAgo(car.parkedAt)}` +
                    (meters !== null ? ` · à ${formatDistance(meters)}, ${walkingMinutes(meters)} min à pied` : '')}
                </Text>
              </Column>
              <Button label="Y aller à pied" onPress={() => walkTo(car)} />
              <Button label="Voir sur la carte" variant="outlined" onPress={() => onShow(car)} />
              <Button
                label="Oublier cet emplacement"
                variant="text"
                onPress={() => {
                  onForget();
                  onDismiss();
                }}
              />
            </>
          ) : freed ? (
            <>
              <Column spacing={4}>
                <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>Tu as libéré ta place</Text>
                <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
                  Signale-la : un conducteur qui cherche autour la trouvera tout de suite.
                </Text>
              </Column>
              <Button label="Signaler la place libre" onPress={() => void onReportFreed(freed).then(onDismiss)} />
              <Button
                label="J'ai garé ma voiture ici"
                variant="outlined"
                onPress={() => {
                  onPark(here);
                  onDismiss();
                }}
              />
            </>
          ) : (
            <>
              <Column spacing={4}>
                <Text textStyle={{ ...texte.titre, color: c.texte.principal }}>Où est ta voiture ?</Text>
                <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
                  {(here.source === 'gps'
                    ? 'Enregistre ta position actuelle'
                    : 'Position indisponible : le centre de la carte sera enregistré') +
                    ". Elle reste sur ce téléphone, Zelo ne l'envoie nulle part."}
                </Text>
              </Column>
              <Button
                label="J'ai garé ma voiture ici"
                onPress={() => {
                  onPark(here);
                  onDismiss();
                }}
              />
            </>
          )}
        </Column>
      </BottomSheet>
    </Host>
  );
}
