import { BottomSheet, Button, Column, Host, List, ListItem, Switch, Text, TextInput } from '@expo/ui';
import { useEffect, useState } from 'react';

import { getEvModels } from '@/api/zelo';
import { useStored } from '@/hooks/use-stored';
import { evName, searchModels, type EvModel } from '@/utils/ev';
import { Linking, Platform } from 'react-native';

import type { ParkedCar } from '@/hooks/use-parked-car';
import { useParkingMemory } from '@/hooks/use-parking-memory';
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
          <ElectricCar />
          <ParkingMemory />
        </Column>
      </BottomSheet>
    </Host>
  );
}

/** Option « Retenir où je me gare » (Android) : la voiture est un appareil Bluetooth appairé. */
function ParkingMemory() {
  const { c } = useTheme();
  const m = useParkingMemory();
  if (!m.available) return null;
  return (
    <Column spacing={8}>
      <Switch label="Retenir où je me gare" value={m.on} onValueChange={(on) => void (on ? m.enable() : m.disable())} />
      <Text textStyle={{ ...texte.petit, color: m.error ? c.alerte.base : c.texte.tertiaire }}>
        {m.error ??
          (m.on
            ? `Quand ton téléphone quitte le Bluetooth de « ${m.name} », Zelo note la place, même fermée. Elle reste sur ce téléphone.`
            : "Quand ton téléphone quitte le Bluetooth de la voiture, Zelo note la place, même fermée. Il faut autoriser la position « Toujours » ; elle reste sur ce téléphone.")}
      </Text>
      {m.on && !m.choices && <Button label="Changer de voiture" variant="text" onPress={m.change} />}
      {m.choices && (
        <List>
          {m.choices.map((d) => (
            <ListItem key={d.address} onPress={() => m.choose(d)}>
              <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>{d.name}</Text>
            </ListItem>
          ))}
        </List>
      )}
    </Column>
  );
}

/** « Ma voiture électrique » : le modèle donne la batterie et la consommation, pour l'autonomie. */
function ElectricCar() {
  const { c } = useTheme();
  const [ev, setEv] = useStored<EvModel | null>('zelo.ve', null);
  const [picking, setPicking] = useState(false);
  const [models, setModels] = useState<EvModel[] | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (picking && !models) getEvModels().then(setModels, () => setModels([]));
  }, [picking, models]);

  if (!picking)
    return (
      <Column spacing={4}>
        <Text textStyle={{ ...texte.corpsFort, color: c.texte.principal }}>Voiture électrique</Text>
        <Text textStyle={{ ...texte.secondaire, color: c.texte.secondaire }}>
          {ev ? `${evName(ev)} · ${ev.batteryKwh} kWh utiles` : "Indique ton modèle : Zelo estime ta batterie à l'arrivée."}
        </Text>
        <Button label={ev ? 'Changer de modèle' : 'Choisir mon modèle'} variant="text" onPress={() => setPicking(true)} />
      </Column>
    );

  const found = models ? searchModels(models, query, 8) : [];
  return (
    <Column spacing={8}>
      <TextInput placeholder="Marque, modèle (ex. Zoé 52)" autoFocus onChangeText={setQuery} />
      {models === null ? (
        <Text textStyle={{ ...texte.secondaire, color: c.texte.tertiaire }}>Chargement des modèles…</Text>
      ) : (
        <List>
          {found.map((m) => (
            <ListItem
              key={m.id}
              onPress={() => {
                setEv(m);
                setPicking(false);
              }}
            >
              <Text textStyle={{ ...texte.corps, color: c.texte.principal }}>{evName(m)}</Text>
            </ListItem>
          ))}
        </List>
      )}
      <Text textStyle={{ ...texte.petit, color: c.texte.tertiaire }}>Données Open EV Data (github.com/KilowattApp/open-ev-data)</Text>
      <Button label="Annuler" variant="text" onPress={() => setPicking(false)} />
      {ev && (
        <Button
          label="Retirer ma voiture électrique"
          variant="text"
          onPress={() => {
            setEv(null);
            setPicking(false);
          }}
        />
      )}
    </Column>
  );
}
