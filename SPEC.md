# Boond — Project Spec (for Claude Code)

> **Read this whole file before writing any code.** Build in the milestone order at the bottom. After each milestone, the app must still run end to end.

---

## 0. Context

- **Event:** WeMakeDevs × AWS *Environmental Hacks* (Bharat Builds Tour). Track: **Heat and Water**.
- **Judged on:** idea & impact, built on AWS, design & usability, execution ("one feature that works beats five that almost do"), and a **3-minute recorded demo video**.
- **Hard rules:**
  - Must use at least one AWS open-source tool **or** be deployed on AWS. We do both: **Strands Agents SDK** (open source) + deployment on **AWS** (Lambda, API Gateway, DynamoDB, S3, Bedrock, Amplify, EventBridge, SNS).
  - All code must be written during the event. **Do not copy code from other repos.** Commit early and often so git history matches the event dates.

## 1. Product in one line

**Boond gets every Delhi rooftop harvesting rainwater in 30 seconds — and keeps it working.**

## 2. Problem (use in README + video)

- Ministry of Jal Shakti (SIH 2025, PS **SIH25065**): there is currently **no user-friendly digital platform** for people to assess their rooftop rainwater harvesting (RTRWH) potential.
- Delhi "Catch the Rain 2026" (May 2026): rainwater harvesting **mandatory for buildings ≥ 100 sq m**; up to **₹50,000** financial assistance; up to **10% water-bill rebate**; non-compliance penalty reported as **50% of the water bill**.
- Installed systems fail without maintenance (e.g. ~55% non-functional in Bengaluru; 70–80% defunct in Faridabad).

> All policy numbers must live in **one config file** (`backend/config/delhi_rules.json`) so they can be corrected without code changes. Never hard-code them elsewhere.

## 3. Users

1. **Homeowner / RWA secretary** (primary) — wants to know: do I need this, what to build, what it costs, how to apply, is my system still working.
2. **Jal Board / ward officer** (secondary) — dashboard of planned, installed and verified-healthy systems per ward.

## 4. User journey (the demo flow)

1. Open app → enter address → map zooms to satellite view.
2. **Draw/confirm roof** → roof outlined → area shown in sq m (editable).
3. Answer 3 questions: plot area (sq m), number of residents, open space available (yes/no).
4. **Plan screen:** litres/year, "= N water tankers", mandatory or not, recommended structure + size, cost, subsidy, rebate, penalty avoided, payback years.
5. **Ask Boond** (chat, Hindi or English) → answers using this user's plan.
6. **Apply** → agent generates filled application summary + document checklist as PDF.
7. **Register installation** → upload photo → status = Installed.
8. **Pre-monsoon health check** → reminder → upload filter/pit photo → AI verdict (Healthy / Needs cleaning / Broken + reason) → **"Boond Verified"** badge when healthy.
9. **Ward dashboard** → counts and litres recharged per ward.

## 5. Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind, Leaflet (`react-leaflet`), Leaflet-Geoman (polygon drawing), `@turf/area` |
| Imagery | Esri World Imagery tiles (show required attribution) |
| Geocoding | Amazon Location Service Places (fallback: Nominatim, max 1 req/s, with User-Agent) |
| API | Amazon API Gateway (HTTP API) → AWS Lambda (Python 3.12) |
| Agent | **Strands Agents SDK** (`strands-agents`) with `BedrockModel` |
| LLM / Vision | Amazon Bedrock — model IDs from env vars `BEDROCK_TEXT_MODEL_ID`, `BEDROCK_VISION_MODEL_ID` |
| Data | DynamoDB (single table), S3 (photos, PDFs) via presigned URLs |
| Jobs / alerts | EventBridge Scheduler → Lambda → SNS (email for demo) |
| Rainfall | Open-Meteo Historical Weather API (`archive-api.open-meteo.com/v1/archive`, `daily=precipitation_sum`), cached in DynamoDB |
| IaC | AWS SAM (`template.yaml`) |
| Hosting | AWS Amplify Hosting (frontend) |
| PDF | `reportlab` in Lambda |

## 6. Repository structure

```
boond/
├── README.md
├── SPEC.md                    # this file
├── frontend/
│   ├── src/
│   │   ├── pages/  Home.tsx  Plan.tsx  Chat.tsx  Maintenance.tsx  Dashboard.tsx
│   │   ├── components/  MapRoofDrawer.tsx  PlanCard.tsx  MoneyBreakdown.tsx  ChatBox.tsx  PhotoUpload.tsx  Badge.tsx
│   │   ├── lib/  api.ts  area.ts  i18n.ts (en, hi)
│   │   └── main.tsx
│   └── package.json
├── backend/
│   ├── template.yaml          # SAM
│   ├── config/delhi_rules.json
│   ├── config/structures.json # pit/trench/tank sizing + unit costs
│   ├── src/
│   │   ├── common/  db.py  s3.py  responses.py
│   │   ├── calculator/  handler.py  rainfall.py  sizing.py  money.py
│   │   ├── plans/  handler.py
│   │   ├── agent/  handler.py  tools.py  prompts.py
│   │   ├── application/  pdf.py
│   │   ├── maintenance/  handler.py  vision.py
│   │   ├── reminders/  handler.py
│   │   └── dashboard/  handler.py
│   └── tests/  test_calculator.py  test_money.py  test_sizing.py
└── demo/
    ├── seed_data.py           # seeds ~40 plans across 4 Delhi wards
    └── photos/                # real clean vs clogged filter photos
```

