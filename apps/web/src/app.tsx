import { Sidebar } from './components/sidebar';
import { useRoute } from './lib/router';
import { ChargePage } from './pages/charge';
import { FuelPage } from './pages/fuel';
import { Overview } from './pages/overview';
import { ParkingPage } from './pages/parking';
import { Soon } from './pages/soon';

const TITLES = {
  '/signalements': 'Signalements',
  '/api': 'API & données ouvertes',
} as const;

export function App() {
  const route = useRoute();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <Sidebar />
      {route === '/' ? <Overview /> : route === '/stationnement' ? <ParkingPage /> : route === '/recharge' ? <ChargePage /> : route === '/carburant' ? <FuelPage /> : <Soon key={route} title={TITLES[route]} />}
    </div>
  );
}
