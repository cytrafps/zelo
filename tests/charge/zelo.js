// Test de charge Zelo (k6) : des conducteurs qui parcourent la carte, signalent et votent,
// et des clients qui écoutent le temps réel — contre l'API (une ou plusieurs répliques).
//
//   k6 run tests/charge/zelo.js                                   # http://localhost:8080
//   BASE_URL=http://192.168.1.88:8080 CONDUCTEURS=300 k6 run tests/charge/zelo.js
//
// Résultats et procédure de bascule : tests/charge/README.md.
//
// L'API doit tourner avec TRUST_PROXY=true : chaque requête simule un client différent
// (en-tête CF-Connecting-IP), sinon le quota par IP limiterait tout le test à un seul « téléphone ».
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { WebSocket } from 'k6/websockets';

const BASE = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const DUREE = __ENV.DUREE || '2m';
const CONDUCTEURS = Number(__ENV.CONDUCTEURS || 200);
const SIGNALEMENTS_PAR_S = Number(__ENV.SIGNALEMENTS_PAR_S || 10);
const ECOUTEURS = Number(__ENV.ECOUTEURS || 100);

const erreurs = new Rate('erreurs'); // réponses HTTP inattendues
const coupures = new Rate('ws_coupures'); // flux temps réel en erreur
const tempsReel = new Trend('signalement_temps_reel', true); // de l'enregistrement à la réception WebSocket

export const options = {
  scenarios: {
    carte: {
      executor: 'ramping-vus',
      exec: 'carte',
      stages: [
        { duration: '20s', target: CONDUCTEURS },
        { duration: DUREE, target: CONDUCTEURS },
        { duration: '10s', target: 0 },
      ],
    },
    signalements: {
      executor: 'constant-arrival-rate',
      exec: 'signaler',
      rate: SIGNALEMENTS_PAR_S,
      timeUnit: '1s',
      duration: DUREE,
      startTime: '20s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    ecoute: { executor: 'constant-vus', exec: 'ecouter', vus: ECOUTEURS, duration: DUREE, startTime: '15s' },
  },
  thresholds: {
    'http_req_duration{scenario:carte}': ['p(99)<500'],
    'http_req_duration{scenario:signalements}': ['p(99)<500'],
    erreurs: ['rate<0.01'],
    signalement_temps_reel: ['p(99)<1000'],
  },
};

const KINDS = ['accident', 'bouchon', 'travaux', 'obstacle', 'route_fermee', 'place_liberee', 'borne_hs'];
const rnd = (a, b) => a + Math.random() * (b - a);
const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const ip = () => `10.${Math.floor(rnd(0, 255))}.${Math.floor(rnd(0, 255))}.${Math.floor(rnd(1, 254))}`;
const client = () => ({ 'Content-Type': 'application/json', 'X-Zelo-Device': hex(32), 'CF-Connecting-IP': ip() });

/** Vue de carte d'un téléphone (~4 × 3 km) quelque part dans le Grand Reims. */
function vue() {
  const lon = rnd(3.95, 4.10);
  const lat = rnd(49.20, 49.30);
  return [lon - 0.03, lat - 0.015, lon + 0.03, lat + 0.015].map((x) => x.toFixed(4)).join(',');
}

// Un conducteur déplace la carte : l'app charge les quatre couches en parallèle.
export function carte() {
  const b = vue();
  const res = http.batch(
    ['fuel-stations', 'charge-stations', 'parkings', 'reports'].map((p) => ['GET', `${BASE}/v1/${p}?bbox=${b}`, null, { tags: { name: p } }]),
  );
  for (const r of res) erreurs.add(!check(r, { 'carte : 200': (x) => x.status === 200 }));
  sleep(rnd(3, 6));
}

// Un signalement, puis la moitié du temps un autre conducteur vote dessus.
export function signaler() {
  const body = JSON.stringify({ kind: KINDS[Math.floor(rnd(0, KINDS.length))], lat: rnd(49.20, 49.30), lon: rnd(3.95, 4.10) });
  const r = http.post(`${BASE}/v1/reports`, body, { headers: client(), tags: { name: 'reports' } });
  const ok = check(r, { 'signalement : 201 ou 200 (doublon)': (x) => x.status === 201 || x.status === 200 });
  erreurs.add(!ok);
  if (!ok || Math.random() < 0.5) return;
  const v = http.post(`${BASE}/v1/reports/${r.json('id')}/votes`, JSON.stringify({ up: Math.random() < 0.7 }), {
    headers: client(),
    tags: { name: 'votes' },
  });
  // 404 possible et normal : le signalement vient d'être retiré par d'autres votes.
  erreurs.add(!check(v, { 'vote : 200 ou 404': (x) => x.status === 200 || x.status === 404 }));
}

// Un téléphone garde le flux temps réel ouvert et mesure le délai de chaque signalement reçu.
export function ecouter() {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/v1/live`);
  ws.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'report' && ev.report.confirmations === 0 && ev.report.denials === 0) {
      tempsReel.add(Date.now() - Date.parse(ev.report.createdAt));
    }
  };
  let ok = true;
  let fermeture = false; // après notre propre close(), k6 peut signaler « close sent » : ce n'est pas une coupure
  ws.onerror = () => (ok = ok && fermeture);
  ws.onclose = () => coupures.add(!ok);
  // Se reconnecte toutes les 30 s, comme une app qui passe en arrière-plan.
  ws.onopen = () =>
    setTimeout(() => {
      fermeture = true;
      ws.close();
    }, 30_000);
}
