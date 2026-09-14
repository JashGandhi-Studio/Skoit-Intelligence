import { request, source } from "@/lib/net/http";
import { attrs, entity, evidence } from "@/lib/skills/emit";
import { ifscLooksValid, upiLooksValid, verifyVerhoeff } from "@/lib/skills/validators";
import type { SkillDefinition } from "@/lib/types";

/* ------------------------- Bundled reference data ---------------------- */

/** India Post PIN zones — accurate to the circle/state level by prefix. */
const PIN_CIRCLES: Array<{ prefix: string; state: string; region: string }> = [
  { prefix: "11", state: "Delhi", region: "Delhi circle" },
  { prefix: "12", state: "Haryana", region: "Haryana circle" },
  { prefix: "13", state: "Haryana / Punjab border", region: "Ambala–Patiala" },
  { prefix: "14", state: "Punjab", region: "Punjab circle" },
  { prefix: "15", state: "Punjab", region: "Punjab circle" },
  { prefix: "16", state: "Punjab / Chandigarh", region: "Chandigarh" },
  { prefix: "17", state: "Himachal Pradesh", region: "HP circle" },
  { prefix: "18", state: "Jammu & Kashmir / Ladakh", region: "J&K circle" },
  { prefix: "19", state: "Jammu & Kashmir", region: "Kashmir valley" },
  { prefix: "20", state: "Uttar Pradesh (west)", region: "UP circle" },
  { prefix: "21", state: "Uttar Pradesh (west)", region: "UP circle" },
  { prefix: "22", state: "Uttar Pradesh (east)", region: "UP circle" },
  { prefix: "23", state: "Uttar Pradesh (east)", region: "UP circle" },
  { prefix: "24", state: "Uttarakhand", region: "Uttarakhand circle" },
  { prefix: "25", state: "Uttar Pradesh", region: "UP circle" },
  { prefix: "26", state: "Uttar Pradesh", region: "UP circle" },
  { prefix: "27", state: "Uttar Pradesh", region: "UP circle" },
  { prefix: "28", state: "Uttar Pradesh", region: "UP circle" },
  { prefix: "30", state: "Rajasthan", region: "Rajasthan circle" },
  { prefix: "31", state: "Rajasthan", region: "Rajasthan circle" },
  { prefix: "32", state: "Rajasthan", region: "Rajasthan circle" },
  { prefix: "33", state: "Rajasthan", region: "Rajasthan circle" },
  { prefix: "34", state: "Rajasthan", region: "Rajasthan circle" },
  { prefix: "36", state: "Gujarat", region: "Gujarat circle" },
  { prefix: "37", state: "Gujarat", region: "Gujarat circle" },
  { prefix: "38", state: "Gujarat", region: "Gujarat circle" },
  { prefix: "39", state: "Gujarat", region: "Gujarat circle" },
  { prefix: "40", state: "Maharashtra (Mumbai/Konkan)", region: "Maharashtra circle" },
  { prefix: "41", state: "Maharashtra (Pune)", region: "Maharashtra circle" },
  { prefix: "42", state: "Maharashtra (Nashik)", region: "Maharashtra circle" },
  { prefix: "43", state: "Maharashtra (Aurangabad)", region: "Maharashtra circle" },
  { prefix: "44", state: "Maharashtra (Amravati)", region: "Maharashtra circle" },
  { prefix: "45", state: "Madhya Pradesh (Indore)", region: "MP circle" },
  { prefix: "46", state: "Madhya Pradesh (Bhopal)", region: "MP circle" },
  { prefix: "47", state: "Madhya Pradesh (Gwalior)", region: "MP circle" },
  { prefix: "48", state: "Madhya Pradesh (Jabalpur)", region: "MP circle" },
  { prefix: "49", state: "Chhattisgarh", region: "Chhattisgarh circle" },
  { prefix: "50", state: "Telangana (Hyderabad)", region: "Telangana circle" },
  { prefix: "51", state: "Telangana", region: "Telangana circle" },
  { prefix: "52", state: "Andhra Pradesh", region: "AP circle" },
  { prefix: "53", state: "Andhra Pradesh", region: "AP circle" },
  { prefix: "56", state: "Karnataka (Bengaluru)", region: "Karnataka circle" },
  { prefix: "57", state: "Karnataka", region: "Karnataka circle" },
  { prefix: "58", state: "Karnataka", region: "Karnataka circle" },
  { prefix: "59", state: "Karnataka", region: "Karnataka circle" },
  { prefix: "60", state: "Tamil Nadu (Chennai)", region: "Tamil Nadu circle" },
  { prefix: "61", state: "Tamil Nadu", region: "Tamil Nadu circle" },
  { prefix: "62", state: "Tamil Nadu", region: "Tamil Nadu circle" },
  { prefix: "63", state: "Tamil Nadu", region: "Tamil Nadu circle" },
  { prefix: "64", state: "Tamil Nadu", region: "Tamil Nadu circle" },
  { prefix: "67", state: "Kerala", region: "Kerala circle" },
  { prefix: "68", state: "Kerala", region: "Kerala circle" },
  { prefix: "69", state: "Kerala", region: "Kerala circle" },
  { prefix: "70", state: "West Bengal (Kolkata)", region: "West Bengal circle" },
  { prefix: "71", state: "West Bengal", region: "West Bengal circle" },
  { prefix: "72", state: "West Bengal", region: "West Bengal circle" },
  { prefix: "73", state: "West Bengal / Sikkim", region: "West Bengal circle" },
  {
    prefix: "74",
    state: "West Bengal / Andaman & Nicobar",
    region: "West Bengal circle",
  },
  { prefix: "75", state: "Odisha", region: "Odisha circle" },
  { prefix: "76", state: "Odisha", region: "Odisha circle" },
  { prefix: "77", state: "Odisha", region: "Odisha circle" },
  { prefix: "78", state: "Assam", region: "Assam circle" },
  { prefix: "79", state: "North East (AR/MN/ML/TR/MZ/SK)", region: "North East circle" },
  { prefix: "80", state: "Bihar / Jharkhand", region: "Bihar circle" },
  { prefix: "81", state: "Bihar", region: "Bihar circle" },
  { prefix: "82", state: "Bihar / Jharkhand", region: "Bihar circle" },
  { prefix: "83", state: "Jharkhand", region: "Jharkhand circle" },
  { prefix: "84", state: "Bihar", region: "Bihar circle" },
  { prefix: "85", state: "Bihar", region: "Bihar circle" },
];

