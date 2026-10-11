// The only API client. Every backend response is { ok, data?, error? }.

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3001";

export type RoofType = "rcc" | "tin" | "tiles";
export type SafetyAnswer = "yes" | "no" | "not_sure";
export type FeasibilityCode = "contamination_risk" | "waterlogging" | "foundation_risk";
export type PlanStatus = "planned" | "applied" | "installed" | "verified" | "needs_attention";

export interface PlanInputs {
  address: string;
  lat: number;
  lon: number;
  ward?: string;
  roofPolygon?: GeoJSON.Polygon | null;
  roofAreaM2: number;
  plotAreaM2: number;
  residents: number;
  openSpace: boolean;
  roofType?: RoofType;
  monthlyWaterBill?: number;
  tankersPerYear?: number;
  buildingId?: string;
  contaminationSourceNearby?: SafetyAnswer;
  waterloggingArea?: SafetyAnswer;
  pitNearFoundation?: SafetyAnswer;
}

export interface Structure {
  type: "recharge_pit" | "recharge_trench" | "storage_tank";
  label: string;
  count: number;
  dimensions: { lengthM?: number; widthM?: number; depthM?: number; litresEach?: number };
  capacityLitres: number;
  structureCostInr: number;
  filterCostInr: number;
  installCostInr: number;
  designStormLitres: number;
  rechargeRuledOut?: boolean;
  optionalTank: Omit<Structure, "optionalTank" | "filterCostInr" | "installCostInr" | "designStormLitres"> | null;
}

export interface Money {
  installCostInr: number;
  subsidyInr: number;
  netCostInr: number;
  annualRebateInr: number;
  penaltyAvoidedInr: number;
  tankerSavingsInr: number;
  annualBenefitInr: number;
  paybackYears: number | null;
  /** Value of rainwater a household uses from its tank (tank plans only). */
  tankWaterValueInr?: number;
}

export interface WaterYear {
  year: number;
  rainMm: number;
  rainOnRoofLitres: number;
  savedLitres: number;
  lostLitres: number;
}

/** What the recommended system actually saves, replayed day by day over the last ten years of real rain. */
export interface WaterBalance {
  kind: "recharge" | "use";
  yearsSimulated: number;
  firstYear: number;
  lastYear: number;
  rainOnRoofLitres: number;
  savedLitres: number;
  lostLitres: number;
  savedShare: number;
  periodSavedLitres: number;
  dryYear: WaterYear;
  wetYear: WaterYear;
  monthly: { month: number; savedLitres: number; lostLitres: number }[];
  dailyUseLitres: number | null;
  upgrade: { litresEach: number; count: number; extraSavedLitres: number; extraCostInr: number } | null;
}

export interface Plan
  extends Required<Omit<PlanInputs, "roofPolygon" | "buildingId" | "contaminationSourceNearby" | "waterloggingArea" | "pitNearFoundation">> {
  planId: string;
  buildingId: string | null;
  contaminationSourceNearby: SafetyAnswer | null;
  waterloggingArea: SafetyAnswer | null;
  pitNearFoundation: SafetyAnswer | null;
  feasibility?: { reasons: FeasibilityCode[]; warnings: FeasibilityCode[] };
  roofPolygon: GeoJSON.Polygon | null;
  rainfallMm: number;
  rainfallSource: "open-meteo" | "cache" | "default";
  runoffCoefficient: number;
  litresPerYear: number;
  tankersEquivalent: number;
  mandatory: boolean;
  structure: Structure;
  money: Money;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  /** When the application PDF was filed (older plans: read from the PDF's name on the server). */
  appliedAt?: string;
  installedAt?: string;
  verifiedAt?: string;
  /** The ward officer's latest decision on the filed application. */
  review?: Review | null;
  /** Registered as a system that was already built (no officer approval needed). */
  existingSystem?: boolean;
  /** Day-by-day water balance; null when daily rainfall was unavailable. */
  water?: WaterBalance | null;
}

