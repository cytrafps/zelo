import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';

// Fond de carte des maquettes (01 · Accueil) : sol chaud, bâtiments en volume, parcs verts,
// routes blanches, peu de libellés. Tuiles OpenMapTiles d'OpenFreeMap, sans clé ;
// à remplacer par nos PMTiles auto-hébergées sans toucher aux couches.

const SOURCE = 'omt';
const FONT = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

type Palette = {
  sol: string;
  parc: string;
  eau: string;
  route: string;
  routeBord: string;
  chemin: string;
  batiment: string;
  batimentHaut: string;
  libelle: string;
  libelleHalo: string;
  libelleDiscret: string;
};

const CLAIR: Palette = {
  sol: '#ECE9E3',
  parc: '#D3E7C6',
  eau: '#AFCDEB',
  route: '#FFFFFF',
  routeBord: '#E2DDD4',
  chemin: '#E6E1D8',
  batiment: '#F4F2EE',
  batimentHaut: '#FBFAF8',
  libelle: '#1C1B19',
  libelleHalo: '#FFFFFF',
  libelleDiscret: '#5F5B54',
};

const SOMBRE: Palette = {
  sol: '#121110',
  parc: '#16261B',
  eau: '#14273A',
  route: '#34322F',
  routeBord: '#1C1B19',
  chemin: '#25231F',
  batiment: '#33302C',
  batimentHaut: '#46423D',
  libelle: '#F2F0EC',
  libelleHalo: '#121110',
  libelleDiscret: '#BDB8AE',
};

const is = (key: string, ...values: string[]): ExpressionSpecification => ['match', ['get', key], values, true, false];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
const byZoom = (...stops: number[]): ExpressionSpecification => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];

export function mapStyle(dark: boolean): StyleSpecification {
  const p = dark ? SOMBRE : CLAIR;

    // Largeurs par paires zoom/largeur ; le bord dépasse de 1,5 px.
  const road = (id: string, classes: string[], stops: number[], minzoom = 0): LayerSpecification[] => [
    {
      id: `${id}-bord`,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom,
      filter: ['all', notTunnel, is('class', ...classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.routeBord, 'line-width': byZoom(...stops.map((v, i) => (i % 2 ? v + 1.5 : v))) },
    },
    {
      id,
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom,
      filter: ['all', notTunnel, is('class', ...classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.route, 'line-width': byZoom(...stops) },
    },
  ];

  return {
    version: 8,
    name: dark ? 'Zelo sombre' : 'Zelo clair',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { [SOURCE]: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    light: { anchor: 'viewport', color: '#FFFFFF', intensity: dark ? 0.3 : 0.55, position: [1.4, 210, 35] },
    layers: [
      { id: 'sol', type: 'background', paint: { 'background-color': p.sol } },
      {
        id: 'parcs',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'park',
        paint: { 'fill-color': p.parc },
      },
      {
        id: 'verdure',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'landcover',
        filter: is('class', 'grass', 'wood'),
        paint: { 'fill-color': p.parc, 'fill-opacity': 0.8 },
      },
      {
        id: 'eau',
        type: 'fill',
        source: SOURCE,
        'source-layer': 'water',
        filter: notTunnel,
        paint: { 'fill-color': p.eau },
      },
      {
        id: 'cours-eau',
        type: 'line',
        source: SOURCE,
        'source-layer': 'waterway',
        filter: notTunnel,
        paint: { 'line-color': p.eau, 'line-width': byZoom(10, 1, 18, 8) },
      },
      {
        id: 'chemins',
        type: 'line',
        source: SOURCE,
        'source-layer': 'transportation',
        minzoom: 15,
        filter: ['all', notTunnel, is('class', 'path', 'track')],
        paint: { 'line-color': p.chemin, 'line-width': byZoom(15, 1, 19, 4) },
      },
      ...road('rues', ['minor', 'service'], [12, 0.5, 15, 4, 19, 20], 12),
      ...road('routes', ['secondary', 'tertiary'], [9, 1, 15, 8, 19, 32]),
      ...road('axes', ['motorway', 'trunk', 'primary'], [7, 1, 15, 11, 19, 40]),
      {
        id: 'batiments',
        type: 'fill-extrusion',
        source: SOURCE,
        'source-layer': 'building',
        minzoom: 13,
        filter: ['!', ['has', 'hide_3d']],
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, p.batiment, 40, p.batimentHaut],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 6]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      },
      {
        id: 'noms-rues',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'transportation_name',
        minzoom: 15,
        filter: ['any', is('class', 'primary', 'secondary', 'tertiary'), ['all', is('class', 'minor'), ['>=', ['zoom'], 17]]],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'symbol-spacing': 400,
        },
        paint: { 'text-color': p.libelleDiscret, 'text-halo-color': p.libelleHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'lieux-reperes',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'poi',
        minzoom: 14,
        // Seulement les grands repères (cathédrale, gare, musées) : la carte reste lisible.
        filter: ['all', ['<=', ['get', 'rank'], 3], is('class', 'place_of_worship', 'railway', 'museum', 'town_hall', 'stadium')],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': 12, 'text-max-width': 8 },
        paint: { 'text-color': p.libelle, 'text-halo-color': p.libelleHalo, 'text-halo-width': 1.5 },
      },
      {
        id: 'villes',
        type: 'symbol',
        source: SOURCE,
        'source-layer': 'place',
        maxzoom: 13,
        filter: is('class', 'city', 'town', 'village'),
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': ['match', ['get', 'class'], 'city', 15, 12] },
        paint: { 'text-color': p.libelle, 'text-halo-color': p.libelleHalo, 'text-halo-width': 1.5 },
      },
    ],
  };
}
