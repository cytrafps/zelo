import { Sidebar } from './components/sidebar';
import { useRoute } from './lib/router';
import { Overview } from './pages/overview';
import { ParkingPage } from './pages/parking';
import { Soon } from './pages/soon';

const TITLES = {
  '/recharge': 'Recharge',
  '/carburant': 'Carburant',
  '/signalements': 'Signalements',
  '/api': 'API & données ouvertes',
} as const;

export function App() {
  const route = useRoute();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <Sidebar />
      {route === '/' ? <Overview /> : route === '/stationnement' ? <ParkingPage /> : <Soon key={route} title={TITLES[route]} />}
    </div>
  );
}