export type ReviewDecision = "approved" | "site_visit" | "rejected";
export type DestinationType = "onsite_recharge" | "water_body" | "storm_drain" | "storage_reuse";

/** Where the harvested (or overflow) water goes. water_body / storm_drain point at a real OpenStreetMap feature. */
export interface Destination {
  type: DestinationType;
  osmId?: string;
  name?: string | null;
  kind?: string | null;
  distanceM?: number | null;
}

export interface Review {
  decision: ReviewDecision;
  destination: Destination | null;
  note: string | null;
  decidedAt: string;
}

/** A pond, lake, reservoir (water_body) or drain/canal (channel) near the house, from OpenStreetMap. */
export interface WaterFeature {
  osmId: string;
  name: string | null;
  kind: string;
  category: "water_body" | "channel";
  lat: number;
  lon: number;
  distanceM: number;
}

export interface NearbyWater {
  available: boolean;
  stale: boolean;
  fetchedAt: string | null;
  source: string;
  features: WaterFeature[];
  suggestion: Destination & { why: string };
}

export interface ApplicationRow {
  planId: string;
  address: string;
  ward: string | null;
  lat: number;
  lon: number;
  roofPolygon: GeoJSON.Polygon | null;
  status: PlanStatus;
  appliedAt: string | null;
  roofAreaM2: number;
  plotAreaM2: number;
  residents: number;
  openSpace: boolean;
  litresPerYear: number;
  mandatory: boolean;
  structure: Pick<Structure, "type" | "count" | "dimensions" | "capacityLitres" | "rechargeRuledOut">;
  feasibility: { reasons: FeasibilityCode[]; warnings: FeasibilityCode[] };
  netCostInr: number;
  applicationUrl: string;
  review: Review | null;
}