/** Curated state/RTO codes published by the transport ministry. */
const RTO_STATES: Record<string, string> = {
  AN: "Andaman & Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CG: "Chhattisgarh",
  CH: "Chandigarh",
  DD: "Daman & Diu",
  DL: "Delhi",
  DN: "Dadra & Nagar Haveli",
  GA: "Goa",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  HR: "Haryana",
  JH: "Jharkhand",
  JK: "Jammu & Kashmir",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MH: "Maharashtra",
  ML: "Meghalaya",
  MN: "Manipur",
  MP: "Madhya Pradesh",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Odisha",
  PB: "Punjab",
  PY: "Puducherry",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TG: "Telangana",
  TN: "Tamil Nadu",
  TR: "Tripura",
  UA: "Uttarakhand",
  UP: "Uttar Pradesh",
  WB: "West Bengal",
};

/** Major RTO zones — curated subset, confidence-marked as probable. */
const RTO_ZONES: Record<string, string> = {
  DL01: "Delhi — Mall Road (north Delhi)",
  DL02: "Delhi — IP Depot",
  DL03: "Delhi — Sheikh Sarai (south Delhi)",
  DL04: "Delhi — Janakpuri (west Delhi)",
  DL05: "Delhi — Loni Road",
  DL06: "Delhi — Sarai Kale Khan",
  DL07: "Delhi — Mayur Vihar",
  DL08: "Delhi — Wazirpur",
  DL09: "Delhi — Dwarka",
  DL10: "Delhi — Raja Garden",
  DL11: "Delhi — Rohini",
  DL12: "Delhi — Vasant Vihar",
  DL13: "Delhi — Surajmal Vihar",
  MH01: "Mumbai — Tardeo (central Mumbai)",
  MH02: "Mumbai — Andheri (western suburbs)",
  MH03: "Mumbai — Wadala (eastern suburbs)",
  MH04: "Thane",
  MH05: "Kalyan",
  MH06: "Alibaug / Raigad",
  MH12: "Pune",
  MH14: "Pimpri-Chinchwad",
  MH15: "Nashik",
  MH20: "Aurangabad (Chhatrapati Sambhajinagar)",
  KA01: "Bengaluru — central (Koramangala)",
  KA02: "Bengaluru — Rajajinagar",
  KA03: "Bengaluru — Indiranagar",
  KA04: "Bengaluru — Yeshwanthpur",
  KA05: "Bengaluru — Jayanagar",
  KA41: "Jnanabharathi",
  TN01: "Chennai — central",
  TN02: "Chennai — north east",
  TN09: "Chennai — south east",
  TN10: "Chennai — south",
  TS01: "Hyderabad — Khairatabad",
  TS07: "Hyderabad — Ibrahimpatnam",
  TS09: "Hyderabad — Ranga Reddy",
  GJ01: "Ahmedabad",
  GJ05: "Surat",
  RJ14: "Jaipur",
  UP32: "Lucknow",
  WB02: "Kolkata — Beltala",
  WB06: "Kolkata — Kasba",
  MP09: "Indore",
  HR26: "Gurugram",
  PB10: "Ludhiana",
};

const UPI_HANDLES: Record<string, string> = {
  okaxis: "Axis Bank",
  oksbi: "State Bank of India",
  okhdfcbank: "HDFC Bank",
  okicici: "ICICI Bank",
  ybl: "PhonePe (Yes Bank)",
  ibl: "PhonePe (ICICI)",
  axl: "Axis Bank",
  paytm: "Paytm Payments Bank",
  ptyes: "Paytm (Yes Bank)",
  apl: "Amazon Pay",
  upi: "BHIM / NPCI",
  airtel: "Airtel Payments Bank",
  jio: "Jio Payments Bank",
  freecharge: "Freecharge",
  fbl: "Fino Payments Bank",
  naviaxis: "Navia / Axis",
  slice: "Slice",
  niyoicici: "Niyo / ICICI",
  kmbl: "Kotak Mahindra Bank",
  hdfcbank: "HDFC Bank",
  icici: "ICICI Bank",
  sbi: "State Bank of India",
  axisb: "Axis Bank",
  pnb: "Punjab National Bank",
  barodampay: "Bank of Baroda",
};

