import { Sidebar } from './components/sidebar';
import { useRoute } from './lib/router';
import { Overview } from './pages/overview';
import { Soon } from './pages/soon';

const TITLES = {
  '/stationnement': 'Stationnement',
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
      {route === '/' ? <Overview /> : <Soon key={route} title={TITLES[route]} />}
    </div>
  );
}
