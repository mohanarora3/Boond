<p align="center">
  <img src="docs/images/boond-banner.png" alt="Boond — catch every drop. Right pit. Right size. Still working next July." width="100%">
</p>

<h1 align="center">Boond (बूँद)</h1>

<p align="center">
  <b>Every Delhi rooftop harvesting rainwater: a sized, costed plan in 30 seconds, and a system that is still working next July.</b>
</p>

<p align="center">
  Python 3.12 · AWS Lambda · API Gateway · DynamoDB · S3 · Amazon Bedrock (Nova Lite) · Strands Agents · Amazon Location · EventBridge · SNS · Amplify · React + Leaflet
</p>

<p align="center">
  Built for the WeMakeDevs × AWS <i>Environmental Hacks</i> (Bharat Builds Tour), track <b>Heat and Water</b>.
</p>

---

## The problem

Delhi’s groundwater is falling fast, and many areas rely on tankers in summer. Yet every monsoon, most of the rain that falls on rooftops runs into drains and adds to street flooding. Rooftop rainwater harvesting can fix much of this, and Delhi requires it for larger plots. But most people don’t know where to start: how much water their roof can collect, what system they need, or what size it should be. That uncertainty keeps many from acting.

Boond is mainly for homeowners and residents’ welfare associations in Delhi who want to install rainwater harvesting but lack technical knowledge. It also helps housing societies, schools, and small businesses with large roofs, and owners who need a harvesting system to meet building rules. Boond gives them a clear, personalised plan in minutes, so they can talk to a contractor with confidence and turn their roof into a water source.

## What Boond does

**plan → ask → apply → officer review → install → monsoon check → verified certificate**

**For homeowners**

1. **Find the building.** Search an address, see it on satellite imagery, and confirm the roof outline (suggested from real building footprints, or drawn by hand).
2. **Get a plan.** Litres a year from 10 years of real rainfall, whether harvesting is mandatory, the right structure (recharge pit, trench or tank) and its exact size, cost, subsidy, rebate and payback.
3. **Ask Boond.** An AI agent answers in English or Hindi and recalculates "what if" questions from *your* plan. Every number comes from a tool, never from the model.
4. **Apply.** A filled application PDF with a document checklist.
5. **Install and check.** Register the system with a photo. Before each monsoon, a reminder email arrives; a photo of the filter or pit gets an AI verdict: *Healthy / Needs cleaning / Broken*.
6. **Boond Verified.** A healthy check taken at the building earns a certificate with a QR code anyone can scan.

**For Jal Board and ward officers**

- An **applications queue** with nearby ponds and drains from OpenStreetMap, to decide where the water should go.
- A **ward dashboard**: plans by status, litres harvested, compliance score, and systems needing attention.
- A **ward map** of every building's harvesting potential, and a **monsoon simulation** that replays a real heavy-rain day over the ward.

---

## Architecture

<p align="center">
  <img src="docs/images/boond-architecture.png" alt="Boond AWS architecture" width="100%">
</p>

Boond is fully serverless. The diagram reads top to bottom:

- **A · People.** Homeowners, Jal Board officers, the ward dashboard, anyone scanning a certificate QR, and the reminder email inbox.
- **B · Front door.** **AWS Amplify Hosting** serves the React app. **Amazon API Gateway** (HTTP API) routes JSON requests to Lambda. Photos skip the API and go straight from the browser to S3 with a presigned URL (the dashed line).
- **C · Runtime.** One **AWS Lambda** function (Python 3.12, arm64) per feature: Geocode, Plans, Rules, Application, Review, Wards, Dashboard, Agent, Maintenance, Reminders. Each one gets only the IAM permissions it needs.
- **D · AI and data.** **Amazon Location** for address search, **Open-Meteo** for 10 years of rainfall, **OpenStreetMap** for nearby water, **Overture Maps** for building footprints, **Amazon Bedrock** (Nova Lite) for the chat agent and photo checks, and **EventBridge Scheduler** for the daily reminder job.
- **E · Storage and alerts.** One **DynamoDB** table, one private **S3** bucket (photos, PDFs, certificates), policy rules kept as JSON config, **CloudWatch** logs and **SNS** email reminders.

All infrastructure is defined in [`backend/template.yaml`](backend/template.yaml) (AWS SAM).

**Design choices**

- **The AI never makes up a number.** All maths is in plain Python functions in [`backend/src/calculator/`](backend/src/calculator/). The agent can only report what its tools return, and its tools only touch the user's own plan.
- **Rules live in config.** Every policy number is in [`delhi_rules.json`](backend/config/delhi_rules.json) with its sources; every cost and size in [`structures.json`](backend/config/structures.json). A rule can change without a code change.
- **It degrades instead of breaking.** If rainfall, geocoding, OpenStreetMap or Bedrock is unavailable, Boond falls back to a cache, a labelled default or a clear message, and the rest of the app keeps working.

---

## How the plan is calculated

```
litres_per_year = roof_area_m² × annual_rainfall_mm × runoff_coefficient   (1 mm on 1 m² = 1 litre)
mandatory       = plot_area_m² ≥ 100
structure       = open ground ? (roof ≤ 300 m² ? recharge pit : recharge trench) : storage tank
                  sized for a 15 mm design storm (60 mm/h for 15 min)
subsidy         = min(₹50,000, 50% of install cost)
payback_years   = (install cost − subsidy) ÷ (water-bill rebate + penalty avoided + tanker savings)
```

**Worked example** (the numbers on the banner): Lodhi Road, 120 m² roof, 150 m² plot, 4 people, open ground, ₹900/month water bill.

| Rainfall | Water a year | Mandatory | System | Cost after subsidy | Payback |
|---|---|---|---|---|---|
| 752.1 mm | **72,202 L** (7.2 tankers) | Yes | 1 × 1 × 3 m recharge pit | ₹9,250 | **1.4 years** |

---

## Run it locally

You need **Python 3.12** and **Node 20+**. AWS credentials are only needed for chat and photo checks.

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt -r backend/layers/deps/requirements.txt boto3 duckdb shapely

# backend → http://localhost:3001
cd backend
../.venv/bin/python local_server.py &
../.venv/bin/python ../demo/seed_data.py --local

# frontend → http://localhost:5173
cd ../frontend && cp .env.example .env && npm install && npm run dev
```

Open `http://localhost:5173/plan/demo-lodhi-road-verified` for a finished demo plan, or `/dashboard` for the officer view.

Tests: `cd backend && ../.venv/bin/python -m pytest -q`

## Deploy to AWS

```bash
aws configure
bash scripts/deploy.sh you@example.com    # email for monsoon reminders (optional)
```

One command builds and deploys the backend, uploads ward data, seeds demo plans, publishes the frontend on Amplify and prints the app URL. It is safe to re-run.

---

## Learn more

The full walkthrough (every formula, the API routes, the data model and the AI prompts) is in [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

> All figures are estimates. Boond is not an official Delhi Jal Board system; confirm subsidy, rebate and rules with Delhi Jal Board.

<p align="center"><b>Boond // 2026</b> · Right pit. Right size. Still working next July.</p>
