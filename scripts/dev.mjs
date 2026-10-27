#!/usr/bin/env node
// Lance tout l'environnement Zelo pour tester sur un téléphone Android :
// API + PostGIS (Docker), dépendances, compte EAS, development build si nécessaire, puis Metro.
//
//   npm run dev               tout démarrer
//   npm run dev -- --rebuild  forcer un nouveau development build
//   npm run dev -- --ip 192.168.1.20   imposer l'IP du PC
//   npm run dev -- --api http://192.168.1.50:8080   utiliser une API déjà lancée ailleurs
//                             (homelab, serveur) : Docker n'est alors pas nécessaire sur ce PC
//   npm run dev -- --api https://….trycloudflare.com --tunnel   téléphone hors du Wi-Fi (4G) :
//                             l'app passe aussi par un tunnel Expo pour charger son code
//   npm run stop              arrêter l'API et la base (les données sont gardées)
//
// Aucune dépendance : Node 20+ et Docker (sauf avec --api) suffisent. Windows, macOS et Linux.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(ROOT, 'apps', 'mobile');
const COMPOSE = ['compose', '-f', join(ROOT, 'infra', 'compose.yaml')];
const MARKER = join(MOBILE, '.expo', 'zelo-dev-build.json');
const EAS = ['--yes', 'eas-cli@25'];
const WIN = process.platform === 'win32';
const API_PORT = 8080;

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1'), dim = c('2'), red = c('31'), green = c('32'), yellow = c('33');
const step = (msg) => console.log(`\n${bold('▸')} ${bold(msg)}`);
const ok = (msg) => console.log(`  ${green('✓')} ${msg}`);
const warn = (msg) => console.log(`  ${yellow('!')} ${msg}`);
function fail(msg, hint) {
  console.error(`\n${red('✗')} ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** Lance une commande ; `inherit` la rend interactive (connexion EAS, QR code…). */
/**
 * Sous Windows, npx et npm sont des .cmd qui exigent un shell. Node (DEP0190) refuse qu'on lui
 * passe alors des arguments séparés, non échappés : on construit une ligne de commande citée.
 */
function command(cmd, args) {
  if (!WIN) return [cmd, args, false];
  const quote = (a) => (/^[\w@./:=\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
  return [[cmd, ...args].map(quote).join(' '), [], true];
}

function run(cmd, args, { cwd = ROOT, env, inherit = false } = {}) {
  const [file, argv, shell] = command(cmd, args);
  const r = spawnSync(file, argv, {
    cwd,
    env: { ...process.env, ...env },
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------------------------------------------------------------------------

async function main() {
  step('Vérifications');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 19)) fail(`Node ${process.versions.node} trop ancien.`, 'Installe Node 22 LTS : https://nodejs.org');
  ok(`Node ${process.versions.node}`);
  const remote = option('--api')?.replace(/\/$/, '');
  if (!remote) {
    if (run('docker', ['info']).code !== 0) fail('Docker ne répond pas.', WIN ? 'Lance Docker Desktop, ou utilise une API distante : npm run dev -- --api http://<ip-du-serveur>:8080' : 'Démarre Docker, ou utilise une API distante avec --api.');
    ok('Docker');
  }

  const ip = option('--ip') ?? lanAddress();
  if (!ip) fail('Aucune adresse réseau local trouvée.', 'Connecte le PC au Wi-Fi, ou passe --ip <adresse>.');
  ok(`IP du PC sur le réseau local : ${bold(ip)}`);

  const apiUrl = remote ?? `http://${ip}:${API_PORT}`;
  if (remote) {
    step('API distante');
    if (!(await waitFor(`${remote}/healthz`, 5_000))) fail(`${remote}/healthz ne répond pas.`, 'Vérifie que l’API tourne sur le serveur et que le port 8080 est ouvert.');
    ok(`API prête : ${remote}`);
  } else {
    await startApi(ip);
  }
  installDependencies();
  ensureEasAccount();
  await ensureDevBuild();
  startMetro(ip, apiUrl);
}

// --- API ---------------------------------------------------------------------

async function startApi(ip) {
  step('API et base de données (Docker)');
  const r = run('docker', [...COMPOSE, 'up', '-d', '--build'], { inherit: true });
  if (r.code !== 0) fail('Échec du démarrage Docker Compose.');

  if (!(await waitFor(`http://localhost:${API_PORT}/healthz`, 60_000))) {
    console.log(run('docker', [...COMPOSE, 'logs', '--tail', '30', 'api']).out);
    fail('L’API ne répond pas après 60 s (journal ci-dessus).');
  }
  ok(`API prête sur http://localhost:${API_PORT}`);

  if (await waitFor(`http://${ip}:${API_PORT}/healthz`, 3_000)) ok(`Joignable depuis le réseau : http://${ip}:${API_PORT}`);
  else warn(`http://${ip}:${API_PORT} ne répond pas : le téléphone ne pourra pas joindre l’API.` + (WIN ? ' Autorise Docker dans le pare-feu Windows (réseau privé).' : ''));

  await reportIngestion();
}

async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return true;
    } catch {
      // pas encore prêt
    }
    await sleep(1_000);
  }
  return false;
}

