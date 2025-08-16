// suppliers/google.js
// Google supplier lookups using Places API (New) + Geocoding API
// Node 18+ (uses global fetch)
const db = require('../db/client');

// Accept a few common env var names
const API_KEY =
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.MAPS_PLATFORM_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.MAPS_API_KEY;

/* ------------------------- helpers ------------------------- */

function miFrom(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // miles
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rmLeadingThe = s => s.replace(/^the\s+/, '');

/** Parse JSON safely and show status/body snippet on failure */
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text ? text.slice(0, 300) : '<empty body>';
    throw new Error(`NON_JSON_RESPONSE status=${res.status} ${res.statusText} body=${snippet}`);
  }
}


//* ------------------- Debugging Tools ---------------------- */
const DEBUG_PLACES = process.env.DEBUG_PLACES === '1';

function maskKey(headers) {
  const h = { ...(headers || {}) };
  if (h['X-Goog-Api-Key']) h['X-Goog-Api-Key'] = '***';
  return h;
}

async function readTextSafe(res) {
  try { return await res.text(); } catch { return ''; }
}

async function debugFetch(url, options) {
  const { method = 'GET', headers = {}, body } = options || {};
  const bodyLen = typeof body === 'string' ? body.length : (body ? JSON.stringify(body).length : 0);

  if (DEBUG_PLACES) {
    console.log('[places][req]', method, url);
    console.log('[places][req-headers]', maskKey(headers));
    console.log('[places][req-body-bytes]', bodyLen);
  }

  let res, text;
  try {
    res = await fetch(url, options);
    text = await readTextSafe(res);
  } catch (e) {
    console.error('[places][fetch-error]', e?.message || e);
    throw e;
  }

  if (DEBUG_PLACES) {
    console.log('[places][res]', res.status, res.statusText);
    const preview = text ? text.slice(0, 500) : '<empty body>';
    console.log('[places][res-body]', preview);
  }

  return { res, text };
}

/** Try a minimalist searchText call (like your test script) if 404 happens */
async function searchTextProbe(apiKey, lat, lng) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const payload = {
    textQuery: 'The Home Depot near Spring, TX',
    locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 10000 } }
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
  };
  const { res, text } = await debugFetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { status: res.status, text };
}


/* -------------------- Google API wrappers ------------------- */

// Geocode "City, ST" so we can bias supplier search
async function geocodeCityState(city, state) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', `${city}, ${state}`);
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url);
  const json = await safeJson(res);
  if (json.status !== 'OK' || !json.results?.[0]) {
    throw new Error(`GEOCODE_${json.status || 'EMPTY'} ${json.error_message || ''}`.trim());
  }
  const { lat, lng } = json.results[0].geometry.location;
  return { lat, lng };
}
// ---------------------------- Search text new -----------------------//
// Places API (New) — Text Search (POST)
async function searchTextNew(query, lat, lng, radiusMi) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const radiusMeters = Math.min(50000, Math.round((radiusMi || 50) * 1609.34));
  const body = {
    textQuery: query,
    locationBias: (lat && lng) ? {
      circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters }
    } : undefined
  };
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': API_KEY,
    'X-Goog-FieldMask': 'places.id,places.name,places.displayName,places.formattedAddress,places.location'
  };

  // main request
  const { res, text } = await debugFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

  // 404? Try a minimal probe like your working test to isolate cause
  if (res.status === 404) {
    console.warn('[places][searchText] 404 — probing with minimal payload/fieldmask…');
    const probe = await searchTextProbe(API_KEY, lat ?? 30.0799, lng ?? -95.4172);
    console.warn('[places][searchText][probe]', 'status=', probe.status, 'body-preview=', (probe.text || '').slice(0, 200));
  }

  // Parse safely
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`NON_JSON_RESPONSE status=${res.status} ${res.statusText} body=${text ? text.slice(0, 300) : '<empty>'}`);
  }

  if (!res.ok) throw new Error(`SEARCH_NEW_${res.status} ${json?.error?.message || ''}`);
  return json.places || [];
}
// ---------------------------- Search text new end -----------------------//
// ---------------------------- get place new -----------------------//
// Places API (New) — Place Details (GET)
async function getPlaceNew(placeResourceName) {
  // Ensure we call with places/<id>
  const isFull = String(placeResourceName || '').startsWith('places/');
  const resource = isFull ? placeResourceName : `places/${placeResourceName}`;
  const fields = 'id,name,displayName,formattedAddress,internationalPhoneNumber,location';

  // 🔧 DO NOT encode the path part; it breaks the slash in "places/<id>"
  const url = `https://places.googleapis.com/v1/${resource}?fields=${encodeURIComponent(fields)}`;

  const res = await fetch(url, { headers: { 'X-Goog-Api-Key': API_KEY } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`NON_JSON_RESPONSE status=${res.status} ${res.statusText} body=${text ? text.slice(0,300) : '<empty>'}`); }

  if (!res.ok) throw new Error(`DETAILS_NEW_${res.status} ${json?.error?.message || ''}`);
  return json;
}