export interface Applications {
  ward: string | null;
  wards: { ward: string; total: number; awaiting: number }[];
  rows: ApplicationRow[];
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  ward: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface ChatReply {
  reply: string;
  status: PlanStatus;
  planUpdatedAt: string;
}

export interface ApplicationResult {
  url: string;
  key: string;
  status: PlanStatus;
}

export type Verdict = "healthy" | "needs_cleaning" | "broken" | "unclear";

export interface Check {
  component: "filter" | "pit" | "gutter" | "tank" | "unknown";
  verdict: Verdict;
  reason: string;
  confidence: number;
  at: string;
  retake: boolean;
  distanceM?: number | null;
  locationVerified?: boolean;
}

export interface CheckResult {
  check: Check;
  retake: boolean;
  tip: string | null;
  plan: Plan;
  locationWarning: boolean;
  locationMessage: string | null;
}

/** Where and when a photo was taken (browser location first, EXIF as a fallback). */
export interface CaptureInfo {
  captureLat?: number;
  captureLon?: number;
  captureAccuracyM?: number;
  capturedAt?: string;
  exifLat?: number;
  exifLon?: number;
  exifTakenAt?: string;
}

export interface WardSummary {
  ward: string | null;
  total: number;
  byStatus: Record<PlanStatus, number>;
  potentialLitres: number;
  harvestingLitres: number;
  verifiedLitres: number;
  /** Real filed applications and the ward officer's decisions (absent on an older backend). */
  applications?: ApplicationsSummary;
}

export interface ApplicationsSummary {
  filed: number;
  awaiting: number;
  approved: number;
  siteVisit: number;
  rejected: number;
  approvedLitres: number;
  destinations: Record<DestinationType, { plans: number; litres: number }>;
}

export interface Dashboard {
  wards: (WardSummary & { ward: string; slug: string | null; requiredBuildings: number | null; complianceScore: number | null })[];
  selected: WardSummary;
  points: { planId: string; lat: number; lon: number; status: PlanStatus; litresPerYear: number; review?: ReviewDecision | null; filed?: boolean }[];
}

export interface RuleSource {
  title: string;
  url: string;
  date: string;
}

export interface Rules {
  mandatory_min_plot_m2: number;
  max_assistance_inr: number;
  assistance_fraction: number;
  rebate_fraction: number;
  penalty_fraction: number;
  tanker_litres: number;
  tanker_price_inr: number;
  runoff_coefficients: Record<RoofType, number>;
  authority_name: string;
  sources: Record<string, RuleSource[]>;
  designStorm: { mmPerHour: number; minutes: number };
  filterCostInr: number;
}

export interface WardSummary2 {
  slug: string;
  ward: string;
  officialName: string;
  wardNo: string;
  buildingCount: number;
  requiredCount: number;
  totalLitresPerYear: number;
  totalRoofAreaM2: number;
  rainfallMm: number;
  rainfallSource: string;
  centroid: [number, number];
  bbox: [number, number, number, number];
  boundary?: GeoJSON.Polygon;
}

export interface WardDetail extends WardSummary2 {
  buildingsUrl: string;
  colourBuckets: number[];
  polygonsMinZoom: number;
  nearestBuildingMaxM: number;
  dailyCycles: number;
}

export interface BuildingProps {
  buildingId: string;
  areaM2: number;
  litresPerYear: number;
  mandatory: "required" | "maybe";
  centroid: [number, number];
}

export type BuildingFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, BuildingProps>;

export interface SimulationPlan {
  planId: string;
  buildingId: string;
  status: PlanStatus;
  outcome: "captured" | "broken" | "lost";
  runoff: number;
  captured: number;
  lost: number;
}

export interface Simulation {
  ward: string;
  slug: string;
  date: string;
  rainMm: number;
  totals: { captured: number; lostToDrains: number; lostBroken: number };
  totalRunoff: number;
  ifAllRequiredHarvested: number;
  plans: SimulationPlan[];
  otherBuildings: { buildings: number; runoff: number };
}

export interface PublicStatus {
  planId: string;
  ward: string | null;
  structureType: Structure["type"];
  status: PlanStatus;
  lastCheckAt: string | null;
  lastVerdict: Verdict | null;
  locationVerified: boolean;
  verifiedAt: string | null;
}

export interface AttentionRow {
  planId: string;
  ward: string | null;
  structure: Structure["type"];
  lastVerdict: Verdict | null;
  lastComponent: Check["component"] | null;
  lastCheckAt: string | null;
  daysOpen: number | null;
}

export interface Gap {
  ward: string;
  slug: string;
  required: number;
  withPlan: number;
  withoutPlan: number;
  byStatus: Record<PlanStatus, number>;
  verified: number;
  complianceScore: number | null;
  withoutPlanPoints: [number, number][];
  planPoints: { lon: number; lat: number; status: PlanStatus; planId: string }[];
}

export interface ImpactDay {
  date: string;
  mm: number;
  litres: number;
  broken: boolean;
}

export interface Impact {
  available: boolean;
  stale: boolean;
  computedAt: string | null;
  installedOn?: string;
  totalLitres?: number;
  seasonLitres?: number;
  season?: [string, string];
  lastRain?: ImpactDay | null;
  brokenDays?: number;
  series?: ImpactDay[];
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach Boond right now. Check your connection and try again.");
  }
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new ApiError("Unexpected response from server.");
  }
  if (!json.ok) throw new ApiError(json.error ?? "Something went wrong.", res.status);
  return json.data as T;
}

