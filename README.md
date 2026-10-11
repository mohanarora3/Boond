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

There is a second problem: systems that do get built often stop working. Filters clog and pits fill with silt, and nobody notices until the rain runs off again. So Boond doesn't stop at the plan. It follows the system through its whole life:

**plan → ask → apply → officer review → install → monsoon check → verified certificate**

---

## What Boond does

### For homeowners and RWAs

1. **Find the building.** Type an address or use your location. Boond shows the spot on satellite imagery and suggests the roof outline from real building footprints. If it's wrong, you can draw your own, and the roof area is measured from it automatically.
2. **Answer three questions.** Plot size, number of people, and whether there is open ground (a backyard, lawn or driveway). Optional extras, like your water bill and how many tankers you buy, make the money figures more accurate.
3. **Get a plan.** In a few seconds you see:
   - how many litres your roof can collect in a year, from 10 years of real rainfall at your exact location, also shown as "= N water tankers";
   - whether harvesting is **mandatory** for your plot;
   - the right **structure** (recharge pit, recharge trench or storage tank) and its exact size;
   - the **cost**, the government **subsidy**, what you pay, the yearly **rebate** and **penalty avoided**, and the **payback** time.
4. **Ask Boond.** Chat with an AI assistant in English or Hindi. Ask "What if I only have a small backyard?" and it recalculates your plan and shows what changes. It only quotes numbers from the calculator, never invented ones.
5. **Apply.** Boond fills in an application summary PDF with your system's details and a checklist of documents to bring.
6. **Officer review.** A ward officer approves the application, asks for a site visit, or rejects it with a note you can read.
7. **Install and register.** Once the system is built, take a photo of it to register it.
8. **Monsoon health check.** Before each monsoon, a reminder email arrives. You photograph the filter or pit, and AI tells you in seconds whether it is *Healthy*, *Needs cleaning* or *Broken*, with a reason and a tip on how to fix it.
9. **Boond Verified.** A healthy photo taken at the building (checked with the phone's location) earns a certificate with a QR code. Anyone who scans it sees the system's current status, but not your address or personal details.
10. **See your impact.** Boond replays the real daily rain since installation to show how many litres your system has actually caught, counting zero for days it was broken.

### For Jal Board and ward officers

- **Applications queue.** Every filed application with its PDF, site details and a map of nearby ponds, lakes and drains from OpenStreetMap. Boond suggests where the water should go (into the ground, a nearby water body, a storm drain, or a tank for reuse); the officer makes the final call.
- **Ward dashboard.** How many plans are planned, applied, installed, verified or need attention; litres harvested compared with the ward's potential; a compliance score; and the systems that have been broken the longest.
- **Ward potential map.** Every building in five Delhi wards, coloured by how much rain its roof could collect, showing which ones must harvest and which still have no plan.
- **Monsoon simulation.** Replay a real heavy-rain day (by default 31 July 2024) over the whole ward and see how much water working systems caught and how much was lost to drains or broken systems.

The whole app works in **English and Hindi** and is designed for phones first.

---

## Architecture

<p align="center">
  <img src="docs/images/boond-architecture.png" alt="Boond AWS architecture" width="100%">
</p>

Boond is **fully serverless**: there are no servers to manage, and apart from one daily reminder job, nothing runs (or costs money) when nobody is using it. The diagram has five layers, read top to bottom.

### A · People

The four kinds of users: homeowners and RWAs on their phones, Jal Board officers reviewing applications, Jal Board and MCD staff on the ward dashboard, and anyone scanning a certificate QR code. The fifth box is the email inbox where monsoon reminders arrive.

### B · Front door

- **AWS Amplify Hosting** serves the web app (React, Vite and a Leaflet map).
- **Amazon API Gateway** (HTTP API) receives every request from the app as JSON over HTTPS and passes it to the right Lambda function.
- **Photos take a shortcut** (the dashed line). The app asks for a short-lived upload link and sends the photo straight to S3, so large images never pass through Lambda.

### C · Serverless runtime

Each feature has its own **AWS Lambda** function (Python 3.12 on arm64), and each function gets only the AWS permissions it needs:

| Function | What it does |
|---|---|
| **Geocode** | Turns an address into a location with Amazon Location Service, limited to Delhi |
| **Plans** | Creates, reads and updates plans and runs the calculator; also impact and the public verify page |
| **Rules** | Serves the policy numbers (thresholds, subsidy, rebate) so the app never hard-codes them |
| **Application** | Builds the application PDF and the Boond Verified certificate |
| **Review** | The officer's applications queue, nearby water lookup and decisions |
| **Wards** | Ward building maps and the monsoon simulation |
| **Dashboard** | Ward totals, compliance score and systems needing attention |
| **Agent** | "Ask Boond" chat, built with the Strands Agents SDK |
| **Maintenance** | Photo uploads, installation and the AI health check |
| **Reminders** | Runs once a day and emails owners whose systems are due for a check |

The numbered circles in the diagram match the steps of the user journey listed at its bottom.

### D · AI and data sources

| Service | Used for |
|---|---|
| **Amazon Location Service** | Address search (with OpenStreetMap's Nominatim as a backup) |
| **Open-Meteo** | 10 years of daily rainfall for any location in Delhi |
| **OpenStreetMap** | Ponds, lakes and drains near a house, for the officer review |
| **Overture Maps** | Building footprints for the ward maps |
| **Amazon Bedrock** (Amazon Nova Lite) | The chat agent's answers, and reading the health-check photos |
| **Amazon EventBridge Scheduler** | Starts the reminder job every day |

### E · Storage, alerts and ops

| Service | Used for |
|---|---|
| **Amazon DynamoDB** | One table for plans, health checks, chat history and cached rainfall |
| **Amazon S3** | One private bucket for photos, PDFs, certificates and ward map data, only reachable through links that expire after 15 minutes |
| **Rules as config** | Policy numbers in [`delhi_rules.json`](backend/config/delhi_rules.json); engineering sizes and costs in [`structures.json`](backend/config/structures.json) |
| **Amazon CloudWatch** | Logs and errors (users only ever see a friendly message) |
| **Amazon SNS** | Sends the "Monsoon is coming — check your filter" email |

All of this is defined as code in [`backend/template.yaml`](backend/template.yaml) with AWS SAM.

### How a plan request flows

When someone taps **Get my plan**, the app sends their answers to `POST /plans`. The Plans function checks the inputs, looks up rainfall for that spot (from the cache, or from Open-Meteo the first time), runs the calculator, saves the plan in DynamoDB and returns it. The browser then opens `/plan/<id>`. There are no accounts: that link *is* the user's access to their plan.

### Design choices

- **The AI never makes up a number.** All the maths is plain Python in [`backend/src/calculator/`](backend/src/calculator/). The chat agent can only report what its tools return, its tools can only touch the user's own plan, and it asks before saving anything.
- **Rules live in config, with sources.** Every policy number sits in one JSON file alongside where it came from and when it was checked, so a rule can be corrected without touching code.
- **It degrades instead of breaking.** If rainfall data, address search, OpenStreetMap or Bedrock is down, Boond falls back to a cache, a clearly labelled default or a friendly message, and the rest of the app keeps working.
- **It runs on a laptop too.** [`backend/local_server.py`](backend/local_server.py) runs the same Lambda code locally with a file-based database, so most of the app works without an AWS account.

---

## How the plan is calculated

Every number comes from a few simple formulas, and every constant (thresholds, costs, sizes) comes from the config files.

**Water.** 1 mm of rain on 1 m² of roof is 1 litre. Not all of it can be collected, so a runoff coefficient is applied (0.8 for a concrete roof).

```
litres_per_year = roof_area_m² × average_annual_rainfall_mm × runoff_coefficient
```

**Is it mandatory?** In Delhi, harvesting is required on plots of 100 m² or more.

**Which system, and how big?** A system has to take in a heavy burst of rain at once, so it is sized for a *design storm* of 60 mm an hour for 15 minutes (15 mm of rain).

- **Open ground, roof up to 300 m²** → a **recharge pit** that lets water soak into the ground (3 m deep, 1–2 m wide).
- **Open ground, bigger roof** → a longer **recharge trench**.
- **No open ground**, or ground that isn't safe for recharge (a septic tank nearby, an area that floods, or too close to the foundation) → a **storage tank** to collect and reuse the water.

**Money.**

```
subsidy         = 50% of the cost, up to ₹50,000
you pay         = cost − subsidy
yearly benefit  = water-bill rebate (10%) + penalty avoided (50% of the bill, if mandatory) + tanker savings
payback (years) = you pay ÷ yearly benefit
```

**A real-world check.** A yearly total over-counts, because Delhi's rain comes in a few very heavy days and a pit or tank can only take so much at once. So Boond also replays the last 10 years of rain **day by day** through the recommended system and shows how much it really saves and how much overflows.

**Worked example** (the numbers on the banner): Lodhi Road, 120 m² concrete roof, 150 m² plot, 4 people, open ground, ₹900/month water bill.

| Step | Result |
|---|---|
| Average rainfall | 752.1 mm a year |
| Water a year | 120 × 752.1 × 0.8 = **72,202 litres** (about 7 tankers) |
| Mandatory? | **Yes** (150 m² ≥ 100 m²) |
| System | One recharge pit, **1 m × 1 m × 3 m** deep |
| Cost | ₹18,500 (pit + filter) |
| Subsidy | ₹9,250 |
| You pay | **₹9,250** |
| Yearly benefit | ₹1,080 rebate + ₹5,400 penalty avoided = ₹6,480 |
| Payback | **1.4 years** |

---

## The AI parts

**Ask Boond (chat).** Built with the open-source **Strands Agents SDK** on **Amazon Bedrock** (Amazon Nova Lite). The agent has six tools: read the plan, recalculate a "what if", save changes, explain a rule, generate the application, and give maintenance tips. It replies in the language you write in, keeps answers short, and asks before saving anything or creating the application.

**Photo health check.** The photo goes to Bedrock with strict instructions to return a verdict (*healthy*, *needs cleaning*, *broken* or *unclear*), a one-line reason and a confidence score. If the photo is unclear or the model isn't confident enough, Boond asks for a retake instead of guessing. A healthy verdict only counts as **verified** if the phone's location shows the photo was taken at the building in the last 15 minutes.

---

## Project structure

```
BOOND/
├── backend/
│   ├── template.yaml      every AWS resource (AWS SAM)
│   ├── config/            delhi_rules.json (policy) and structures.json (sizes, costs)
│   ├── src/               one folder per Lambda, plus calculator/ and common/
│   ├── local_server.py    runs the backend locally on port 3001
│   └── tests/             pytest tests
├── frontend/              React + Vite web app (pages, components, English/Hindi text)
├── demo/                  demo plans and ward map data builders
├── scripts/               deploy.sh (one-command deploy) and warm.sh
└── docs/                  HOW_IT_WORKS.md and images
```

---

## Run it locally

You need **Python 3.12** and **Node 20+**. AWS credentials are only needed for chat and photo checks, which call Bedrock.

```bash
# Python environment
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt -r backend/layers/deps/requirements.txt boto3 duckdb shapely

# backend → http://localhost:3001 (data is stored in backend/.local/)
cd backend
../.venv/bin/python local_server.py &
../.venv/bin/python ../demo/seed_data.py --local      # adds demo plans

# frontend → http://localhost:5173
cd ../frontend && cp .env.example .env && npm install && npm run dev
```

Then try:

- `http://localhost:5173/plan/demo-lodhi-road-planned`, then swap `planned` for `applied`, `installed`, `needs-attention` or `verified` to see each stage of one home's journey
- `http://localhost:5173/dashboard` for the officer view

To build the ward maps too, run `demo/fetch_overture.py` once, then `demo/build_footprints.py --local`.

**Tests:** `cd backend && ../.venv/bin/python -m pytest -q`

## Deploy to AWS

```bash
aws configure                              # once, with your AWS account
bash scripts/deploy.sh you@example.com     # email for monsoon reminders (optional)
```

You also need the AWS SAM CLI, `make`, `zip` and `curl`. One command does everything, and it is safe to re-run:

1. builds and deploys the backend (Lambda, API Gateway, DynamoDB, S3, SNS, EventBridge, Location);
2. uploads the ward map data and seeds the demo plans;
3. builds the frontend and publishes it on Amplify Hosting;
4. points the backend's CORS settings and email links at the new app URL;
5. calls every endpoint once so nothing is slow during a demo.

At the end it prints the app URL. Confirm the SNS subscription email so reminders arrive.

---

## Learn more

The full walkthrough (every formula, the API routes, the data model and the AI prompts) is in [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

<p align="center"><b>Boond // 2026</b> · Right pit. Right size. Still working next July.</p>