const CITY_INDEX: Array<[string, number, number]> = [
  ["Mumbai", 19.076, 72.8777],
  ["Delhi", 28.6139, 77.209],
  ["Bengaluru", 12.9716, 77.5946],
  ["Hyderabad", 17.385, 78.4867],
  ["Chennai", 13.0827, 80.2707],
  ["Kolkata", 22.5726, 88.3639],
  ["Pune", 18.5204, 73.8567],
  ["Ahmedabad", 23.0225, 72.5714],
  ["Jaipur", 26.9124, 75.7873],
  ["Surat", 21.1702, 72.8311],
  ["Lucknow", 26.8467, 80.9462],
  ["Kanpur", 26.4499, 80.3319],
  ["Nagpur", 21.1458, 79.0882],
  ["Indore", 22.7196, 75.8577],
  ["Bhopal", 23.2599, 77.4126],
  ["Patna", 25.5941, 85.1376],
  ["Vadodara", 22.3072, 73.1812],
  ["Ludhiana", 30.901, 75.8573],
  ["Agra", 27.1767, 78.0081],
  ["Nashik", 19.9975, 73.7898],
  ["Varanasi", 25.3176, 82.9739],
  ["Amritsar", 31.634, 74.8723],
  ["Coimbatore", 11.0168, 76.9558],
  ["Kochi", 9.9312, 76.2673],
  ["Thiruvananthapuram", 8.5241, 76.9366],
  ["Bhubaneswar", 20.2961, 85.8245],
  ["Guwahati", 26.1445, 91.7362],
  ["Raipur", 21.2514, 81.6296],
  ["Ranchi", 23.3441, 85.3096],
  ["Dehradun", 30.3165, 78.0322],
  ["Chandigarh", 30.7333, 76.7794],
  ["Goa (Panaji)", 15.4909, 73.8278],
  ["Visakhapatnam", 17.6868, 83.2185],
  ["Mysuru", 12.2958, 76.6394],
  ["Madurai", 9.9252, 78.1198],
  ["Jodhpur", 26.2389, 73.0243],
  ["Udaipur", 24.5854, 73.7125],
  ["Rajkot", 22.3039, 70.8022],
  ["Kota", 25.2138, 75.8648],
  ["Thane", 19.2183, 72.9781],
  ["Noida", 28.5355, 77.391],
  ["Gurugram", 28.4595, 77.0266],
  ["Aurangabad", 19.8762, 75.3433],
  ["Jabalpur", 23.1815, 79.9864],
  ["Gwalior", 26.2183, 78.1828],
  ["Vijayawada", 16.5062, 80.648],
  ["Warangal", 17.9689, 79.5941],
  ["Mangaluru", 12.9141, 74.856],
  ["Kozhikode", 11.2588, 75.7804],
  ["Siliguri", 26.7271, 88.3953],
  ["Imphal", 24.817, 93.9368],
  ["Shimla", 31.1048, 77.1734],
  ["Srinagar", 34.0837, 74.7973],
  ["Leh", 34.1526, 77.5771],
  ["Puducherry", 11.9416, 79.8083],
  ["Agartala", 23.8315, 91.2868],
  ["Shillong", 25.5788, 91.8933],
  ["Port Blair", 11.6234, 92.7265],
  ["Tirupati", 13.6288, 79.4192],
  ["Bareilly", 28.367, 79.4304],
  ["Gorakhpur", 26.7606, 83.3732],
  ["Bhagalpur", 25.2425, 86.9842],
  ["Kolhapur", 16.705, 74.2433],
];

/* ------------------------------- Pincode ------------------------------- */

