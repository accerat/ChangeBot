require('dotenv').config(); // ← load .env

const API_KEY = process.env.GOOGLE_PLACES_API_KEY; // must exist

(async () => {
  if (!API_KEY) {
    console.error('No GOOGLE_PLACES_API_KEY found. Is it in your .env?');
    process.exit(1);
  }

  const url = 'https://places.googleapis.com/v1/places:searchText';
  const body = {
    textQuery: 'The Home Depot near Spring, TX',
    locationBias: { circle: { center: { latitude: 30.0799, longitude: -95.4172 }, radius: 10000 } }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  console.log('status:', res.status, res.statusText);
  console.log('body (first 300):', text.slice(0, 300));
  try {
    const json = JSON.parse(text);
    console.log('places:', json.places?.length ?? 0);
  } catch (e) {
    console.log('parse error:', e.message);
  }
})();