// ---------------------------- get place new end -----------------------//

/* --------------------- search strategies -------------------- */

// Improved chain picker: tries multiple synonyms, filters by name, picks closest
async function pickFirstOfBrand({ brand, query, lat, lng, radiusMi, synonyms = [] }) {
  const candidates = [];
  const qList = [query, ...synonyms].filter(Boolean);

  for (const q of qList) {
    const list = await searchTextNew(q, lat, lng, radiusMi);
    for (const p of (list || []).slice(0, 8)) candidates.push(p);
  }

  const brandKey = rmLeadingThe(norm(brand));
  const filtered = candidates.filter(p => {
    // Places v1 may use displayName.text; fall back to name if needed
    const raw = p.displayName?.text || p.name || '';
    const name = rmLeadingThe(norm(raw));
    // Explicit boost for Home Depot edge cases
    return name.includes(brandKey) || (brandKey.includes('home depot') && name.includes('home depot'));
  });

  const pool = filtered.length ? filtered : candidates;
  if (!pool.length) throw new Error(`SEARCH_NEW_EMPTY_${brand}`);

  const withDist = pool.map(p => {
    const plat = p.location?.latitude, plng = p.location?.longitude;
    const dist = (plat && plng) ? Math.hypot(plat - lat, plng - lng) : Number.POSITIVE_INFINITY;
    return { p, dist };
  }).sort((a, b) => a.dist - b.dist);

  const best = withDist[0].p;
  const resource = best.id || best.name; // v1 may return either `id` or `name` like "places/ChIJ..."
  const det = await getPlaceNew(resource);

  return {
    source: 'google',
    place_id: det.id || det.name || resource,
    brand,
    type: 'chain',
    name: det.displayName?.text || det.name || best.displayName?.text || 'Unknown',
    address: det.formattedAddress || best.formattedAddress || null,
    phone: det.internationalPhoneNumber || null,
    lat: det.location?.latitude ?? best.location?.latitude ?? null,
    lng: det.location?.longitude ?? best.location?.longitude ?? null
  };
}

// Top hardware stores (unique owners), keep at requested radius
async function topHardwareStores({ lat, lng, radiusMi, limit = 10 }) {
  const list = await searchTextNew('hardware store', lat, lng, radiusMi);
  const out = [];
  const owners = new Set();

  for (const p of list) {
    if (out.length >= limit) break;
    const nameKey = norm(p.displayName?.text || p.name);
    if (owners.has(nameKey)) continue;
    owners.add(nameKey);

    try {
      const resource = p.id || p.name;
      const det = await getPlaceNew(resource);
      out.push({
        source: 'google',
        place_id: det.id || det.name || resource,
        brand: 'Hardware',
        type: 'hardware',
        name: det.displayName?.text || det.name || p.displayName?.text || 'Unknown',
        address: det.formattedAddress || p.formattedAddress || null,
        phone: det.internationalPhoneNumber || null,
        lat: det.location?.latitude ?? p.location?.latitude ?? null,
        lng: det.location?.longitude ?? p.location?.longitude ?? null
      });
    } catch (e) {
      console.warn('[google][hardware][details] skip:', e.message || e);
    }
  }

  return out;
}