export const pincodeIntelligence: SkillDefinition = {
  id: "pincode-intelligence",
  name: "PIN code intelligence",
  short: "PIN code",
  description:
    "Validates an Indian PIN code and maps it to its postal circle and state using the official prefix scheme, then resolves the full address live through the public postal API when it is reachable.",
  category: "comms",
  runtime: "local",
  accepts: ["text", "address"],
  produces: ["postal-circle", "state", "post-offices"],
  keywords: [
    "pincode",
    "pin code",
    "postal",
    "zip",
    "address",
    "india post",
    "area",
    "delivery",
  ],
  clientFallback: true,
  async run(target, ctx) {
    const skill = "pincode-intelligence";
    const pin = (target.raw.match(/\b([1-9]\d{5})\b/) ??
      target.raw.match(/\b(\d{6})\b/) ??
      [])[1];

    if (!pin) {
      return {
        status: "partial",
        summary: "No six-digit PIN code found in the input.",
        evidence: [],
        entities: [],
        sources: [],
        error: { code: "unsupported", message: "No PIN code present." },
      };
    }

    const prefix = pin.slice(0, 2);
    const circle = PIN_CIRCLES.find((entry) => entry.prefix === prefix);
    const regionDigit = pin[0];
    const regionName: Record<string, string> = {
      "1": "Northern region (Delhi, Haryana, Punjab, HP, J&K)",
      "2": "Northern region (UP, Uttarakhand)",
      "3": "Western region (Rajasthan, Gujarat)",
      "4": "Western region (Maharashtra, MP, Chhattisgarh)",
      "5": "Southern region (Telangana, AP, Karnataka)",
      "6": "Southern region (Tamil Nadu, Kerala)",
      "7": "Eastern region (West Bengal, Odisha, North East)",
      "8": "Eastern region (Bihar, Jharkhand)",
      "9": "Army Postal Service (APS)",
    };

    const localSrc = source(
      "local:pin-scheme",
      "India Post PIN prefix scheme (bundled reference)",
      "https://www.indiapost.gov.in/",
      "dataset",
    );

    const liveSrc = source(
      "pin:postalapi",
      "public postal lookup API (postalpincode.in)",
      `https://api.postalpincode.in/pincode/${pin}`,
      "api",
    );
    const live = await request<
      Array<{
        Status?: string;
        Message?: string;
        PostOffice?: Array<{
          Name?: string;
          BranchType?: string;
          DeliveryStatus?: string;
          District?: string;
          Division?: string;
          Region?: string;
          State?: string;
        }>;
      }>
    >(`https://api.postalpincode.in/pincode/${encodeURIComponent(pin)}`, ctx, {
      timeoutMs: 8000,
      retries: 1,
    });

    const offices = live.ok ? (live.data?.[0]?.PostOffice ?? []) : [];
    const districts = Array.from(
      new Set(
        offices
          .map((office) => office.District)
          .filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          ),
      ),
    );
    const states = Array.from(
      new Set(
        offices
          .map((office) => office.State)
          .filter(
            (value): value is string => typeof value === "string" && value.length > 0,
          ),
      ),
    );

    const evidenceItems = [
      evidence(skill, "PIN code", pin, { source: localSrc }),
      evidence(skill, "Region", regionName[regionDigit] ?? "unknown", {
        source: localSrc,
      }),
      evidence(
        skill,
        "Postal circle / state",
        circle ? `${circle.state} — ${circle.region}` : "unmapped prefix",
        { source: localSrc, confidence: circle ? "confirmed" : "possible" },
      ),
      ...(offices.length > 0
        ? [
            evidence(skill, "Districts", districts.join(" · "), { source: liveSrc }),
            evidence(skill, "State (live)", states.join(" · "), { source: liveSrc }),
            evidence(
              skill,
              "Delivery offices",
              offices
                .slice(0, 10)
                .map(
                  (office) =>
                    `${office.Name} (${office.BranchType ?? "?"}/${office.DeliveryStatus ?? "?"})`,
                )
                .join(" · "),
              { source: liveSrc, raw: offices.slice(0, 20) },
            ),
            evidence(skill, "Office count", String(offices.length), {
              source: liveSrc,
              kind: "metric",
            }),
          ]
        : [
            evidence(
              skill,
              "Delivery offices",
              "live postal API unreachable — prefix mapping only",
              {
                source: liveSrc,
                kind: "warning",
                confidence: "unknown",
              },
            ),
          ]),
    ];

    return {
      status: offices.length > 0 ? "ok" : "partial",
      summary: `${pin} → ${states.join("/") || circle?.state || "unmapped"}${
        districts.length ? ` (${districts.join(", ")})` : ""
      }.`,
      evidence: evidenceItems,
      entities: [
        entity(
          skill,
          "pincode",
          pin,
          "PIN code",
          attrs({ circle: circle?.region, state: states[0] ?? circle?.state }),
        ),
        ...districts
          .slice(0, 3)
          .map((district) =>
            entity(skill, "address", district, "District", [], "confirmed"),
          ),
      ],
      sources: [localSrc, liveSrc],
    };
  },
};

/* ------------------------- Vehicle registration ------------------------ */

export const vehicleRegistration: SkillDefinition = {
  id: "vehicle-registration",
  name: "Vehicle registration plate",
  short: "Vehicle",
  description:
    "Decodes an Indian registration plate: state, RTO zone, series and serial structure. Explains why the plate alone cannot reveal the owner and what legal channel does.",
  category: "comms",
  runtime: "local",
  accepts: ["text"],
  produces: ["rto", "state", "plate-format"],
  keywords: [
    "vehicle",
    "number plate",
    "car",
    "bike",
    "rto",
    "registration",
    "ka01",
    "mh12",
    "plate",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "vehicle-registration";
    const raw = target.raw.toUpperCase().replace(/[\s-]/g, "");
    const match = raw.match(/\b([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})\b/);

    if (!match) {
      return {
        status: "partial",
        summary:
          "No Indian registration-plate pattern found (expected form: MH12AB1234).",
        evidence: [],
        entities: [],
        sources: [],
        error: { code: "unsupported", message: "Plate pattern not matched." },
      };
    }

    const [, stateCode, rtoCode, series, serial] = match;
    const rtoKey = `${stateCode}${(rtoCode ?? "").padStart(2, "0")}`;
    const state = RTO_STATES[stateCode];
    const zone = RTO_ZONES[rtoKey];
    const localSrc = source(
      "local:rto",
      "Transport ministry state/RTO code reference (bundled)",
      "https://parivahan.gov.in/",
      "dataset",
    );

    return {
      status: "ok",
      summary: `${stateCode}-${rtoCode} → ${state ?? "unknown state"}${zone ? `, ${zone}` : ""}; series ${series || "(none)"}, serial ${serial}.`,
      evidence: [
        evidence(
          skill,
          "State code",
          `${stateCode} — ${state ?? "not in reference table"}`,
          {
            source: localSrc,
            confidence: state ? "confirmed" : "possible",
          },
        ),
        evidence(skill, "RTO zone", zone ?? "not in the curated subset", {
          source: localSrc,
          confidence: zone ? "probable" : "unknown",
          detail: zone
            ? "RTO-to-district mapping is a curated public subset; confirm on Parivahan for court-grade reporting."
            : "This RTO code is not in the bundled subset — the state code is still reliable.",
        }),
        evidence(skill, "Series", series || "not present", { source: localSrc }),
        evidence(skill, "Serial", serial, { source: localSrc }),
        evidence(
          skill,
          "Plate class",
          stateCode === "DL" && /^\d/.test(series)
            ? "possible commercial/T-permit"
            : "private or commercial — not derivable from the plate",
          {
            source: localSrc,
            confidence: "possible",
          },
        ),
        evidence(
          skill,
          "Registered owner",
          "not accessible without statutory authorisation",
          {
            source: localSrc,
            kind: "warning",
            confidence: "unknown",
            detail:
              "Owner data behind a plate lives in VAHAN and is released only to authorised agencies or the owner. Third-party “RC lookup” sites resell scraped data and are both unreliable and unlawful to use for surveillance.",
          },
        ),
      ],
      entities: [
        entity(
          skill,
          "text",
          `${stateCode}-${rtoCode} ${series} ${serial}`.trim(),
          "Registration plate",
          attrs({
            state: state ?? "",
            rto: zone ?? rtoKey,
          }),
        ),
      ],
      sources: [localSrc],
    };
  },
};