const SOURCES = { carburant: 'Stations et prix', bornes_statique: 'Bornes', bornes_dynamique: 'États des bornes', parkings: 'Parkings' };

/** Attend la première collecte de chaque source (au plus 2 min) et affiche son résultat. */
async function reportIngestion() {
  console.log(dim('  Collecte des données ouvertes…'));
  const seen = new Set();
  const end = Date.now() + 120_000;
  while (seen.size < Object.keys(SOURCES).length && Date.now() < end) {
    const logs = run('docker', [...COMPOSE, 'logs', '--no-log-prefix', 'api']).out;
    for (const line of logs.split('\n')) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.msg !== 'collecte' || !(e.source in SOURCES) || seen.has(e.source)) continue;
      seen.add(e.source);
      if (e.err) warn(`${SOURCES[e.source]} : échec (${e.err})`);
      else ok(`${SOURCES[e.source]} : ${Number(e.elements).toLocaleString('fr-FR')} (${e.duree})`);
    }
    if (seen.size < Object.keys(SOURCES).length) await sleep(2_000);
  }
  for (const s of Object.keys(SOURCES)) if (!seen.has(s)) warn(`${SOURCES[s]} : toujours en cours, l’app les affichera dès la fin.`);
}

// --- App -----------------------------------------------------------------------

function installDependencies() {
  step('Dépendances de l’app');
  const lock = join(MOBILE, 'package-lock.json');
  const installed = join(MOBILE, 'node_modules', '.package-lock.json');
  if (mtime(installed) >= mtime(lock) && mtime(installed) > 0) {
    ok('À jour');
    return;
  }
  if (run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: MOBILE, inherit: true }).code !== 0) fail('npm ci a échoué.');
  ok('Installées');
}

function ensureEasAccount() {
  step('Compte Expo (EAS)');
  let who = run('npx', [...EAS, 'whoami'], { cwd: MOBILE });
  if (who.code !== 0) {
    console.log('  Connexion à ton compte Expo (gratuit, crée-le sur https://expo.dev/signup) :');
    if (run('npx', [...EAS, 'login'], { cwd: MOBILE, inherit: true }).code !== 0) fail('Connexion EAS annulée.');
    who = run('npx', [...EAS, 'whoami'], { cwd: MOBILE });
  }
  ok(`Connecté : ${who.out.split('\n')[0]}`);

  if (!projectId()) {
    console.log('  Liaison du projet à ton compte Expo :');
    if (run('npx', [...EAS, 'init'], { cwd: MOBILE, inherit: true }).code !== 0 || !projectId()) fail('eas init a échoué.');
    warn('app.json contient maintenant le projectId : pense à le committer.');
  }
  ok(`Projet EAS ${projectId()}`);
}

function projectId() {
  return JSON.parse(readFileSync(join(MOBILE, 'app.json'), 'utf8')).expo?.extra?.eas?.projectId;
}

/**
 * Un development build n'est à refaire que si la partie native change (dépendance native,
 * plugin, icône…). L'empreinte Expo le détecte ; un changement de code JS n'en demande jamais.
 */
