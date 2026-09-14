/**
 * Places for local news — city and state editions on top of the country
 * editions. Google News serves geo feeds for cities and search feeds for
 * states/regions; the console picks the right one and labels results clearly
 * ("Mumbai · India", "New York · United States").
 */

export interface NewsPlace {
  name: string;
  /** geo = city geo-feed; search = keyword feed scoped to the country edition */
  feed: "geo" | "search";
  country: string;
  /** State/region shown in the label when known. */
  region?: string;
}

const IN = "in";
const US = "us";
const GB = "gb";
const AE = "ae";

/** Indian cities on Google News geo feeds. */
const INDIAN_CITIES = [
  "mumbai",
  "delhi",
  "new delhi",
  "bengaluru",
  "bangalore",
  "hyderabad",
  "chennai",
  "kolkata",
  "pune",
  "ahmedabad",
  "jaipur",
  "lucknow",
  "surat",
  "bhopal",
  "indore",
  "nagpur",
  "patna",
  "kochi",
  "coimbatore",
  "madurai",
  "visakhapatnam",
  "vijayawada",
  "guwahati",
  "bhubaneswar",
  "ranchi",
  "raipur",
  "dehradun",
  "shimla",
  "chandigarh",
  "goa",
  "panaji",
  "noida",
  "gurgaon",
  "gurugram",
  "thane",
  "navi mumbai",
  "nashik",
  "aurangabad",
  "solapur",
  "amravati",
  "kolhapur",
  "sangli",
  "satara",
  "jalgaon",
  "prayagraj",
  "varanasi",
  "kanpur",
  "agra",
  "meerut",
  "jabalpur",
  "indian metros",
];

/** Indian states — searched within the India edition, never a geo feed. */
const INDIAN_STATES = [
  "maharashtra",
  "delhi ncr",
  "karnataka",
  "tamil nadu",
  "telangana",
  "andhra pradesh",
  "kerala",
  "gujarat",
  "rajasthan",
  "madhya pradesh",
  "uttar pradesh",
  "west bengal",
  "bihar",
  "odisha",
  "assam",
  "punjab",
  "haryana",
  "himachal pradesh",
  "uttarakhand",
  "goa",
  "jharkhand",
  "chhattisgarh",
];

/** World cities that carry their own geo feed. */
const WORLD_CITIES: Array<[string, string, string?]> = [
  ["new york", US, "New York"],
  ["los angeles", US, "California"],
  ["chicago", US, "Illinois"],
  ["san francisco", US, "California"],
  ["seattle", US, "Washington"],
  ["boston", US, "Massachusetts"],
  ["houston", US, "Texas"],
  ["london", GB, "England"],
  ["manchester", GB, "England"],
  ["birmingham", GB, "England"],
  ["dubai", AE],
  ["abu dhabi", AE],
  ["toronto", "ca", "Ontario"],
  ["vancouver", "ca", "British Columbia"],
  ["sydney", "au", "New South Wales"],
  ["melbourne", "au", "Victoria"],
  ["singapore city", "sg"],
  ["singapore", "sg"],
  ["hong kong", "hk"],
  ["tokyo", "jp"],
  ["seoul", "kr"],
];

const REGION_ALIAS: Record<string, string> = {
  mumbai: "Maharashtra",
  thane: "Maharashtra",
  "navi mumbai": "Maharashtra",
  nashik: "Maharashtra",
  aurangabad: "Maharashtra",
  solapur: "Maharashtra",
  amravati: "Maharashtra",
  kolhapur: "Maharashtra",
  sangli: "Maharashtra",
  satara: "Maharashtra",
  jalgaon: "Maharashtra",
  nagpur: "Maharashtra",
  pune: "Maharashtra",
  bengaluru: "Karnataka",
  bangalore: "Karnataka",
  chennai: "Tamil Nadu",
  coimbatore: "Tamil Nadu",
  madurai: "Tamil Nadu",
  hyderabad: "Telangana",
  kolkata: "West Bengal",
  kochi: "Kerala",
};

function place(
  name: string,
  feed: "geo" | "search",
  country: string,
  region?: string,
): NewsPlace {
  return { name, feed, country, region };
}

const PLACES = new Map<string, NewsPlace>();

for (const city of INDIAN_CITIES) {
  if (city === "indian metros") {
    continue;
  }
  PLACES.set(city, place(city, "geo", IN, REGION_ALIAS[city]));
}
for (const state of INDIAN_STATES) {
  PLACES.set(state, place(state, "search", IN));
}
for (const [city, country, region] of WORLD_CITIES) {
  PLACES.set(city, place(city, "geo", country, region));
}

const PLACE_ALIASES: Record<string, string> = {
  bombay: "mumbai",
  madras: "chennai",
  calcutta: "kolkata",
  bangalore: "bengaluru",
  gurgaon: "gurugram",
  ny: "new york",
  nyc: "new york",
  "big apple": "new york",
  "national capital region": "delhi ncr",
  vidarbha: "nagpur",
  marathwada: "aurangabad",
  konkan: "mumbai",
  "mumbai region": "mumbai",
};

export interface DetectedPlace {
  place: NewsPlace;
  /** Display label: "Mumbai · Maharashtra · India". */
  label: string;
  matched: string;
}

function titleCasePlace(value: string): string {
  return value
    .split(" ")
    .map((word) =>
      word === "ncr" ? "NCR" : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

export function labelOfPlace(place: NewsPlace): string {
  const parts = [titleCasePlace(place.name)];
  if (place.region && place.region.toLowerCase() !== place.name.toLowerCase()) {
    parts.push(place.region);
  }
  parts.push(place.country === "in" ? "India" : countryName(place.country));
  return parts.join(" · ");
}

function countryName(code: string): string {
  const names: Record<string, string> = {
    in: "India",
    us: "United States",
    gb: "United Kingdom",
    ae: "UAE",
    ca: "Canada",
    au: "Australia",
    sg: "Singapore",
    hk: "Hong Kong",
    jp: "Japan",
    kr: "South Korea",
  };
  return names[code] ?? code.toUpperCase();
}

/** "mumbai news", "news from maharashtra", "headlines for new york". */
export function detectPlaceInText(text: string): DetectedPlace | undefined {
  const lower = ` ${text.toLowerCase().replace(/[—–_]/g, " ")} `;
  const candidates: Array<{ key: string; place: NewsPlace }> = [];
  for (const [key, value] of PLACES) {
    candidates.push({ key, place: value });
  }
  for (const [alias, target] of Object.entries(PLACE_ALIASES)) {
    const resolved = PLACES.get(target);
    if (resolved) {
      candidates.push({ key: alias, place: resolved });
    }
  }
  // longest match wins: "navi mumbai" over "mumbai"
  candidates.sort((a, b) => b.key.length - a.key.length);
  for (const candidate of candidates) {
    const pattern = new RegExp(
      `(?:^|[^a-z])${candidate.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z]|$)`,
    );
    if (pattern.test(lower)) {
      return {
        place: candidate.place,
        label: labelOfPlace(candidate.place),
        matched: candidate.key,
      };
    }
  }
  return undefined;
}

/** Strip the place from a news ask so "mumbai news" searches the feed, not the word. */
export function stripPlaceFromTopic(text: string): string {
  const detected = detectPlaceInText(text);
  if (!detected) {
    return text;
  }
  return text.replace(new RegExp(detected.matched, "i"), " ").replace(/\s+/g, " ").trim();
}