/* ----------------------- Indian identity documents -------------------- */

const GST_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstinCheckDigit(first14: string): string {
  let factor = 1;
  let total = 0;
  for (const char of first14) {
    const code = GST_CHARSET.indexOf(char);
    if (code < 0) {
      return "?";
    }
    let addend = factor * code;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 36) + (addend % 36);
    total += addend;
  }
  return GST_CHARSET[(36 - (total % 36)) % 36] ?? "?";
}

const PAN_HOLDER: Record<string, string> = {
  P: "individual",
  C: "company",
  H: "Hindu undivided family",
  F: "partnership firm / LLP",
  A: "association of persons",
  T: "trust",
  B: "body of individuals",
  L: "local authority",
  J: "artificial juridical person",
  G: "government",
};

const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "36": "Telangana",
  "37": "Andhra Pradesh",
};

export const identityDocuments: SkillDefinition = {
  id: "identity-documents",
  name: "Identity document formats",
  short: "Documents",
  description:
    "Validates Indian document formats offline — Aadhaar (Verhoeff checksum), GSTIN (mod-36 check digit), PAN holder type, IFSC, UPI VPA and voter/passport structure. Values are masked by default.",
  category: "identity",
  runtime: "local",
  accepts: ["text"],
  produces: ["document-validity", "masked-numbers"],
  keywords: [
    "aadhaar",
    "pan",
    "gstin",
    "gst",
    "ifsc",
    "upi",
    "voter",
    "epic",
    "passport",
    "dl",
    "kyc",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "identity-documents";
    const input = target.raw.toUpperCase();
    const localSrc = source(
      "local:docformats",
      "Bundled document-format validators (offline)",
      undefined,
      "local",
    );
    const evidenceItems = [];
    const entities = [];

    const aadhaarMatch = target.raw.replace(/\s/g, "").match(/\b([2-9]\d{11})\b/);
    if (aadhaarMatch) {
      const digits = aadhaarMatch[1];
      const valid = verifyVerhoeff(digits);
      evidenceItems.push(
        evidence(skill, "Aadhaar number", `••••••${digits.slice(-4)} (masked)`, {
          source: localSrc,
          severity: valid ? "high" : "medium",
          detail: valid
            ? "Passes the Verhoeff checksum UIDAI uses. Treat as a real Aadhaar number: handle under DPDP Act obligations, never store unmasked."
            : "Fails the Verhoeff checksum — the number is mistyped or fabricated.",
        }),
        evidence(skill, "Aadhaar checksum (Verhoeff)", valid ? "valid" : "invalid", {
          source: localSrc,
          confidence: "confirmed",
        }),
      );
    }

    const panMatch = input.match(/\b([A-Z]{5})(\d{4})([A-Z])\b/);
    if (panMatch) {
      const holder = PAN_HOLDER[panMatch[1][3]];
      evidenceItems.push(
        evidence(
          skill,
          "PAN",
          `${panMatch[1].slice(0, 2)}•••${panMatch[1][4]}${panMatch[2]}• (masked)`,
          {
            source: localSrc,
            detail: `Fourth character indicates holder type: ${holder ?? "unknown"}; fifth character is the first letter of the surname or entity name (${panMatch[1][4]}). The final check character is computed by the income-tax department and cannot be verified offline.`,
          },
        ),
      );
    }

    const gstinMatch = input.match(
      /\b(\d{2})([A-Z]{5}\d{4}[A-Z])(\d)([A-Z])([0-9A-Z])\b/,
    );
    if (gstinMatch) {
      const [, stateCode, _pan, entityCode, entityType, checkChar] = gstinMatch;
      const expected = gstinCheckDigit(gstinMatch[0].slice(0, 14));
      const valid = expected === checkChar;
      evidenceItems.push(
        evidence(
          skill,
          "GSTIN",
          `${gstinMatch[0].slice(0, 2)}••••••••••••${gstinMatch[0].slice(-2)} (masked)`,
          {
            source: localSrc,
            severity: valid ? "info" : "medium",
            detail: `State ${stateCode} (${STATE_CODES[stateCode] ?? "unknown"}), entity number ${Number(entityCode)}, ${entityType === "P" ? "permanent" : "additional/other"} registration. Mod-36 check digit ${valid ? "matches" : `does NOT match (expected ${expected})`}.`,
          },
        ),
        evidence(skill, "GSTIN checksum", valid ? "valid" : "invalid", {
          source: localSrc,
          confidence: "confirmed",
        }),
      );
      if (STATE_CODES[stateCode]) {
        entities.push(
          entity(
            skill,
            "address",
            STATE_CODES[stateCode],
            "GSTIN state of registration",
            [],
            "confirmed",
          ),
        );
      }
    }

    const ifscMatch = input.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
    if (ifscMatch) {
      evidenceItems.push(
        evidence(skill, "IFSC", ifscMatch[1], {
          source: localSrc,
          detail: ifscLooksValid(ifscMatch[1])
            ? "Matches the RBI structure: 4-letter bank code, reserved 0, 6-character branch code. The branch name itself requires the RBI/NPCI IFSC registry."
            : "Does not match the RBI IFSC structure.",
        }),
      );
    }

    const upiMatch = input.match(/\b([A-Z0-9._-]{2,60}@[A-Z]{2,30})\b/);
    if (upiMatch && upiLooksValid(upiMatch[1])) {
      const handle = upiMatch[1].split("@")[1]?.toLowerCase() ?? "";
      evidenceItems.push(
        evidence(skill, "UPI VPA", upiMatch[1], {
          source: localSrc,
          detail: UPI_HANDLES[handle]
            ? `Handle @${handle} is issued by ${UPI_HANDLES[handle]}.`
            : `Handle @${handle} is not in the bundled PSP list — banks and PSPs do add new handles, so treat this as unverified rather than fake.`,
          confidence: UPI_HANDLES[handle] ? "confirmed" : "possible",
        }),
      );
    }

    const epic = input.match(/\b([A-Z]{3}\d{7})\b/);
    if (epic) {
      evidenceItems.push(
        evidence(
          skill,
          "Voter ID (EPIC) structure",
          `${epic[1].slice(0, 3)}••••${epic[1].slice(-2)}`,
          {
            source: localSrc,
            confidence: "possible",
            detail:
              "Matches the 3-letter + 7-digit EPIC shape. There is no public checksum, so the electorate and constituency cannot be derived locally.",
          },
        ),
      );
    }

    const passport = input.match(/\b([A-PR-WY][1-9]\d{6})\b/);
    if (passport && !epic) {
      evidenceItems.push(
        evidence(skill, "Passport structure", "matches letter + 7-digit pattern", {
          source: localSrc,
          confidence: "possible",
          detail:
            "Indian passports use one letter followed by seven digits. No offline checksum exists; validity requires the Passport Seva database.",
        }),
      );
    }

    if (evidenceItems.length === 0) {
      return {
        status: "partial",
        summary: "No Indian identity-document pattern matched in the input.",
        evidence: [
          evidence(
            skill,
            "Patterns checked",
            "Aadhaar, PAN, GSTIN, IFSC, UPI VPA, EPIC, passport",
            {
              source: localSrc,
              kind: "fact",
            },
          ),
        ],
        entities: [],
        sources: [localSrc],
      };
    }

    return {
      status: "ok",
      summary: `Validated ${evidenceItems.length / 2 > 1 ? "several" : "one"} document pattern(s) offline; identifiers masked in output.`,
      evidence: evidenceItems,
      entities,
      sources: [localSrc],
    };
  },
};

