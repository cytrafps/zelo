import { Sidebar } from './components/sidebar';
import { useRoute } from './lib/router';
import { ChargePage } from './pages/charge';
import { FuelPage } from './pages/fuel';
import { Overview } from './pages/overview';
import { ReportsPage } from './pages/reports';
import { ParkingPage } from './pages/parking';
import { Soon } from './pages/soon';

const TITLES = {
  '/api': 'API & données ouvertes',
} as const;

export function App() {
  const route = useRoute();
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <Sidebar />
      {route === '/' ? <Overview /> : route === '/stationnement' ? <ParkingPage /> : route === '/recharge' ? <ChargePage /> : route === '/carburant' ? <FuelPage /> : route === '/signalements' ? <ReportsPage /> : <Soon key={route} title={TITLES[route]} />}
    </div>
  );
}
