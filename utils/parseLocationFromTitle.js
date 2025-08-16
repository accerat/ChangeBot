// utils/parseLocationFromTitle.js
// Extracts "City, ST" from a project thread title.
//
// Examples it will handle:
//  - "UHC - Springfield, MO - Roof Repair"
//  - "Iowa City, IA | Materials"
//  - "Materials (Fayetteville, AR)"
//
// If state is missing but present as full (e.g., "Texas"), we normalize to "TX" when possible.

const STATE_ABBR = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY"
};

function normalizeState(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const full = s.toLowerCase();
  return STATE_ABBR[full] || null;
}

function parseCityState(title) {
  if (!title) return { city: null, state: null, locationText: null };

  // Try patterns like "City, ST"
  const patterns = [
    /([A-Za-z .'-]+)\s*,\s*([A-Za-z]{2})\b/,           // City, ST
    /([A-Za-z .'-]+)\s*\(\s*([A-Za-z]{2})\s*\)/,       // City (ST)
    /([A-Za-z .'-]+)\s*\|\s*([A-Za-z]{2})\b/,          // City | ST
    /([A-Za-z .'-]+)\s*-\s*([A-Za-z]{2})\b/            // City - ST
  ];

  for (const rx of patterns) {
    const m = title.match(rx);
    if (m) {
      const city = m[1].trim();
      const state = normalizeState(m[2]);
      if (city && state) return { city, state, locationText: `${city}, ${state}` };
    }
  }

  // Try "City, State" with full state name
  const rxFull = /([A-Za-z .'-]+)\s*,\s*([A-Za-z ]{3,})\b/;
  const m2 = title.match(rxFull);
  if (m2) {
    const city = m2[1].trim();
    const state = normalizeState(m2[2]);
    if (city && state) return { city, state, locationText: `${city}, ${state}` };
  }

  return { city: null, state: null, locationText: null };
}

module.exports = { parseCityState, normalizeState };