/** PUT a file to a presigned URL. */
export async function uploadFile(url: string, blob: Blob, contentType: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  } catch {
    throw new ApiError("Upload failed. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError("Upload failed. Please try again.");
}

/** Download a ward's building footprints (gzip is decoded by the browser via Content-Encoding). */
export async function fetchBuildings(url: string): Promise<BuildingFeature[]> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError("Can't load the building map. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError("Can't load the building map. Please try again.");
  const data = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, BuildingProps>;
  return data.features;
}

export const api = {
  geocode: (q: string) => request<GeocodeResult[]>("GET", `/geocode?q=${encodeURIComponent(q)}`),
  reverseGeocode: (lat: number, lon: number) => request<GeocodeResult[]>("GET", `/geocode?lat=${lat}&lon=${lon}`),
  rules: () => request<Rules>("GET", "/rules"),
  wards: () => request<WardSummary2[]>("GET", "/wards"),
  ward: (slug: string) => request<WardDetail>("GET", `/wards/${encodeURIComponent(slug)}`),
  simulate: (slug: string, date?: string) =>
    request<Simulation>("GET", `/wards/${encodeURIComponent(slug)}/simulate${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  createPlan: (inputs: PlanInputs) => request<Plan>("POST", "/plans", inputs),
  getPlan: (id: string) => request<Plan>("GET", `/plans/${encodeURIComponent(id)}`),
  updatePlan: (id: string, changes: Partial<PlanInputs>) => request<Plan>("PATCH", `/plans/${encodeURIComponent(id)}`, changes),
  getChat: (id: string) => request<{ messages: ChatMessage[] }>("GET", `/plans/${encodeURIComponent(id)}/chat`),
  chat: (id: string, message: string, lang: "en" | "hi") =>
    request<ChatReply>("POST", `/plans/${encodeURIComponent(id)}/chat`, { message, lang }),
  uploadUrl: (id: string, purpose: "installation" | "check", contentType: string) =>
    request<{ uploadUrl: string; key: string; contentType: string }>("POST", `/plans/${encodeURIComponent(id)}/photos/upload-url`, {
      purpose,
      contentType,
    }),
  registerInstallation: (id: string, photoKey: string, capture: CaptureInfo, alreadyBuilt = false) =>
    request<Plan>("POST", `/plans/${encodeURIComponent(id)}/installation`, { photoKey, ...capture, ...(alreadyBuilt ? { alreadyBuilt: true } : {}) }),
  runCheck: (id: string, photoKey: string, capture: CaptureInfo) =>
    request<CheckResult>("POST", `/plans/${encodeURIComponent(id)}/checks`, { photoKey, ...capture }),
  listChecks: (id: string) => request<{ checks: Check[]; tips: string[] }>("GET", `/plans/${encodeURIComponent(id)}/checks`),
  attention: (ward?: string) =>
    request<{ ward: string | null; rows: AttentionRow[] }>("GET", `/dashboard/attention${ward ? `?ward=${encodeURIComponent(ward)}` : ""}`),
  gap: (ward: string) => request<Gap>("GET", `/dashboard/gap?ward=${encodeURIComponent(ward)}`),
  dashboard: (ward?: string) => request<Dashboard>("GET", `/dashboard${ward ? `?ward=${encodeURIComponent(ward)}` : ""}`),
  certificate: (id: string) =>
    request<{ url: string; key: string; verifyUrl: string }>("POST", `/plans/${encodeURIComponent(id)}/certificate`),
  impact: (id: string) => request<Impact>("GET", `/plans/${encodeURIComponent(id)}/impact`),
  verify: (id: string) => request<PublicStatus>("GET", `/verify/${encodeURIComponent(id)}`),
  applications: (ward?: string) =>
    request<Applications>("GET", `/officer/applications${ward ? `?ward=${encodeURIComponent(ward)}` : ""}`),
  nearbyWater: (id: string) => request<NearbyWater>("GET", `/plans/${encodeURIComponent(id)}/nearby-water`),
  review: (id: string, body: { decision: ReviewDecision; destination: Destination | null; note: string }) =>
    request<Plan>("POST", `/plans/${encodeURIComponent(id)}/review`, body),
  generateApplication: (id: string) => request<ApplicationResult>("POST", `/plans/${encodeURIComponent(id)}/application`),
};
