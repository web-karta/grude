(function () {
  'use strict';
  const DATA = window.BETA_DATA || {};
  if (!DATA.REDOSLIJED_TXT || !DATA.POLASCI_TXT) {
  console.warn('[BETA] Missing embedded TXT data (REDOSLIJED_TXT / POLASCI_TXT).');
  return;
  }

  function formatDateTime(d = new Date()) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();

  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());

  return `${dd}. ${mm}. ${yyyy}., ${hh}:${mi}:${ss}`;
  }

  const DAY = 24 * 3600;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pad2 = (n) => String(n).padStart(2, '0');

  const parseTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t || '').trim());
  return m ? (+m[1] * 3600 + +m[2] * 60) : null;
  };
    
  const DEPOT_PRE  = 5 * 60;
  const DEPOT_POST = 5 * 60;
  const DWELL_TIME = 7;
  const STOP_EPS = 10;

  function isDepotEnd(routeKey) {
  return /-S$/.test(routeKey || '');
  }

  const nowSec = () => {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  };

  const SPECIAL_MD = new Set([
  '01-01','01-02','01-03','01-04','01-05','01-06',
  '03-01',
  '04-02','04-03','04-04','04-05','04-06',
  '05-01','05-02',
  '05-30',
  '06-04','06-22',
  '08-05','08-15',
  '11-01','11-02','11-18','11-25',
  '12-24','12-25','12-26','12-27','12-28','12-29','12-30','12-31'
  ]);

  function isSpecialDay(d = new Date()) {
  const md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  return SPECIAL_MD.has(md);
  }

  const SATURDAY_DISABLED_VEHICLES = new Set(['21', '32', '42', '52', '62', '72']);
  const SUNDAY_DISABLED_VEHICLES = new Set(['21', '32', '42', '52', '62', '72']);

  function isSaturday(d = new Date()) {
  return d.getDay() === 6;
  }

  function isSunday(d = new Date()) {
  return d.getDay() === 0;
  }

  function isVehicleDisabledToday(vozilo) {
  const v = String(vozilo || '').trim();

  if (isSaturday() && SATURDAY_DISABLED_VEHICLES.has(v)) {
  return true;
  }

  if (isSunday() && SUNDAY_DISABLED_VEHICLES.has(v)) {
  return true;
  }

  return false;
  }

  function tripAllowedNow(tr, tNowSec) {
  if (isSpecialDay()) {
  return false;
  }
  const v = String(tr.vozilo || '').trim();
  if (isSaturday() && SATURDAY_DISABLED_VEHICLES.has(v)) {
  return false;
  }
  if (isSunday() && SUNDAY_DISABLED_VEHICLES.has(v)) {
  return false;
  }
  return true;
  }

  const hav = (a, b) => {
  const R = 6371000, toR = (x) => x * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const la1 = toR(a[0]), la2 = toR(b[0]);
  const h = Math.sin(dLat / 2) ** 2 +
  Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const bearing = (a, b) => {
  const toR = (x) => x * Math.PI / 180, toD = (x) => x * 180 / Math.PI;
  const y = Math.sin(toR(b[1] - a[1])) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) -
  Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(toR(b[1] - a[1]));
  const ang = (toD(Math.atan2(y, x)) + 360) % 360;
  return Number.isFinite(ang) ? ang : 0;
  };

  function isActiveTrip(tr, t) {
  if (t >= tr._t0 && t <= tr._t1 + 1) return true;
  if (tr._t1 >= DAY) {
  const t1wrap = tr._t1 - DAY;
  if (t <= t1wrap) return true;
  }
  return false;
  }

  function formatMinsSmart(secondsLeft) {
  if (secondsLeft <= 30) {
  return { label: '<1 min.', sortMin: 0 };
  }
  if (secondsLeft < 90) {
  return { label: '1 min.', sortMin: 1 };
  }
  const mins = Math.round(secondsLeft / 60);
  return { label: `${mins} min.`, sortMin: mins };
  }


  const routeStations = new Map();
  const routeEndpoints = new Map();

  function parsePointWKT(s) {
  s = String(s || '').trim();
  const m = /^POINT\(([^)]+)\)$/i.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[ ,]+/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
  }

  let firstDataSeen = false;
  DATA.REDOSLIJED_TXT.split(/\r?\n/).forEach((l) => {
  l = (l || '').trim();
  if (!l || l.startsWith('#')) return;
  const p = l.split(';').map(x => (x ?? '').trim());
  if (!firstDataSeen && p[0].toLowerCase() === 'linija') {
  firstDataSeen = true;
  return;
  }
  firstDataSeen = true;

  if (p.length >= 4 && p[2]) {
  const key = p[0];
  const ids = p[2].split(',').map(s => s.trim()).filter(Boolean);
  if (key && ids.length) routeStations.set(key, ids);
  const st = parsePointWKT(p[1]);
  const en = parsePointWKT(p[3]);
  if (st || en) routeEndpoints.set(key, { start: st, end: en });
  return;
  }

  if (p.length >= 2) {
  const key = p[0];
  const ids = p[1].split(',').map(s => s.trim()).filter(Boolean);
  if (key && ids.length) routeStations.set(key, ids);
  }
  });

  const trips = [];
  const rows = DATA.POLASCI_TXT.split(/\r?\n/).filter(Boolean);
  const head = (rows.shift() || '').split(',').map(s => s.toLowerCase().trim());

  rows.forEach((r) => {
  const o = {};
  r.split(',').forEach((v, i) => o[head[i]] = (v ?? '').trim());
  o.linija = (o.linija || '').trim();
  o.vozilo = (o.vozilo || '').trim();
  o.smjer = (o.smjer || '').trim().toLowerCase();
  o.okretište = (o['okretište'] || o.okretiste || o.okretište || '').trim();
  o.vrijeme = (o.vrijeme || '').trim();
  o.trajanje = Number((o.trajanje || '').trim());
  o.red = (o.red || '').trim();
  o._t0 = parseTime(o.vrijeme);
  if (!o.linija || !o.vozilo || o._t0 == null || !Number.isFinite(o.trajanje)) return;
  o._t1 = o._t0 + o.trajanje * 60;
  trips.push(o);
  });

  const stationById = new Map();
  (stanice.features || []).forEach((f) => {
    const id = String(f.properties?.ID ?? '').trim();
    if (!id) return;
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) return;
    stationById.set(id, { latlng: [c[1], c[0]], name: String(f.properties?.Stanica ?? '') });
  });

  const TERM_CODE = {'Gomilice': 'G', 'Otok': 'O', 'Prispa': 'PR', 'Gorica': 'GO', 'Ružići': 'R', 'Drinovci': 'D', 'Ledinac': 'L', 'Drinovačko Brdo': 'DB', 'Tihaljina': 'T', 'Rupine': 'RU',
  'Puteševica': 'P', 'Medovići': 'M', 'Cere': 'C', 'Borajna': 'B', 'Peć Mlini': 'PM', 'Spremište Boboška': 'S'};
  function pickRouteKeyForTrip(trip) {
  if (trip.red) {
  const rk = String(trip.red).trim();
  if (routeStations.has(rk)) {
  return rk;
  }
  }
  
  const line = String(trip.linija || '').trim();
  const termRaw = String(trip.okretište || '').trim();
  const code = TERM_CODE[termRaw];

  const prefix = line + '_';
  const candidates = [];
  for (const k of routeStations.keys()) if (k.startsWith(prefix)) candidates.push(k);
  if (!candidates.length) return null;

  function fallbackDepot(smjer) {
  const L = String(line || '').toUpperCase();
  const looksDepotLine = L.endsWith('S') || L === 'P1S' || L === 'P2S';
  if (!looksDepotLine) return null;
  if (smjer.includes('prema')) {
  const out = candidates.filter(k => /_S-/.test(k));
  return out[0] || null;
  }
  if (smjer.includes('od')) {
  const back = candidates.filter(k => /-S$/.test(k));
  return back[0] || null;
  }
  return null;
  }
  
  const smjer = String(trip.smjer || '').toLowerCase();
  
  if (code) {
  if (smjer.includes('prema')) {
  const exact = candidates.filter(k => k.endsWith('-' + code));
  return exact[0] || null;
  }
  if (smjer.includes('od')) {
  const exact = candidates.filter(k => k.includes('_' + code + '-'));
  return exact[0] || null;
  }
  }

  const fb = fallbackDepot(smjer);
  if (fb) return fb;
  if (candidates.length === 1) return candidates[0];
  return null;
  }

  function isDepotStart(routeKey) {
  return (routeKey || '').includes('_S-');
  }

  function displayLineForVehicle(tr, routeKey) {
  if (routeKey && isDepotEnd(routeKey)) {
  return 'S';
  }

  return String(tr.linija || '').replace(/S$/, '');
  }

  const routeCache = new Map();
  const nodeKey = (latlng) => latlng[0].toFixed(6) + ',' + latlng[1].toFixed(6);

  const routeStationDistCache = new Map();

  function nearestPointIndexOnPolyline(poly, latlng) {
  let bestI = 0, bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
  const d = hav(poly[i], latlng);
  if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
  }

  function getRouteStationDistances(routeKey) {
  if (routeStationDistCache.has(routeKey)) return routeStationDistCache.get(routeKey);
  const ids = routeStations.get(routeKey);
  const r = buildRoute(routeKey);
  if (!ids || ids.length < 2 || !r || !r.poly || r.poly.length < 2) {
  routeStationDistCache.set(routeKey, null);
  return null;
  }

  const out = [];
  for (const id of ids) {
  const st = stationById.get(String(id));
  if (!st) continue;
  const idx = nearestPointIndexOnPolyline(r.poly, st.latlng);
  const dist = r.cum[idx] ?? 0;
  out.push({ id: String(id), name: st.name || '', dist });
  }

  out.sort((a,b)=>a.dist - b.dist);

  routeStationDistCache.set(routeKey, out);
  return out;
  }

  function getNextStopByDistance(routeKey, currentDistMeters) {
  const list = getRouteStationDistances(routeKey);
  if (!list || !list.length) return null;

  const EPS = 8;

  for (let i = 0; i < list.length; i++) {
  if (list[i].dist > currentDistMeters + EPS) {
  return list[i];
  }
  }
  return null;
  }

  function arrivalsForStation(stationId, tNow) {
  const best = [];

  const tripsByLineDir = new Map();
  for (const tr of trips) {
  const rk = pickRouteKeyForTrip(tr);
  if (!rk) continue;

  if (!tripAllowedNow(tr, tNow)) continue;

  const key = tr.linija + '|' + rk;
  if (!tripsByLineDir.has(key)) tripsByLineDir.set(key, []);
  tripsByLineDir.get(key).push(tr);
  }

  for (const [key, arr] of tripsByLineDir.entries()) {
  arr.sort((a, b) => a._t0 - b._t0);

  let tr = null;

  for (const cand of arr) {
  if (isActiveTrip(cand, tNow)) {
  tr = cand;
  break;
  }
  if (cand._t0 > tNow) {
  tr = cand;
  break;
  }
  }

  if (!tr) continue;
  const rk = pickRouteKeyForTrip(tr);
  const list = getRouteStationDistances(rk);
  if (!list) continue;
  const st = list.find(x => x.id === stationId);
  if (!st) continue;
  const r = buildRoute(rk);
  if (!r || r.total <= 0) continue;

  let secondsLeft;

  if (isActiveTrip(tr, tNow)) {
  let tInTrip = tNow;
  if (tr._t1 >= DAY && tNow < tr._t0) tInTrip = tNow + DAY;

  const tripDur = (tr._t1 - tr._t0);
  const tRel = clamp(tInTrip - tr._t0, 0, tripDur);
  const nStops = list.length;
  const dwellTotal = Math.max(0, (nStops - 1) * DWELL_TIME);
  const runTime = Math.max(1, tripDur - dwellTotal);
  const stIndex = list.indexOf(st);
  const arriveRun = (st.dist / r.total) * runTime;
  const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;

  if (tRel >= arriveReal + DWELL_TIME) continue;
  secondsLeft = Math.max(0, arriveReal - tRel);

  } else {
  let untilStart = tr._t0 - tNow;
  if (untilStart < 0) untilStart += DAY;
  if (untilStart > 15 * 60) continue;
  const tripDur = (tr._t1 - tr._t0);
  const nStops = list.length;
  const dwellTotal = Math.max(0, (nStops - 2) * DWELL_TIME);
  const runTime = Math.max(1, tripDur - dwellTotal);
  const stIndex = list.indexOf(st);
  const arriveRun  = (st.dist / r.total) * runTime;
  const arriveReal = arriveRun + Math.max(0, (stIndex - 1)) * DWELL_TIME;
  secondsLeft = untilStart + arriveReal;
  }

  if (secondsLeft < 0 || secondsLeft > 15 * 60) continue;
  const fmt = formatMinsSmart(secondsLeft);

  best.push({
  linija: tr.linija,
  smjer: destFromRouteKey(rk),
  label: fmt.label,
  sortMin: fmt.sortMin,
  secondsLeft: secondsLeft
  });
  }

  return best.sort((a, b) => {
  if (a.secondsLeft !== b.secondsLeft) {
  return a.secondsLeft - b.secondsLeft;
  }

  return String(a.linija).localeCompare(String(b.linija), 'hr');
  });
  }

  function buildGraphForRoute(routeKey) {
  const nodes = new Map();
  function ensureNode(latlng) {
  const k = nodeKey(latlng);
  if (!nodes.has(k)) nodes.set(k, { latlng, edges: [] });
  return k;
  }

  const feats = (mreza.features || []);
  for (const f of feats) {
  const segs = String(f.properties?.Segmenti ?? '');
  const segList = segs.split(',').map(s => s.trim()).filter(Boolean);
  if (!segList.includes(routeKey)) continue;
  const geom = f.geometry;
  if (!geom) continue;
  let coords = [];
  if (geom.type === 'LineString') coords = geom.coordinates;
  else if (geom.type === 'MultiLineString') coords = geom.coordinates.flat();
  if (!coords.length) continue;
  const latlngs = coords.map(c => [c[1], c[0]]);

  for (let i = 1; i < latlngs.length; i++) {
  const a = latlngs[i - 1];
  const b = latlngs[i];
  const ka = ensureNode(a);
  const kb = ensureNode(b);
  const w = hav(a, b);
  const segCoords = [a, b];
  nodes.get(ka).edges.push({ to: kb, coords: segCoords, w });
  nodes.get(kb).edges.push({ to: ka, coords: segCoords.slice().reverse(), w });
  }
  }
  return nodes;
  }

  function nearestNodeKey(nodes, targetLatLng) {
  let bestK = null, bestD = Infinity;
  for (const [k, n] of nodes.entries()) {
  const d = hav(n.latlng, targetLatLng);
  if (d < bestD) { bestD = d; bestK = k; }
  }
  return bestK;
  }

  function dijkstra(nodes, startK, goalK) {
  if (startK === goalK) return [];
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  for (const k of nodes.keys()) dist.set(k, Infinity);
  dist.set(startK, 0);
  while (true) {
  let u = null, best = Infinity;
  for (const [k, d] of dist.entries()) {
  if (visited.has(k)) continue;
  if (d < best) { best = d; u = k; }
  }
  if (u === null) break;
  if (u === goalK) break;
  visited.add(u);
  const uNode = nodes.get(u);
  if (!uNode) continue;

  for (const e of uNode.edges) {
  const alt = best + e.w;
  if (alt < (dist.get(e.to) ?? Infinity)) {
  dist.set(e.to, alt);
  prev.set(e.to, { from: u, edge: e });
  }
  }
  }

  if (!prev.has(goalK)) return null;
  const edges = [];
  let cur = goalK;
  while (cur !== startK) {
  const p = prev.get(cur);
  if (!p) return null;
  edges.push(p.edge);
  cur = p.from;
  }
  edges.reverse();
  return edges;
  }

  function buildRoute(key) {
  if (routeCache.has(key)) return routeCache.get(key);
  const stIds = routeStations.get(key);
  if (!stIds || stIds.length < 2) return null;
  const nodes = buildGraphForRoute(key);
  if (!nodes || nodes.size === 0) return null;
  const ep = routeEndpoints.get(key) || {};
  const waypoints = [];
  if (ep.start) waypoints.push(ep.start);
  for (const id of stIds) {
  const st = stationById.get(String(id));
  if (st?.latlng) waypoints.push(st.latlng);
  }
  if (ep.end) waypoints.push(ep.end);
  if (waypoints.length < 2) return null;
  let poly = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
  const A = waypoints[i];
  const B = waypoints[i + 1];
  if (!A || !B) continue;
  const startK = nearestNodeKey(nodes, A);
  const goalK = nearestNodeKey(nodes, B);
  if (!startK || !goalK) continue;
  const edges = dijkstra(nodes, startK, goalK);
  if (!edges) continue;
  for (const e of edges) {
  if (!poly.length) poly = poly.concat(e.coords);
  else poly = poly.concat(e.coords.slice(1));
  }
  }

  if (poly.length < 2) return null;

  const cum = [0];
  let total = 0;
  for (let i = 1; i < poly.length; i++) {
  total += hav(poly[i - 1], poly[i]);
  cum.push(total);
  }

  total = cum[cum.length - 1] || total;

  const out = { poly, cum, total };
  routeCache.set(key, out);
  return out;
  }

  function pointAt(route, distMeters) {
  const { poly, cum, total } = route;
  const d = clamp(distMeters, 0, total);
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
  const mid = (lo + hi) >> 1;
  if (cum[mid] < d) lo = mid + 1;
  else hi = mid;
  }
  const i = Math.max(1, lo);
  const d0 = cum[i - 1];
  const d1 = cum[i];
  const t = (d1 === d0) ? 0 : (d - d0) / (d1 - d0);
  const a = poly[i - 1];
  const b = poly[i];
  const lat = a[0] + (b[0] - a[0]) * t;
  const lng = a[1] + (b[1] - a[1]) * t;

  const ang = bearing(a, b);

  return { latlng: [lat, lng], angle: ang };
  }

  const BLUE = 'rgb(18,100,171)';

  function makeVehicleIcon(label, angleDeg, showArrow, color) {
  const C = color || BLUE;
  const W = 66;           
  const H = 66;       
  const cx = 33, cy = 33; 
  const r  = 16.5;
  const gap = -2;
  const baseW = 18;
  const baseH = 10;
  const tipL  = 14;
  const round = 6;
  const baseY = cy - r - gap;
  const tipY  = baseY - tipL;
  const arrowPath = `
  M ${cx - baseW/2} ${baseY}
  L ${cx} ${tipY}
  L ${cx + baseW/2} ${baseY}
  Q ${cx + baseW/2 - round} ${baseY + baseH} ${cx} ${baseY + baseH}
  Q ${cx - baseW/2 + round} ${baseY + baseH} ${cx - baseW/2} ${baseY}
  Z
  `;

  const arrow = showArrow
  ? `<g transform="rotate(${angleDeg},${cx},${cy})">
  <path d="${arrowPath}" fill="${C}"></path>
  </g>`
  : '';

  const svg = `
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${arrow}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C}" stroke="white" stroke-width="2"></circle>
  <text x="${cx}" y="${cy+5}" text-anchor="middle"
  font-size="14" font-weight="700" fill="white"
  font-family="Arial, sans-serif">${label}</text>
  </svg>
  `;

  return L.divIcon({
  html: svg,
  className: 'beta-vehicle-icon',
  iconSize: [W, H],
  iconAnchor: [W/2, H/2]
  });
  }

  const DEST_LABEL = {G: 'GOMILICE', O: 'OTOK', PR: 'PRISPA', GO: 'GORICA', R: 'RUŽIĆI', D: 'DRINOVCI', L: 'LEDINAC', DB: 'DRINOVAČKO BRDO', 
  T: 'TIHALJINA', RU: 'RUPINE', P: 'PUTEŠEVICA', M: 'MEDOVIĆI', C: 'CERE', B: 'BORAJNA', PM: 'PEĆ MLINI', S: 'SPREMIŠTE BOBOŠKA'};
  
  const DEST_DISPLAY_OVERRIDE = {};

  const VIA_BY_DEST = {
  '1': {
    'OTOK': '(Grad — Prispa)',
    'GOMILICE': '(Prispa — Grad)'
    },
  '2': {
    'PRISPA': '(Krištelica — Boboška)',
    'GOMILICE': '(Boboška — Krištelica)'
    },
  '3': {
    'RUŽIĆI': '(Sovići — Seline)',
    'GORICA': '(Seline — Sovići)'
    },
  '4': {
    'LEDINAC': '(Blaževići — Dragićina)',
    'DRINOVCI': '(Dragićina — Blaževići)'
    },
  '5': {
    'LEDINAC': '(Sovići — Višnjica)',
    'DRINOVAČKO BRDO': '(Višnjica — Sovići)'
    },
  '6': {
    'RUPINE': '(Drinovci — Alagovac)',
    'TIHALJINA': '(Alagovac — Drinovci)'
    },
  '7': {
    'MEDOVIĆI': '(Tihaljina — Seline)',
    'PUTEŠEVICA': '(Seline — Tihaljina)'
    },
  '8': {
    'BORAJNA': '(Ružići — Cerov Dolac)',
    'CERE': '(Cerov Dolac — Ružići)'
    },
  '9': {
    'BORAJNA': '(Blaževići — Poljanice)',
    'PEĆ MLINI': '(Poljanice — Blaževići)'
    }
    };

  function destFromRouteKey(routeKey) {
  if (!routeKey) return '';
  const m = /-([A-Z0-9]+)$/.exec(routeKey);
  if (!m) return '';

  const destCode = m[1];
  const line = routeKey.split('_')[0];

  const override =
  DEST_DISPLAY_OVERRIDE?.[line]?.[destCode];
  if (override) return override;
  return DEST_LABEL[destCode] || destCode;
  }

  function popupHtml(tr, state) {
  const dest = destFromRouteKey(state.routeKey || '');
  const baseLine = String(tr.linija || '').replace(/S$/, '');

  const via =
  VIA_BY_DEST?.[baseLine]?.[dest] || '';

  const viaText = via
  ? `<div class="beta-popup-via">${via}</div>`
  : '';

  const displayLine = displayLineForVehicle(tr, state.routeKey);
  if (!document.getElementById('betaLedCss')) {
  const st = document.createElement('style');
  st.id = 'betaLedCss';
  st.textContent = `
  .beta-led-text{
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  background-image:
  radial-gradient(circle,
  #f4ff6a 0 1.15px,
  transparent 1.25px
  );
  background-size: 2.5px 2.5px;
  background-position: 0 0;
  -webkit-background-clip: text;
  background-clip: text;
  filter: none;
  letter-spacing: 1px;
  text-transform: uppercase;
  white-space: nowrap;
  }
  background-image: radial-gradient(circle, rgba(215,247,180,0.98) 0 1.35px, transparent 1.55px);
  background-size: 6px 6px;
  background-position: 0 0;
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 0 1px rgba(215,247,180,0.75))
  drop-shadow(0 0 2px rgba(215,247,180,0.35));
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  }
  `;
  document.head.appendChild(st);
  }

  const line1 = `
  <div class="beta-popup-header">
  <span class="beta-led-text">${displayLine} ${dest}</span>
  </div>
  `;

  let minsLabel = '?';
  if (typeof state.secondsLeft === 'number') {
  minsLabel = formatMinsSmart(state.secondsLeft).label;
  }

  let line2;
  if (state.mode === 'moving') {
  line2 = `<div class="beta-popup-row"><span class="beta-popup-icon">⏱️</span>: za ${minsLabel}</div>`;
  } else {
  if (state.secondsLeft == null) {
  line2 = `<div class="beta-popup-row">Nema više polazaka.</div>`;
  } else {
  line2 = `<div class="beta-popup-row">Polazak: za ${minsLabel}</div>`;
  }
  }

  const line3 =
  (state.mode === 'moving' && state.nextStopName)
  ? `<div class="beta-popup-row"><span class="beta-popup-icon">🚋</span>: ${state.nextStopName}</div>`    : '';

  return [line1, viaText, line2, line3]
  .filter(Boolean)
  .join('<br>');
  }

  const STATION_FOCUS_ZOOM = 12;

  function ensureFilterUI() {
  if (document.getElementById('betaFilter')) return;

  const DEST_NAME = {G: 'Gomilice', O: 'Otok', PR: 'Prispa', GO: 'Gorica', R: 'Ružići', D: 'Drinovci', L: 'Ledinac', DB: 'Drinovačko Brdo',
  T: 'Tihaljina', RU: 'Rupine', P: 'Puteševica', M: 'Medovići', C: 'Cere', B: 'Borajna', PM: 'Peć Mlini', S: 'Spremište Boboška'};

  function destCodeFromDir(dirCode) {
  const parts = String(dirCode || '').split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
  }

  function dirLabel(dirCode) {
  const code = destCodeFromDir(dirCode);
  return DEST_NAME[code] || code || dirCode;
  }

const div = document.createElement('div');
div.id = 'betaFilter';
div.className = 'beta-bus-panel';
div.style.display = 'none';
  div.innerHTML = `
  <div style="font-weight:700;margin-bottom:6px;text-align:center">Autobusne linije</div>
  <select id="betaLineSel" style="width:190px;margin-bottom:6px"></select><br>
  <select id="betaDirSel" style="width:190px;margin-bottom:6px"></select><br>
  <select id="betaStationSel" style="width:190px;margin-bottom:6px"></select><br>
  <button id="betaClear" style="width:190px">Prikaži sve</button>
  <div id="betaClock" style="margin-top:8px;font-size:12px;opacity:.8;text-align:center"></div>
  `;

  document.body.appendChild(div);
  if (!document.getElementById('betaFilterCss')) {
  const style = document.createElement('style');
  style.id = 'betaFilterCss';
  style.textContent = `
  #betaFilter,
  #betaFilter select,
  #betaFilter button {
  font-family: "PT Sans", Arial, sans-serif !important;
  }
  #betaFilter select {
  font-size: 13px;
  }

  #betaFilter button {
  font-size: 13px;
  cursor: pointer;
  }
  `;
  document.head.appendChild(style);
  }

  const lineSel = document.getElementById('betaLineSel');
  const dirSel  = document.getElementById('betaDirSel');
  const clearBtn= document.getElementById('betaClear');
  const stationSel = document.getElementById('betaStationSel');
  const stationsSorted = Array.from(stationById.entries())
  .map(([id, s]) => ({ id, name: s.name, latlng: s.latlng }))
  .sort((a, b) => a.name.localeCompare(b.name, 'hr'));

  stationSel.innerHTML =
  `<option value="">Prikaz svih stanica</option>` +
  stationsSorted.map(s =>
  `<option value="${s.id}">${s.name}</option>`
  ).join('');

  stationSel.addEventListener('change', () => {
  closeBetaPanels();
  clearStationSelection();
  const id = stationSel.value;
  if (!id) return;
  const st = stationById.get(id);
  if (!st) return;
  const m = L.circleMarker(st.latlng, {
  radius: 0,
  opacity: 0,
  fillOpacity: 0,
  interactive: true
  }).addTo(stationLayer);
  let popupTimer = null;

  function updatePopup() {
  const arr = arrivalsForStation(id, nowSec());

  const html =
  `<b>${st.name}</b><hr style="margin:4px 0">` +
  (arr.length
  ? arr.map(a =>
  `${a.linija} ${a.smjer} (${a.label})`
  ).join('<br>')
  : 'Nema skorih dolazaka.');

  if (!m.getPopup()) {
  m.bindPopup(html, {
  className: 'beta-station-popup',
  autoClose: true,
  closeOnClick: false,
  offset: L.point(0, -2)
  }).openPopup();    } else {
  m.setPopupContent(html).openPopup();
  }
  }

  updatePopup();

  popupTimer = setInterval(updatePopup, 2000);

  m.on('popupclose', () => {
  if (popupTimer) clearInterval(popupTimer);
  });

  map.setView(st.latlng, STATION_FOCUS_ZOOM);});

  const allKeys = Array.from(routeStations.keys());
  const lineNames = Array.from(new Set(
  allKeys
  .map(k => k.split('_')[0])
  .filter(l =>
  l &&
  !String(l).includes('S') &&
  String(l).toLowerCase() !== 'linija'
  )
  )).sort((a,b)=>a.localeCompare(b,'hr'));

  lineSel.innerHTML =
    `<option value="">Prikaz svih linija</option>` +
    lineNames.map(l => `<option value="${l}">${l}</option>`).join('');

  function populateDirs() {
  const chosenLine = lineSel.value;
  const keysForDirs = allKeys.filter(k => {
  const ln = k.split('_')[0];
  if (!ln || String(ln).includes('S')) return false;
  if (chosenLine && ln !== chosenLine) return false;
  return true;
  });

  const labelToDir = new Map();
  for (const k of keysForDirs) {
  const parts = k.split('_');
  if (parts.length < 2) continue;
  const dirCode = parts[1];
  if (!dirCode) continue;
  const label = dirLabel(dirCode);
  if (!label || label === 'undefined') continue;
  if (!labelToDir.has(label)) labelToDir.set(label, dirCode);
  }

  const labelsSorted = Array.from(labelToDir.keys())
  .sort((a, b) => a.localeCompare(b, 'hr'));

  dirSel.innerHTML =
  `<option value="">Prikaz svih smjerova</option>` +
  labelsSorted
  .map(lbl => `<option value="${labelToDir.get(lbl)}">${lbl}</option>`)
  .join('');
  }
  lineSel.addEventListener('change', populateDirs);
  populateDirs();

  clearBtn.addEventListener('click', () => {
  lineSel.value = '';
  populateDirs();
  dirSel.value = '';
  stationSel.value = '';
  if (typeof clearStationSelection === 'function') {
  clearStationSelection();
  }
  });
  }
  ensureFilterUI();

  map.createPane('selectedRoutePane');
  map.getPane('selectedRoutePane').style.zIndex = 560;

  const selectedRouteLayer = L.layerGroup().addTo(map);

  function highlightNetwork(routeKey) {
  if (highlightedRouteKey === routeKey) return;

  highlightedRouteKey = routeKey;
  selectedRouteLayer.clearLayers();

  if (!routeKey || !mreza || !mreza.features) return;

  mreza.features.forEach((f) => {
  const segs = String(f.properties?.Segmenti ?? '');
  const has = segs.split(',').map(s => s.trim()).includes(routeKey);

  if (!has) return;

  const geom = f.geometry;
  if (!geom) return;

  if (geom.type === 'LineString') {
  const latlngs = geom.coordinates.map(c => [c[1], c[0]]);

  L.polyline(latlngs, {
  pane: 'selectedRoutePane',
  color: 'red',
  weight: 5,
  opacity: 1,
  interactive: false
  }).addTo(selectedRouteLayer);
  }

  if (geom.type === 'MultiLineString') {
  geom.coordinates.forEach(part => {
  const latlngs = part.map(c => [c[1], c[0]]);

  L.polyline(latlngs, {
  pane: 'selectedRoutePane',
  color: 'red',
  weight: 5,
  opacity: 1,
  interactive: false
  }).addTo(selectedRouteLayer);
  });
  }
  });
  }

  function resetNetworkHighlight() {
  highlightedRouteKey = null;
  selectedRouteLayer.clearLayers();
  }

  const stationLayer = L.layerGroup().addTo(map);

  function clearStationSelection() {
  stationLayer.clearLayers();
  const info = document.getElementById('betaStationInfo');
  if (info) info.textContent = 'Prikaži sve stanice';
  }

  const tripsByVehicle = new Map();
  for (const tr of trips) {
  if (!tripsByVehicle.has(tr.vozilo)) tripsByVehicle.set(tr.vozilo, []);
  tripsByVehicle.get(tr.vozilo).push(tr);
  }
  for (const arr of tripsByVehicle.values()) arr.sort((a, b) => a._t0 - b._t0);

  function findPrevNext(arr, t) {
  let prev = null, next = null;
  for (const tr of arr) {
  if (tr._t0 <= t) prev = tr;
  if (tr._t0 > t) { next = tr; break; }
  }
  return { prev, next };
  }

  const layer = L.layerGroup().addTo(map);
  const markers = new Map();

  let selectedVehicleId = null;
  let selectedRouteKey = null;
  let highlightedRouteKey = null;

  const lastRouteKeyByVehicle = new Map();
  const lastActiveT0ByVehicle = new Map();
  const lastPosByVehicle = new Map();

  function render() {
  const t = nowSec();
  const clk = document.getElementById('betaClock');
  if (clk) clk.textContent = formatDateTime();
  const lineSel = document.getElementById('betaLineSel');
  const dirSel = document.getElementById('betaDirSel');
  const selectedLine = lineSel?.value || '';
  const selectedDir = dirSel?.value || '';
  const selectedRouteKeyFilter = (selectedLine && selectedDir) ? `${selectedLine}_${selectedDir}` : '';
  if (!selectedVehicleId) resetNetworkHighlight();
  for (const [vozilo, arr] of tripsByVehicle.entries()) {
  let pos = null;
  let ang = 0;
  let showArrow = false;
  let trForLabel = null;
  let rk = null;
  let popupState = null;
  let activeAny = null;
  for (let i = arr.length - 1; i >= 0; i--) {
  const trX = arr[i];
  if (!tripAllowedNow(trX, t)) continue;
  if (isActiveTrip(trX, t)) { activeAny = trX; break; }
  }

  const arrAllowed = arr.filter(tr => tripAllowedNow(tr, t));
  const arrService = arrAllowed;

  const lastRealTrip = arr[arr.length - 1] || null;

  if (!arrAllowed.length && !activeAny) {

  const prevAll = arr[arr.length - 1];
  const prevKey = prevAll ? pickRouteKeyForTrip(prevAll) : null;
  const endsDepot = prevAll && prevKey && isDepotEnd(prevKey);

  if (!endsDepot) {
  const existing = markers.get(vozilo);
  if (existing) {
  layer.removeLayer(existing);
  markers.delete(vozilo);
  }
  continue;
  }

  if (t > prevAll._t1 + DEPOT_POST) {
  const existing = markers.get(vozilo);
  if (existing) {
  layer.removeLayer(existing);
  markers.delete(vozilo);
  }
  continue;
  }
  }

  const { prev, next } = findPrevNext(arrService, t);
  
  if (
  !arrAllowed.length &&
  !activeAny &&
  isVehicleDisabledToday(vozilo)
  ) {
  const ex = markers.get(vozilo);
  if (ex) {
  layer.removeLayer(ex);
  markers.delete(vozilo);
  }
  continue;
  }

  if (!prev && !next) {
  const lastFinished = arr
  .filter(tr => t >= tr._t1)
  .sort((a, b) => b._t1 - a._t1)[0];

  if (!lastFinished) {
  } else {
  if (!tripAllowedNow(lastFinished, t)) {
  const ex = markers.get(vozilo);
  if (ex) { layer.removeLayer(ex); markers.delete(vozilo); }
  continue;
  }

  const lastKey =
  lastRouteKeyByVehicle.get(vozilo) ||
  pickRouteKeyForTrip(lastFinished);
  
  if (lastKey && !isDepotEnd(lastKey)) {
  const rLast = buildRoute(lastKey);
  const endPos =
  rLast && rLast.poly && rLast.poly.length
  ? rLast.poly[rLast.poly.length - 1]
  : (lastPosByVehicle.get(vozilo) || null);

  if (endPos) {
  pos = endPos;
  rk = lastKey;
  trForLabel = lastFinished;
  showArrow = false;
  popupState = {
  mode: 'waiting',
  secondsLeft: null,
  routeKey: lastKey,
  networkRouteKey: lastKey,
  nextStopName: null
  };
  }
  }
  }
  }

  let active = null;
  for (let i = arr.length - 1; i >= 0; i--) {
  const tr = arr[i];
  if (isActiveTrip(tr, t)) {
  active = tr;
  break;
  }
  }

  if (active) {

  const lastT0 = lastActiveT0ByVehicle.get(vozilo);
  if (lastT0 !== active._t0) {
  const rkNew = pickRouteKeyForTrip(active);
  if (rkNew) {
  rk = rkNew;
  lastRouteKeyByVehicle.set(vozilo, rkNew);
  } else {
  rk = lastRouteKeyByVehicle.get(vozilo) || null;
  }
  lastActiveT0ByVehicle.set(vozilo, active._t0);
  } else {
  rk = lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(active);
  if (rk) lastRouteKeyByVehicle.set(vozilo, rk);
  }

  const r = rk ? buildRoute(rk) : null;
  trForLabel = active;

  let frac = 0;

  if (r && r.total > 0) {
  let tInTrip = t;
  if (active._t1 >= DAY && t < active._t0) tInTrip = t + DAY;

  const tRel = clamp(tInTrip - active._t0, 0, (active._t1 - active._t0));

  const stationDists = getRouteStationDistances(rk);
  const nStops = stationDists ? stationDists.length : 0;
  const dwellTotal = Math.max(0, (nStops - 2) * DWELL_TIME);
  const runTime = Math.max(1, (active._t1 - active._t0) - dwellTotal);

  let distNow = (tRel / (active._t1 - active._t0)) * r.total;

  if (stationDists && nStops >= 2) {
  let runClock = tRel;
  for (let i = 1; i < nStops; i++) {
  const stopDist = stationDists[i].dist;
  const arriveRun = (stopDist / r.total) * runTime;
  const arriveReal = arriveRun + (i - 1) * DWELL_TIME;

  if (tRel >= arriveReal && tRel < arriveReal + DWELL_TIME) {
  distNow = stopDist;
  break;
  }

  if (tRel >= arriveReal + DWELL_TIME) {
  runClock = tRel - i * DWELL_TIME;
  }
  }

  if (distNow !== (stationDists?.find(s => Math.abs(s.dist - distNow) < STOP_EPS)?.dist)) {
  const runFrac = clamp(runClock / runTime, 0, 1);
  distNow = runFrac * r.total;
  }
  }

  frac = clamp(distNow / r.total, 0, 1);

  const pt = pointAt(r, frac * r.total);
  pos = pt.latlng;
  ang = pt.angle;
  showArrow = true;

  if (pos) lastPosByVehicle.set(vozilo, pos);

  } else {
  pos = rk ? (buildRoute(rk)?.poly?.[0] || null) : null;
  ang = 0;
  showArrow = true;
  }

  showArrow = true;

  const distNow = (r && r.total > 0) ? (frac * r.total) : 0;
  const nextStop = (rk && r && r.total > 0) ? getNextStopByDistance(rk, distNow) : null;

  popupState = {
  mode: 'moving',
  secondsLeft: (active._t1 - t),
  routeKey: rk,
  networkRouteKey: rk,
  nextStopName: nextStop ? nextStop.name : null
  };

  } else if (prev && t >= prev._t1 && (!next || t < next._t0)) {

  const prevKey =
  lastRouteKeyByVehicle.get(vozilo) ||
  pickRouteKeyForTrip(prev);

  const prevEndsDepot = prevKey && isDepotEnd(prevKey);
  const rPrev = prevKey ? buildRoute(prevKey) : null;
  const endPos = (rPrev && rPrev.poly && rPrev.poly.length)
  ? rPrev.poly[rPrev.poly.length - 1]
  : (lastPosByVehicle.get(vozilo) || null);

  const nextKey = next ? pickRouteKeyForTrip(next) : null;
  const labelTrip = next || prev; 
  const textKey   = nextKey || prevKey;

  if (!prevEndsDepot) {
  if (!next) {
  pos = null;
  trForLabel = null;
  popupState = null;
  } else {
  pos = endPos;

  rk = textKey;
  trForLabel = labelTrip;
  showArrow = false;

  popupState = {
  mode: 'waiting',
  secondsLeft: (next._t0 - t),
  routeKey: rk,
  networkRouteKey: nextKey || prevKey,
  nextStopName: null
  };
  }
  }

  else if (prevEndsDepot && t <= prev._t1 + DEPOT_POST) {
  pos = endPos;

  rk = textKey;
  trForLabel = labelTrip;
  showArrow = false;

  popupState = {
  mode: 'waiting',
  secondsLeft: next ? (next._t0 - t) : null,
  routeKey: rk,
  networkRouteKey: rk,
  nextStopName: null,
  inDepot: true
  };
  }

  else {
  const canPreShow = next && nextKey && isDepotStart(nextKey) && (t >= next._t0 - DEPOT_PRE) && (t < next._t0);
  if (canPreShow) {
  const rNext = buildRoute(nextKey);
  pos = (rNext && rNext.poly && rNext.poly.length) ? rNext.poly[0] : (endPos || null);

  rk = nextKey;
  trForLabel = next; 
  showArrow = false;

  popupState = {
  mode: 'waiting',
  secondsLeft: (next._t0 - t),
  routeKey: rk,
  networkRouteKey: rk,
  nextStopName: null,
  inDepot: true
  };
  } else {
  pos = null;
  trForLabel = null;
  popupState = null;
  }
  }
  }

  else if (!prev && next) {
  rk = pickRouteKeyForTrip(next);

  if (rk && isDepotStart(rk) && t >= next._t0 - DEPOT_PRE && t < next._t0) {
  const r = buildRoute(rk);

  pos = (r && r.poly && r.poly.length) ? r.poly[0] : null;
  trForLabel = next;
  showArrow = false;

  popupState = {
  mode: 'waiting',
  secondsLeft: (next._t0 - t),
  routeKey: rk,
  nextStopName: null
  };
  }
  }

  const existing = markers.get(vozilo);
  if (!trForLabel && activeAny) {
  trForLabel = activeAny;
  popupState = {
  mode: 'moving',
  secondsLeft: (activeAny._t1 - t),
  routeKey: lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(activeAny),
  networkRouteKey: lastRouteKeyByVehicle.get(vozilo) || pickRouteKeyForTrip(activeAny),
  nextStopName: null
  };

  if (!pos) pos = lastPosByVehicle.get(vozilo) || null;
  }


  if (!pos || !trForLabel || !popupState) {
  const existing = markers.get(vozilo);
  if (existing) {
  layer.removeLayer(existing);
  markers.delete(vozilo);
  }
  continue;
  }

  if (selectedLine && !(popupState.routeKey || '').startsWith(selectedLine + '_')) {
  if (existing) { layer.removeLayer(existing); markers.delete(vozilo); }
  continue;
  }
  if (selectedDir && selectedRouteKeyFilter && (popupState.routeKey !== selectedRouteKeyFilter)) {
  if (existing) { layer.removeLayer(existing); markers.delete(vozilo); }
  continue;
  }

  const isSelected = (selectedVehicleId === vozilo);
  const iconColor = isSelected ? 'red' : BLUE;

  const arrowFinal = (popupState.mode === 'moving') ? true : !!showArrow;

  const labelLine = displayLineForVehicle(trForLabel, popupState.routeKey);
  const ic = makeVehicleIcon(labelLine, ang, arrowFinal, iconColor);

  if (isSelected && (popupState.networkRouteKey || popupState.routeKey)) {
  highlightNetwork(popupState.networkRouteKey || popupState.routeKey);
  }


  if (!existing) {
  const m = L.marker(pos, {
  icon: ic,
  pane: 'vehiclePane'
  }).addTo(layer);

  m.bindPopup(popupHtml(trForLabel, popupState), {
  className: 'beta-vehicle-popup',
  minWidth: 180,
  maxWidth: 360,
  offset: L.point(0, -2),
  autoPan: true
  });

  m.on('click', (ev) => {
  L.DomEvent.stopPropagation(ev);
  closeBetaPanels();
  selectedVehicleId = vozilo;

  selectedRouteKey =
  popupState.networkRouteKey || popupState.routeKey || null;

  if (selectedRouteKey) highlightNetwork(selectedRouteKey);
  render();
  m.openPopup();
  });

  markers.set(vozilo, m);
  } else {
  existing.setLatLng(pos);
  existing.setIcon(ic);
  existing.setPopupContent(popupHtml(trForLabel, popupState));
  }
  }
  }

  window.BETA_API = {
  stationById,
  arrivalsForStation,
  clearStationSelection,
  stationLayer,
  nowSec,
  map
  };

  function closeBetaPanels() {
  const betaFilter = document.getElementById('betaFilter');
  if (betaFilter) betaFilter.style.display = 'none';

  const infoPanel = document.getElementById('betaInfoPanel');
  if (infoPanel) infoPanel.classList.remove('open');

  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  }

  function closePanelsOnStationClick() {
  if (!window.layer_Tramvajskestanice_2) return;

  window.layer_Tramvajskestanice_2.eachLayer((l) => {
  if (l._betaClosePanelsAttached) return;
  l._betaClosePanelsAttached = true;

  l.on('click', () => {
  closeBetaPanels();
  });
  });
  }

  closePanelsOnStationClick();

  render();

  map.on('click', () => {
  selectedVehicleId = null;
  selectedRouteKey = null;
  resetNetworkHighlight();
  clearStationSelection();
  render();
  });

  setInterval(render, 1000);

  console.log(`[BETA] Loaded: ${routeStations.size} ruta, ${trips.length} polazaka, ${stationById.size} stanica.`);
  })();