## 7. Core calculations (`backend/src/calculator/`)

**Rainfall** (`rainfall.py`)
- Fetch daily `precipitation_sum` for lat/lon for the last 10 full years; annual average (mm). Cache by rounded lat/lon (2 decimals).
- Fallback if API fails: value from config (`default_annual_rainfall_mm`).

**Harvestable water**
```
litres_per_year = roof_area_m2 × annual_rainfall_mm × runoff_coefficient
```
- `runoff_coefficient` from config by roof type (default concrete/RCC = 0.8).
- `tankers_equivalent = litres_per_year / tanker_litres` (config, default 10000).

**Compliance** (`money.py` + rules)
- `mandatory = plot_area_m2 >= rules.mandatory_min_plot_m2` (config: 100).

**Structure recommendation** (`sizing.py`)
- If open space available → recharge pit/trench (+ optional storage tank); else → storage tank only.
- Size pit/tank from design storm in config (e.g. `design_rainfall_mm_per_hour`), roof area and runoff coefficient. All dimensions/costs from `structures.json`.

**Money** (`money.py`)
```
install_cost      = from structures.json
subsidy           = min(rules.max_assistance_inr, install_cost × rules.assistance_fraction)
net_cost          = install_cost − subsidy
annual_rebate     = monthly_water_bill × 12 × rules.rebate_fraction
penalty_avoided   = (mandatory ? monthly_water_bill × 12 × rules.penalty_fraction : 0)
tanker_savings    = optional, user-provided tankers/year × tanker_price
annual_benefit    = annual_rebate + penalty_avoided + tanker_savings
payback_years     = net_cost / annual_benefit  (null if benefit = 0)
```

**`delhi_rules.json` (initial values — verify against official notification)**
```json
{
  "mandatory_min_plot_m2": 100,
  "max_assistance_inr": 50000,
  "assistance_fraction": 0.5,
  "rebate_fraction": 0.10,
  "penalty_fraction": 0.50,
  "default_annual_rainfall_mm": 750,
  "tanker_litres": 10000,
  "runoff_coefficients": { "rcc": 0.8, "tin": 0.85, "tiles": 0.75 },
  "source_note": "Catch the Rain 2026; verify before demo"
}
```
Unit tests must cover every formula (including zero-benefit and non-mandatory cases).

## 8. Data model (DynamoDB single table `Boond`)

| Item | PK | SK | Key attributes |
|---|---|---|---|
| Plan | `PLAN#<planId>` | `META` | address, lat, lon, ward, roofPolygon (GeoJSON), roofAreaM2, plotAreaM2, residents, openSpace, rainfallMm, litresPerYear, structure, money{...}, status (`planned`/`applied`/`installed`/`verified`/`needs_attention`), createdAt |
| Check | `PLAN#<planId>` | `CHECK#<isoTime>` | photoKey, verdict, reason, confidence |
| Chat | `PLAN#<planId>` | `CHAT#<isoTime>` | role, text |
| Rainfall cache | `RAIN#<lat2>,<lon2>` | `META` | annualMm, fetchedAt |

GSI1: `GSI1PK = WARD#<ward>`, `GSI1SK = STATUS#<status>#<planId>` (for dashboard).

## 9. API (HTTP API, JSON, CORS enabled)

| Method | Path | Purpose |
|---|---|---|
| POST | `/plans` | Body: address, lat, lon, roofPolygon, roofAreaM2, plotAreaM2, residents, openSpace, roofType, monthlyWaterBill?, tankersPerYear? → runs calculator, saves, returns plan |
| GET | `/plans/{id}` | Get plan |
| PATCH | `/plans/{id}` | Update inputs → recalculates |
| POST | `/plans/{id}/chat` | Body: message, lang (`en`/`hi`) → agent reply |
| POST | `/plans/{id}/application` | Generate PDF → returns presigned download URL |
| POST | `/plans/{id}/photos/upload-url` | Body: purpose (`installation`/`check`) → presigned PUT URL + key |
| POST | `/plans/{id}/checks` | Body: photoKey → runs vision → saves check, updates status/badge |
| GET | `/dashboard?ward=` | Aggregates per ward |
| GET | `/geocode?q=` | Address → lat/lon (Location Service) |