/* --------------------------- Coordinates ------------------------------- */

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function toDms(value: number, isLat: boolean): string {
  const hemisphere = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = ((minutesFloat - minutes) * 60).toFixed(2);
  return `${degrees}°${minutes}'${seconds}"${hemisphere}`;
}

export const coordinateIntelligence: SkillDefinition = {
  id: "coordinate-intelligence",
  name: "Coordinate analysis",
  short: "Geo",
  description:
    "Normalises decimal/DMS coordinates, converts them, and reports distance to the nearest reference city in the bundled index plus the PIN circle it falls in.",
  category: "knowledge",
  runtime: "local",
  accepts: ["coordinate"],
  produces: ["decimal", "dms", "nearest-city"],
  keywords: [
    "coordinate",
    "latitude",
    "longitude",
    "gps",
    "geo",
    "location",
    "dms",
    "map",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "coordinate-intelligence";
    const localSrc = source(
      "local:cities",
      "Bundled city index + geodesic maths (offline)",
      undefined,
      "dataset",
    );
    const decimal = target.raw.match(/(-?\d{1,3}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/);

    let lat: number | undefined;
    let lon: number | undefined;

    if (decimal) {
      lat = Number(decimal[1]);
      lon = Number(decimal[2]);
    } else {
      const dms = target.raw.match(
        /(\d{1,3})[°\s]+(\d{1,2})['′\s]+([\d.]+)?["″\s]*([NSEW])/gi,
      );
      if (dms && dms.length >= 2) {
        const parsed = dms.slice(0, 2).map((part) => {
          const bits = part.match(
            /(\d{1,3})[°\s]+(\d{1,2})['′\s]+([\d.]+)?["″\s]*([NSEW])/i,
          );
          if (!bits) {
            return undefined;
          }
          const sign = /[SW]/i.test(bits[4]) ? -1 : 1;
          return (
            sign * (Number(bits[1]) + Number(bits[2]) / 60 + Number(bits[3] ?? 0) / 3600)
          );
        });
        [lat, lon] = parsed;
      }
    }

    if (
      lat === undefined ||
      lon === undefined ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    ) {
      return {
        status: "partial",
        summary: "Coordinates could not be parsed.",
        evidence: [],
        entities: [],
        sources: [localSrc],
        error: { code: "parse", message: "Unparsable coordinate pair." },
      };
    }

    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return {
        status: "error",
        summary: "Latitude or longitude is outside the valid range.",
        evidence: [],
        entities: [],
        sources: [localSrc],
        error: { code: "parse", message: "Out-of-range coordinate." },
      };
    }

    const nearest = CITY_INDEX.map(([name, cityLat, cityLon]) => ({
      name,
      distance: haversineKm(lat as number, lon as number, cityLat, cityLon),
    })).sort((a, b) => a.distance - b.distance)[0];

    const inIndia = lat >= 6 && lat <= 37.5 && lon >= 68 && lon <= 97.5;

    return {
      status: "ok",
      summary: `${lat.toFixed(5)}, ${lon.toFixed(5)} — ${nearest.distance.toFixed(1)} km from ${nearest.name}${inIndia ? " (inside Indian bounds)" : ""}.`,
      evidence: [
        evidence(skill, "Decimal degrees", `${lat.toFixed(6)}, ${lon.toFixed(6)}`, {
          source: localSrc,
        }),
        evidence(skill, "DMS", `${toDms(lat, true)} ${toDms(lon, false)}`, {
          source: localSrc,
        }),
        evidence(
          skill,
          "Nearest indexed city",
          `${nearest.name} — ${nearest.distance.toFixed(1)} km`,
          {
            source: localSrc,
            confidence: "probable",
            detail:
              "Distance to the closest entry in the bundled reference index, not a geocoded street address.",
          },
        ),
        evidence(skill, "Indian territorial bounds", inIndia ? "inside" : "outside", {
          source: localSrc,
        }),
        evidence(
          skill,
          "Reverse geocoding",
          "street-level reverse geocoding requires a provider (Google/Nominatim) with a key or rate budget",
          { source: localSrc, kind: "warning", confidence: "unknown" },
        ),
      ],
      entities: [
        entity(
          skill,
          "coordinate",
          `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
          "Coordinate",
          attrs({
            nearestCity: nearest.name,
            distanceKm: nearest.distance.toFixed(1),
          }),
        ),
      ],
      sources: [localSrc],
    };
  },
};

/* --------------------------- Name conventions -------------------------- */

const SCRIPTS: Array<[string, RegExp, string]> = [
  ["Devanagari", /[\u0900-\u097F]/, "Hindi, Marathi, Nepali, Sanskrit"],
  ["Bengali", /[\u0980-\u09FF]/, "Bangla and Assamese"],
  ["Gurmukhi", /[\u0A00-\u0A7F]/, "Punjabi"],
  ["Gujarati", /[\u0A80-\u0AFF]/, "Gujarati"],
  ["Odia", /[\u0B00-\u0B7F]/, "Odia"],
  ["Tamil", /[\u0B80-\u0BFF]/, "Tamil"],
  ["Telugu", /[\u0C00-\u0C7F]/, "Telugu"],
  ["Kannada", /[\u0C80-\u0CFF]/, "Kannada"],
  ["Malayalam", /[\u0D00-\u0D7F]/, "Malayalam"],
  ["Arabic", /[\u0600-\u06FF]/, "Urdu, Kashmiri"],
];

const SUFFIX_HINTS: Array<[RegExp, string, string]> = [
  [
    /(wad|kar|deshpande|joshi|patil|deshmukh)$/i,
    "Maharashtra",
    "Marathi surname morphology",
  ],
  [
    /(iyer|iyengar|subramanian|natarajan|krishnan|murugan|raj|kumar)$/i,
    "Tamil Nadu / South India",
    "Southern given-name / patronymic morphology",
  ],
  [
    /(reddy|naidu|rao|chowdary|sarma|sharma)$/i,
    "Telugu states / North India",
    "Common Telugu and northern suffixes",
  ],
  [/(nair|menon|pillai|kurup|thampi)$/i, "Kerala", "Malayali surname morphology"],
  [/(bhai|ben|patel|desai|mehta|shah)$/i, "Gujarat", "Gujarati surname morphology"],
  [/(singh|kaur|grewal|sidhu|gill)$/i, "Punjab", "Punjabi name morphology"],
  [
    /(banerjee|chatterjee|mukherjee|bose|ghosh|das)$/i,
    "West Bengal",
    "Bengali surname morphology",
  ],
  [/(bhat|shetty|hegde|gouda|rao)$/i, "Karnataka", "Kannada surname morphology"],
  [
    /(chauhan|rathore|sisodia|tomar|jadeja)$/i,
    "Rajasthan / Gujarat",
    "Rajput-era surname morphology",
  ],
];

export const nameConventions: SkillDefinition = {
  id: "name-conventions",
  name: "Name analysis",
  short: "Names",
  description:
    "Detects Indian scripts, honorifics and naming morphology to help plan transliteration variants for searches. Deliberately does not infer community, caste or religion.",
  category: "identity",
  runtime: "local",
  accepts: ["person", "text"],
  produces: ["scripts", "transliteration-variants"],
  keywords: [
    "name",
    "person",
    "surname",
    "spelling",
    "transliteration",
    "hindi",
    "tamil",
    "variant",
    "alias",
  ],
  clientFallback: true,
  async run(target) {
    const skill = "name-conventions";
    const input = target.raw.trim();
    const localSrc = source(
      "local:onomastics",
      "Bundled script and morphology reference (offline)",
      undefined,
      "dataset",
    );
    const scripts = SCRIPTS.filter(([, regex]) => regex.test(input));
    const honorifics =
      input.match(/\b(Shri|Sri|Smt|Shrimati|Dr|Mr|Mrs|Ms|Adv|Prof|Er)\b\.?/gi) ?? [];
    const words = input.split(/\s+/).filter(Boolean);
    const lastWord = words[words.length - 1] ?? "";
    const hints = SUFFIX_HINTS.filter(([regex]) => regex.test(lastWord));

    const variants = new Set<string>();
    variants.add(input);
    variants.add(input.replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u"));
    variants.add(input.replace(/\bSh/g, "S").replace(/v/g, "w"));
    variants.add(input.replace(/w/g, "v").replace(/th/g, "t"));
    variants.add(input.replace(/ee/g, "i").replace(/kh/g, "k"));
    variants.add(words.slice().reverse().join(" "));

    return {
      status: "ok",
      summary: `${words.length} name token(s)${scripts.length ? `, script: ${scripts.map(([name]) => name).join(", ")}` : ", Latin transliteration"}${
        hints.length
          ? `, morphology suggests ${hints.map((hint) => hint[1]).join(" / ")}`
          : ""
      }.`,
      evidence: [
        evidence(
          skill,
          "Script",
          scripts.length
            ? scripts.map(([name, , languages]) => `${name} (${languages})`).join(" · ")
            : "Latin (romanised)",
          {
            source: localSrc,
          },
        ),
        evidence(skill, "Honorifics", honorifics.join(" · ") || "none", {
          source: localSrc,
        }),
        evidence(skill, "Name tokens", String(words.length), {
          source: localSrc,
          kind: "metric",
        }),
        ...(hints.length > 0
          ? [
              evidence(
                skill,
                "Regional morphology hint",
                hints.map((hint) => `${hint[1]} — ${hint[2]}`).join(" · "),
                {
                  source: localSrc,
                  confidence: "possible",
                  detail:
                    "Linguistic suffix patterns only. Treat as a search-planning hint, never as a determination about a person.",
                },
              ),
            ]
          : []),
        evidence(
          skill,
          "Search variants generated",
          Array.from(variants).slice(1, 8).join(" · "),
          {
            source: localSrc,
            raw: Array.from(variants),
          },
        ),
        evidence(skill, "Community / caste / religion inference", "refused by design", {
          source: localSrc,
          kind: "warning",
          confidence: "confirmed",
          detail:
            "Onomastic inference of caste or religion is unreliable and its use for decisions on individuals is prohibited under Indian equality and data-protection law. The console will not produce it.",
        }),
      ],
      entities: [entity(skill, "person", input, "Name under analysis")],
      sources: [localSrc],
    };
  },
};

/* ---------------------- Sanctions (keyed provider) --------------------- */

export const sanctionsScreening: SkillDefinition = {
  id: "sanctions-screening",
  name: "Sanctions & watchlists",
  short: "Sanctions",
  description:
    "Screens a name or entity against consolidated sanctions and PEP datasets. Requires an OpenSanctions API key; without it the skill reports itself as unavailable instead of guessing.",
  category: "knowledge",
  runtime: "live",
  accepts: ["person", "organisation", "text"],
  produces: ["sanctions-hits", "pep-flags"],
  keywords: ["sanctions", "watchlist", "pep", "ofac", "compliance", "aml", "screening"],
  clientFallback: false,
  requiresKey: ["OPENSANCTIONS_API_KEY"],
  async run(target, ctx) {
    const skill = "sanctions-screening";
    const apiKey = ctx.env("OPENSANCTIONS_API_KEY");
    const apiSrc = source(
      "sanctions:opensanctions",
      "OpenSanctions consolidated dataset",
      "https://api.opensanctions.org/search/default",
      "dataset",
    );

    if (!apiKey) {
      return {
        status: "blocked",
        summary:
          "Sanctions screening needs an OpenSanctions API key (OPENSANCTIONS_API_KEY). No screen was performed and no hit is implied.",
        evidence: [
          evidence(skill, "Screening status", "not performed — key not configured", {
            source: apiSrc,
            kind: "warning",
            confidence: "unknown",
            detail:
              "OpenSanctions offers free developer keys at opensanctions.org. This console will never print a fabricated “no match”.",
          }),
        ],
        entities: [],
        sources: [apiSrc],
        error: { code: "requires_key", message: "OPENSANCTIONS_API_KEY not configured." },
      };
    }

    const response = await request<{
      results?: Array<{
        id: string;
        caption: string;
        schema: string;
        datasets?: string[];
        score: number;
        properties?: Record<string, string[]>;
      }>;
    }>(
      `https://api.opensanctions.org/search/default?q=${encodeURIComponent(target.raw)}&limit=5`,
      ctx,
      { headers: { authorization: `ApiKey ${apiKey}` }, timeoutMs: 12000 },
    );

    if (!response.ok) {
      return {
        status: response.error.status === 401 ? "blocked" : "error",
        summary: `Screening provider rejected the request: ${response.error.message}`,
        evidence: [],
        entities: [],
        sources: [apiSrc],
        error: response.error,
      };
    }

    const results = response.data.results ?? [];
    return {
      status: "ok",
      summary:
        results.length === 0
          ? `No sanctions or PEP entries above threshold for “${target.raw}”.`
          : `${results.length} candidate entit(ies) returned for review.`,
      evidence: results.map((result) =>
        evidence(skill, result.caption, `score ${(result.score * 100).toFixed(0)}%`, {
          source: apiSrc,
          severity: result.score > 0.85 ? "high" : "medium",
          detail: `Schema ${result.schema}; datasets ${(result.datasets ?? []).join(", ")}. Name matches are not identity matches — verify dates of birth and aliases.`,
        }),
      ),
      entities: results.map((result) =>
        entity(
          skill,
          "person",
          result.caption,
          "Watchlist candidate",
          attrs({ schema: result.schema }),
          "possible",
        ),
      ),
      sources: [apiSrc],
    };
  },
};

export const indiaSkills: SkillDefinition[] = [
  pincodeIntelligence,
  vehicleRegistration,
  identityDocuments,
  coordinateIntelligence,
  nameConventions,
  sanctionsScreening,
];