/* ---------------------- public entrypoint ------------------- */

async function searchSuppliers({ city, state, radiusMi = 50 }) {
  if (!API_KEY) throw new Error('NO_GOOGLE_API_KEY');

  console.log('[google] geocoding:', city, state);
  const { lat, lng } = await geocodeCityState(city, state);

  // Widen chain search a bit so big-box stores are less likely to be missed
  const chainRadiusMi = Math.max(60, radiusMi); // still clamped to 50km at request time

  // Chain brands + synonyms
  const brandQueries = [
    { brand: "Lowe's",               query: "Lowe's Home Improvement" },
    { brand: "Home Depot",           query: "The Home Depot",              synonyms: ["Home Depot", "Home Depot store"] },
    { brand: "White Cap",            query: "White Cap" },
    { brand: "L&W Supply",           query: "L&W Supply" },
    { brand: "Sherwin-Williams",     query: "Sherwin-Williams Paint Store", synonyms: ["Sherwin-Williams"] },
    { brand: "Builders FirstSource", query: "Builders FirstSource" },
    { brand: "Menards",              query: "Menards" },
    { brand: "Ready-Mix",            query: "ready mix concrete supplier" }
  ];

  const results = [];
  for (const b of brandQueries) {
    try {
      const item = await pickFirstOfBrand({
        brand: b.brand,
        query: `${b.query} near ${city}, ${state}`,
        lat, lng,
        radiusMi: chainRadiusMi,
        synonyms: b.synonyms
      });
      if (item) results.push(item);
    } catch (e) {
      console.warn('[google][brand]', b.brand, '->', e.message || e);
    }
  }

  // Hardware stays at requested radius and returns up to 10 uniquely-owned stores
  let hardware = [];
  try {
    hardware = await topHardwareStores({ lat, lng, radiusMi, limit: 10 });
  } catch (e) {
    console.warn('[google][hardware] search failed:', e.message || e);
  }

  // Ensure at least one Sherwin & one Ready-Mix (per your rules)
  const hasSherwin = results.some(r => r.brand === 'Sherwin-Williams');
  const hasReadyMix = results.some(r => r.brand === 'Ready-Mix');

  if (!hasSherwin) {
    try {
      const sw = await pickFirstOfBrand({
        brand: 'Sherwin-Williams',
        query: `Sherwin-Williams near ${city}, ${state}`,
        lat, lng,
        radiusMi: chainRadiusMi,
        synonyms: ['Sherwin-Williams']
      });
      if (sw) results.push(sw);
    } catch (e) {
      console.warn('[google][ensure] Sherwin-Williams ->', e.message || e);
    }
  }

  if (!hasReadyMix) {
    try {
      const rm = await pickFirstOfBrand({
        brand: 'Ready-Mix',
        query: `ready mix concrete supplier near ${city}, ${state}`,
        lat, lng,
        radiusMi: chainRadiusMi
      });
      if (rm) results.push(rm);
    } catch (e) {
      console.warn('[google][ensure] Ready-Mix ->', e.message || e);
    }
  }

  const all = [...results, ...hardware].map(s => {
    const distance_mi = (s.lat && s.lng) ? miFrom(lat, lng, s.lat, s.lng) : null;
    const cacheId = db.cacheSupplier({
      source: 'google',
      place_id: s.place_id || null,
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

  console.log('[google] total suppliers:', all.length);

  // If Google returns 0, throw so caller can fall back to OSM
  if (!all.length) {
    throw new Error('GOOGLE_EMPTY');
  }

  return { lat, lng, suppliers: all };
}

module.exports = { searchSuppliers };
