import { Stack } from 'expo-router';

import { API_URL } from '@/api/zelo';

import { setApiUrl } from '../../modules/zelo-auto';

// Android Auto tourne en natif, sans JavaScript : il lit l'adresse de l'API transmise ici.
setApiUrl(API_URL);

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
