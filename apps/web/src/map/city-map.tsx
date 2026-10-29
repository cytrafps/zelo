import 'maplibre-gl/dist/maplibre-gl.css';

import * as maplibregl from 'maplibre-gl';
// Le worker de MapLibre 6 est un module à part : Vite le publie tel quel et on lui donne son adresse.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';

import { Boundary } from '../components/boundary';

import s from './city-map.module.css';
import { mapStyle } from './style';

export type Pin = { id: string; lat: number; lon: number; label: string; color?: string; title: string };

maplibregl.setWorkerUrl(workerUrl);

const REIMS: [number, number] = [4.0325, 49.2565];

/** MapLibre 6 exige WebGL 2 : sans lui (vieux navigateur, accélération coupée), pas de carte. */
let webgl2: boolean | undefined;
function canDraw() {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = gl !== null;
      // Les navigateurs limitent le nombre de contextes : celui du test est rendu tout de suite.
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}
const MIN_RELIEF_ZOOM = 14.3;

/**
 * Carte 3D de Reims (même style que l'app) avec des pastilles. Les pastilles sont des marqueurs
 * HTML : quelques dizaines au plus, au rendu identique à la maquette.
 */
export function CityMap(props: { pins: Pin[]; label: string }) {
  const fallback = (
    <div className={`${s.map} ${s.unavailable}`} role="note">
      Carte indisponible dans ce navigateur (WebGL 2 désactivé ou absent). Les chiffres et les listes restent à jour.
    </div>
  );
  if (!canDraw()) return fallback;
  return (
    <Boundary fallback={fallback}>
      <MapView {...props} />
    </Boundary>
  );
}

function MapView({ pins, label }: { pins: Pin[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  /** Cadrage fait : les rafraîchissements suivants ne ramènent pas la carte que l'on a déplacée. */
  const framed = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: mapStyle(false),
      center: REIMS,
      zoom: 14.7,
      pitch: 50,
      bearing: -16,
      maxPitch: 70,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    // La carte suit la taille de sa carte (police chargée, colonnes qui passent l'une sous l'autre).
    const resize = new ResizeObserver(() => m.resize());
    resize.observe(box.current);
    map.current = m;
    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const markers = pins.map((p) => {
      const el = document.createElement('div');
      el.className = s.pin!;
      el.title = p.title;
      const dot = document.createElement('span');
      dot.className = s.pinP!;
      dot.textContent = 'P';
      if (p.color) dot.style.background = p.color;
      el.append(dot, p.label);
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(m);
    });
    // Toutes les pastilles dans le cadre, sans descendre sous le zoom où le relief se voit.
    if (pins.length > 0 && !framed.current) {
      framed.current = true;
      const b = new maplibregl.LngLatBounds();
      pins.forEach((p) => b.extend([p.lon, p.lat]));
      m.fitBounds(b, { padding: { top: 48, bottom: 48, left: 60, right: 60 }, pitch: 50, bearing: -16, maxZoom: 15.5, duration: 0 });
      if (m.getZoom() < MIN_RELIEF_ZOOM) m.setZoom(MIN_RELIEF_ZOOM);
      // Vue inclinée : le bas de l'image couvre moins de terrain que le haut, on recentre plus au sud.
      m.panBy([0, 36], { duration: 0 });
    }
    return () => markers.forEach((mk) => mk.remove());
  }, [pins]);

  return <div ref={box} className={s.map} role="region" aria-label={label} />;
}
