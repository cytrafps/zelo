// Flèche de navigation en 3D (three.js), rendue en image pour la carte native, qui n'affiche pas
// de modèles 3D : vue de derrière et d'au-dessus, comme la caméra du guidage. Méthode de Waze.
//
//   node scripts/nav-arrow/render.mjs   # apps/mobile/assets/map/puck-arrow-{android,ios}@2x/@3x.png
//
// Demande Chromium + Playwright (préinstallés dans le conteneur de dev) et Pillow pour réduire
// l'image rendue à 8× (anticrénelage).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../../apps/mobile/assets/map');
const { chromium } = createRequire(import.meta.url)('playwright');

// Bleu d'action de chaque plateforme (theme.ts), bord blanc pour se détacher du tracé bleu.
const VARIANTS = { android: '#0B57D0', ios: '#007AFF' };
const PT = 44; // côté de l'image, en points
const ELEVATION = 45; // angle de vue au-dessus du sol (°) : la voiture est en bas de l'écran incliné

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const [name, color] of Object.entries(VARIANTS)) {
  const px = PT * 3 * 8;
  const page = await browser.newPage({ viewport: { width: px, height: px } });
  await page.goto(`file://${join(here, 'arrow.html')}?px=${px}&top=${encodeURIComponent(color)}&rim=%23FFFFFF&elev=${ELEVATION}`);
  await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60_000 });
  const big = join(out, `.puck-arrow-${name}.png`);
  await page.screenshot({ path: big, omitBackground: true });
  await page.close();
  execFileSync('python3', ['-I', '-c', `
import os, sys
from PIL import Image
big, base, pt = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(big)
for s in (2, 3):
    im.resize((pt * s, pt * s), Image.LANCZOS).save(f"{base}@{s}x.png", optimize=True)
os.remove(big)
`, big, join(out, `puck-arrow-${name}`), String(PT)]);
}
await browser.close();