async function ensureDevBuild() {
  step('Development build Android');
  const require = createRequire(join(MOBILE, 'package.json'));
  const { createFingerprintAsync } = require('@expo/fingerprint');
  const { hash } = await createFingerprintAsync(MOBILE, { platforms: ['android'], silent: true });

  const marker = existsSync(MARKER) ? JSON.parse(readFileSync(MARKER, 'utf8')) : null;
  if (!flag('--rebuild') && marker?.fingerprint === hash) {
    ok(`À jour (construit le ${new Date(marker.builtAt).toLocaleString('fr-FR')}) : garde l’app Zelo installée.`);
    return;
  }
  if (!flag('--rebuild') && !marker && (await askExistingBuild())) {
    saveMarker(hash);
    return;
  }

  console.log(marker && !flag('--rebuild') ? '  La partie native a changé depuis le dernier build.' : '  Premier build : environ 15 min dans le cloud EAS.');
  const r = run('npx', [...EAS, 'build', '-p', 'android', '--profile', 'development'], { cwd: MOBILE, inherit: true });
  if (r.code !== 0) fail('Le build EAS a échoué (voir le lien du journal ci-dessus).');
  saveMarker(hash);
  console.log(`\n  ${bold('Sur le téléphone :')} scanne le QR code ci-dessus, installe l’APK, puis ouvre l’app Zelo.`);
}

async function askExistingBuild() {
  const r = run('npx', [...EAS, 'build:list', '-p', 'android', '-e', 'development', '--status', 'finished', '--limit', '1', '--json', '--non-interactive'], { cwd: MOBILE });
  let last;
  try {
    last = JSON.parse(r.out)[0];
  } catch {
    return false;
  }
  if (!last) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const when = new Date(last.completedAt ?? last.createdAt).toLocaleString('fr-FR');
  const answer = await rl.question(`  Un build existe déjà (${when}). Est-il installé sur ton téléphone ? [O/n] `);
  rl.close();
  return !/^n/i.test(answer.trim());
}

function saveMarker(fingerprint) {
  mkdirSync(dirname(MARKER), { recursive: true });
  writeFileSync(MARKER, JSON.stringify({ fingerprint, builtAt: new Date().toISOString() }, null, 2));
}

function startMetro(ip, apiUrl) {
  step('Serveur de développement (Metro)');
  console.log(`  Dans l’app Zelo sur le téléphone${flag('--tunnel') ? '' : ' (même Wi-Fi que le PC)'}, scanne le QR code ci-dessous.`);
  console.log(dim(`  API utilisée par l’app : ${apiUrl} · Ctrl+C pour quitter\n`));
  const tunnel = flag('--tunnel');
  if (tunnel) console.log(dim('  Mode tunnel : le téléphone peut être en 4G ; Expo installe @expo/ngrok au premier usage.'));
  const [file, argv, shell] = command('npx', ['expo', 'start', '--dev-client', ...(tunnel ? ['--tunnel'] : [])]);
  const child = spawn(file, argv, {
    cwd: MOBILE,
    stdio: 'inherit',
    shell,
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: apiUrl,
      // Sans ça, Expo peut mettre dans le QR code l'IP d'une carte virtuelle (WSL, Docker…).
      ...(tunnel ? {} : { REACT_NATIVE_PACKAGER_HOSTNAME: ip }),
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

// --- Utilitaires -------------------------------------------------------------

/** Adresse IPv4 du PC sur le réseau local, en écartant les cartes virtuelles. */
function lanAddress() {
  const virtual = /vethernet|wsl|docker|vmware|virtualbox|vbox|hyper-v|br-|veth|utun|tailscale|zerotier|loopback/i;
  const rank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3);
  const candidates = Object.entries(networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([, addrs]) => addrs ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a.address)
    .sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

const mtime = (path) => (existsSync(path) ? statSync(path).mtimeMs : 0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------

if (args[0] === 'stop') {
  step('Arrêt de l’API et de la base');
  const r = run('docker', [...COMPOSE, 'stop'], { inherit: true });
  process.exit(r.code);
}

await main();
