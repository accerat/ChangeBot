// suppliers/osm.js
// OpenStreetMap fallback using Nominatim (geocoding) + Overpass API (POI search)
// Node 18+ (global fetch)
const db = require('../db/client');

const OSM_CONTACT_EMAIL = process.env.OSM_CONTACT_EMAIL || 'ops@example.com';

// --- helpers ---
function miFrom(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Build an Overpass radius snippet around lat/lng (meters)
function around(lat, lng, radiusMeters) {
  return `around:${Math.round(radiusMeters)},${lat},${lng}`;
}

/* ---------------- Nominatim geocoding ---------------- */

async function geocodeCityState(city, state) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${city}, ${state}, USA`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const res = await fetch(url, {
    headers: {
      'User-Agent': `MaterialBot/1.0 (${OSM_CONTACT_EMAIL})`,
      'Accept-Language': 'en'
    }
  });
  if (!res.ok) throw new Error(`OSM_GEOCODE_${res.status}`);
  const js = await res.json();
  if (!js?.length) throw new Error('OSM_GEOCODE_EMPTY');
  return {
    lat: parseFloat(js[0].lat),
    lng: parseFloat(js[0].lon)
  };
}

/* ---------------- Overpass with retries ---------------- */

async function overpassWithRetry(query, tries = 3) {
  let delay = 1500; // ms
  for (let i = 0; i < tries; i++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': `MaterialBot/1.0 (${OSM_CONTACT_EMAIL})`
      },
      body: new URLSearchParams({ data: query }).toString()
    });

    if (res.ok) {
      const js = await res.json();
      return js.elements || [];
    }

    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    throw new Error(`OVERPASS_${res.status}`);
  }
  throw new Error('OVERPASS_RETRY_EXHAUSTED');
}

async function overpass(query) {
  return overpassWithRetry(query);
}

/* ------------- mapping & category queries ------------- */

// Convert Overpass node/way/relation -> simple place object
function mapPlace(el) {
  const t = el.tags || {};
  const name = t.name || t['brand'] || t['operator'] || 'Unknown';
  const brand = t['brand'] || (name && name);
  const phone = t['phone'] || t['contact:phone'] || null;

  const addressParts = [
    t['addr:housenumber'],
    t['addr:street'],
    t['addr:city'],
    t['addr:state'],
    t['addr:postcode']
  ].filter(Boolean);
  const address = addressParts.length ? addressParts.join(', ') : null;

  const lat = el.lat || (el.center && el.center.lat) || null;
  const lng = el.lon || (el.center && el.center.lon) || null;

  return {
    source: 'osm',
    osm_type: el.type,
    osm_id: el.id,
    brand: brand || null,
    type: 'hardware',
    name,
    address,
    phone,
    lat,
    lng
  };
}

async function queryHardware({ lat, lng, radiusMi, limit = 30 }) {
  const rMeters = Math.round((radiusMi || 50) * 1609.34);
  const q = `
[out:json][timeout:25];
(
  node[shop=hardware](${around(lat, lng, rMeters)});
  way[shop=hardware](${around(lat, lng, rMeters)});
  node[shop=doityourself](${around(lat, lng, rMeters)});
  way[shop=doityourself](${around(lat, lng, rMeters)});
  node[shop=building_materials](${around(lat, lng, rMeters)});
  way[shop=building_materials](${around(lat, lng, rMeters)});
  node[shop=paint](${around(lat, lng, rMeters)});
  way[shop=paint](${around(lat, lng, rMeters)});
);
out center ${limit};
`;
  const els = await overpass(q);
  return els.map(mapPlace).filter(p => p.lat && p.lng);
}

async function queryReadyMix({ lat, lng, radiusMi, limit = 20 }) {
  const rMeters = Math.round((radiusMi || 50) * 1609.34);
  const q = `
[out:json][timeout:25];
(
  node["industrial"~"concrete|cement"](${around(lat, lng, rMeters)});
  way["industrial"~"concrete|cement"](${around(lat, lng, rMeters)});
  node[shop=building_materials](${around(lat, lng, rMeters)});
  way[shop=building_materials](${around(lat, lng, rMeters)});
  node["name"~"ready ?mix|readymix",i](${around(lat, lng, rMeters)});
  way["name"~"ready ?mix|readymix",i](${around(lat, lng, rMeters)});
);
out center ${limit};
`;
  const els = await overpass(q);
  return els.map(e => ({ ...mapPlace(e), type: 'ready_mix' })).filter(p => p.lat && p.lng);
}

/* ----------------- picking / ranking utils ---------------- */

function pickNearestByBrand({ places, brandKey, lat, lng, aliases = [] }) {
  if (!places?.length) return null;
  const want = (s) => norm(s).replace(/^the\s+/, '');
  const bk = want(brandKey);
  const aliasList = [brandKey, ...aliases].map(want);

  const matches = places.filter(p => {
    const name = want(p.name);
    const brand = want(p.brand || '');
    return aliasList.some(a => name.includes(a) || brand.includes(a));
  });

  const pool = matches.length ? matches : places; // fallback: any
  let best = null, bestDist = Infinity;
  for (const p of pool) {
    if (!p.lat || !p.lng) continue;
    const d = miFrom(lat, lng, p.lat, p.lng);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

// Return top N uniquely-owned hardware stores (by normalized name, nearest first)
function topUniqueHardware(places, N, lat, lng) {
  const owners = new Set();
  const withDist = places
    .filter(p => p.lat && p.lng)
    .map(p => ({ p, dist: miFrom(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.dist - b.dist);

  const out = [];
  for (const { p } of withDist) {
    const key = norm(p.name);
    if (!owners.has(key)) {
      owners.add(key);
      out.push(p);
      if (out.length >= N) break;
    }
  }
  return out;
}

/* ------------------ public: main search ------------------ */

async function searchSuppliers({ city, state, radiusMi = 50 }) {
  console.log('[osm] geocoding:', city, state);
  const { lat, lng } = await geocodeCityState(city, state);

  // Pull candidates once and reuse for all brand picks
  const hw = await queryHardware({ lat, lng, radiusMi, limit: 60 });
  const rm = await queryReadyMix({ lat, lng, radiusMi, limit: 40 });

  // Chains we care about
  const chains = [
    { brand: "Lowe's", aliases: ["lowes", "lowe s"] },
    { brand: "Home Depot", aliases: ["the home depot", "home depot"] },
    { brand: "White Cap", aliases: ["whitecap"] },
    { brand: "L&W Supply", aliases: ["l and w supply", "l&w supply"] },
    { brand: "Sherwin-Williams", aliases: ["sherwin williams", "sherwin-williams"] },
    { brand: "Builders FirstSource", aliases: ["builders first source", "bfs"] },
    { brand: "Menards", aliases: [] }
  ];

  // One nearest per chain (if present)
  const picked = [];
  for (const c of chains) {
    const best = pickNearestByBrand({ places: hw, brandKey: c.brand, lat, lng, aliases: c.aliases });
    if (best) picked.push({ ...best, brand: c.brand, type: 'chain' });
  }

  // Hardware: top 10 uniquely-owned (nearest first)
  const topHardware = topUniqueHardware(hw, 10, lat, lng).map(p => ({ ...p, type: 'hardware' }));

  // Ensure ≥1 Sherwin-Williams and ≥1 Ready-Mix
  const hasSherwin = picked.some(p => p.brand === 'Sherwin-Williams') || topHardware.some(p => /sherwin/i.test(p.name));
  if (!hasSherwin) {
    const sw = pickNearestByBrand({ places: hw, brandKey: 'Sherwin-Williams', lat, lng, aliases: ['sherwin williams', 'sherwin-williams'] });
    if (sw) picked.push({ ...sw, brand: 'Sherwin-Williams', type: 'chain' });
  }

  let readyMixPick = null;
  if (rm.length) {
    readyMixPick = topUniqueHardware(rm, 1, lat, lng)[0]; // nearest one
    if (readyMixPick) readyMixPick.type = 'ready_mix';
  }

  // Compose results: chains + hardware (+ ready-mix if missing)
  let results = [...picked, ...topHardware];
  if (readyMixPick && !results.some(r => r.type === 'ready_mix')) {
    results.push(readyMixPick);
  }

  // De-dupe by normalized name (avoid e.g., Lowe's appearing twice)
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const key = norm(r.name);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  // Cap to 12 total: prioritize Ready-Mix, then Sherwin, then other chains, then hardware
  const priority = (s) => s.type === 'ready_mix' ? 0
    : (s.brand === 'Sherwin-Williams' ? 1
    : (s.type === 'chain' ? 2 : 3));
  const trimmed = deduped.sort((a, b) => priority(a) - priority(b)).slice(0, 12);

  // Cache + distances
  const all = trimmed.map(s => {
    const distance_mi = (s.lat && s.lng) ? miFrom(lat, lng, s.lat, s.lng) : null;
    const cacheId = db.cacheSupplier({
      source: 'osm',
      place_id: s.osm_id ? String(s.osm_id) : null,
      brand: s.brand || null,
      type: s.type || null,
      name: s.name,
      address: s.address || null,
      phone: s.phone || null,
      city, state,
      lat: s.lat || null, lng: s.lng || null,
      distance_mi
    });
    return { ...s, city, state, distance_mi, supplier_cache_id: cacheId };
  });

  console.log('[osm] total suppliers:', all.length);
  return { lat, lng, suppliers: all };
}

module.exports = { searchSuppliers };