## 10. Agent (`backend/src/agent/`)

Strands `Agent` with `BedrockModel(model_id=BEDROCK_TEXT_MODEL_ID)`.

**Tools (`@tool`)**
- `get_plan(plan_id)` → plan JSON
- `recalculate(plan_id, changes)` → runs calculator with changed inputs (does **not** save unless user confirms)
- `explain_rules(topic)` → returns relevant fields from `delhi_rules.json` + plain-language explanation
- `generate_application(plan_id)` → creates PDF in S3, returns link
- `maintenance_tips(structure)` → static checklist from `structures.json`

**System prompt rules (`prompts.py`)**
- Answer in the user's language (Hindi or English), short and practical.
- Only state numbers that come from tools; never invent subsidy amounts or rules.
- Say clearly when something must be confirmed with Delhi Jal Board.
- Before saving any change or generating the application, confirm with the user.

## 11. Maintenance vision check (`backend/src/maintenance/vision.py`)

- Send photo to Bedrock vision model with prompt asking for **strict JSON**:
  `{"component": "filter|pit|gutter|tank|unknown", "verdict": "healthy|needs_cleaning|broken|unclear", "reason": "<one sentence>", "confidence": 0-1}`
- If `unclear` or confidence < 0.6 → ask user to retake photo.
- `healthy` → status `verified`, badge on. `needs_cleaning`/`broken` → status `needs_attention` + fix tip.
- Validate JSON; on parse failure, retry once, then return `unclear`.

## 12. Reminders (`backend/src/reminders/`)

EventBridge schedule (daily). Finds plans with status `installed`/`verified` and no check in the last N days (config; demo uses a short value) → SNS email: "Monsoon is coming — check your filter" + link.

## 13. Frontend pages

- **Home:** address search → map (satellite) → draw/edit roof polygon (Geoman) → live area via turf → 3 questions → "Get my plan".
- **Plan:** big numbers (litres/year, tankers), "Mandatory" chip, structure card, money breakdown, payback; buttons: Ask Boond, Apply, Register installation.
- **Chat:** messages, language toggle EN/हिं.
- **Maintenance:** upload photo → verdict card → badge.
- **Dashboard:** ward selector, counts by status, total litres, small map of plans.
- Mobile-first, large touch targets, works on a 360 px wide screen. All UI text in `i18n.ts` (en + hi).

## 14. Non-goals (do NOT build)

User accounts/Cognito (use planId links for demo), payments, real Jal Board submission, IoT sensors, native mobile app, automatic ML roof segmentation (stretch only, see M7).

## 15. Milestones (build in this order)

**M1 – Calculator core (Day 1 AM).** `calculator/` + config + unit tests. `POST /plans` works locally (`sam local start-api`). ✅ Tests pass.
**M2 – Map + plan UI (Day 1 PM).** Address search, polygon drawing, area, questions, Plan page wired to API. ✅ Full flow works locally.
**M3 – Deploy (Day 2 AM).** `sam deploy`, frontend on Amplify, env vars set. ✅ Public URL works on a phone.
**M4 – Agent (Day 2 PM).** Chat endpoint with Strands + tools, Hindi works. Application PDF. ✅ "What if I only have a small backyard?" gets a correct recalculated answer.
**M5 – Maintenance check (Day 3 AM).** Presigned upload, vision verdict, badge, status update. ✅ Clean photo → Verified; clogged photo → Needs cleaning.
**M6 – Reminders + dashboard + seed data (Day 3 PM).** ✅ Dashboard shows 4 wards with seeded data.
**M7 – Stretch only if M1–M6 are solid:** auto roof outline (click → segmentation model) replacing manual drawing.
**M8 – Polish + README + architecture diagram + demo video (Day 4).**

## 16. README must include

Problem + evidence, screenshots, architecture diagram (AWS services), how to run locally, how to deploy, list of AWS services and the open-source tool used (Strands Agents), limitations (estimates only; rules configurable; not an official Jal Board system).

## 17. Demo video script (3:00)

- **0:00–0:30** Problem: Delhi mandate + "no tool exists" (SIH25065) + systems fail.
- **0:30–2:15** Live: address → draw roof → plan (litres, ₹, payback) → ask in Hindi → generate application → upload clogged filter photo → "Needs cleaning" → clean photo → Verified badge → dashboard.
- **2:15–2:45** AWS architecture.
- **2:45–3:00** "Delhi made it mandatory. Boond makes it happen — and keeps it working."

## 18. Coding conventions

- Python: type hints, small pure functions for all maths, `pytest`. No secrets in code; config via env vars.
- TypeScript strict mode. One API client in `lib/api.ts`.
- Every Lambda returns `{ ok: boolean, data?, error? }`.
- Log errors to CloudWatch; never expose stack traces to the UI.
- Commit after each milestone with a clear message.
