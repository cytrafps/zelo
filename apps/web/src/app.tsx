import type { ComponentType } from 'react';

import { Sidebar } from './components/sidebar';
import { type Route, useRoute } from './lib/router';
import { ApiPage } from './pages/api';
import { ChargePage } from './pages/charge';
import { FuelPage } from './pages/fuel';
import { Overview } from './pages/overview';
import { ReportsPage } from './pages/reports';
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
  const Page = PAGES[useRoute()];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <Sidebar />
      <Page />
    </div>
  );
}
