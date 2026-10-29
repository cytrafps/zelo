import type { ComponentType } from 'react';

import { Boundary } from './components/boundary';
import { Sidebar } from './components/sidebar';
import { ui } from './components/ui';
import { type Route, useRoute } from './lib/router';
import { ApiPage } from './pages/api';
import { ChargePage } from './pages/charge';
import { FuelPage } from './pages/fuel';
import { Overview } from './pages/overview';
import { ParkingPage } from './pages/parking';
import { ReportsPage } from './pages/reports';

const PAGES: Record<Route, ComponentType> = {
  '/': Overview,
  '/stationnement': ParkingPage,
  '/recharge': ChargePage,
  '/carburant': FuelPage,
  '/signalements': ReportsPage,
  '/api': ApiPage,
};

export function App() {
  const route = useRoute();
  const Page = PAGES[route];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <Sidebar />
      <Boundary
        key={route}
        fallback={
          <main className={ui.page} role="alert">
            <p>Cette page n’a pas pu s’afficher. Recharge la page ; si le problème continue, les autres pages restent disponibles.</p>
          </main>
        }
      >
        <Page />
      </Boundary>
    </div>
  );
}
