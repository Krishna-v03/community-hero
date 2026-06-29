# 🦸‍♂️ Community Hero — Project Submission Documentation

## 1. Problem Statement Selected

In rapidly growing urban areas, municipal infrastructure maintenance is plagued by communication gaps, administrative bottlenecks, and inefficiencies. Public infrastructure failures—such as dangerous potholes, broken streetlights, unattended garbage heaps, and active water pipe leaks—severely impact citizen safety and urban quality of life.

The primary issues in current reporting models include:
- **Lack of Transparency & Trust**: Citizens report problems but have no way to track progress. Reports enter a "black hole," leading to civic frustration and apathy.
- **Queue Clogging & Duplicate Reports**: When a major issue occurs (e.g., a huge pothole on a busy road), dozens of citizens report the exact same issue separately. This duplicates administrative records and overwhelms triage staff.
- **Administrative Overwhelm (Manual Triage)**: Municipal offices receive thousands of daily reports. Reviewing, categorizing, prioritizing, and assigning these reports to specific field staff manually takes days, causing severe SLA (Service Level Agreement) breaches.
- **Field Officer Coordination**: Field officers lack real-time geolocation routing and verification systems to log on-site visits and closure validation efficiently.

---

## 2. Solution Overview

**Community Hero** is an AI-powered, real-time, hyperlocal Progressive Web Application (PWA) that acts as an intelligent bridge connecting **Citizens**, **Municipal Administrators**, and **Field Officers**. 

The system leverages multimodal AI to automatically parse uploaded evidence, verify reports using community proximity voting, and recommend tasks to field officers based on load and location.

- **Citizens** report issues with a photo. The platform classifies the issue, awards points (XP) and badges to gamify participation, and keeps citizens updated in real-time.
- **Municipal Admins** monitor status dashboards with automated predictive insights, weekly SLA compliance graphs, and automated assignment recommenders.
- **Field Officers** manage tasks assigned directly to them, with GPS checks to verify on-site arrival before closing tickets.

---

## 3. Key Features

### 🧠 Multimodal AI Visual Triage
When an image is uploaded, the backend AI immediately parses the image to:
1. Categorize it (e.g., pothole, streetlight, garbage, water leakage, or spam).
2. Filter spam (auto-rejects images that are not related to municipal infrastructure).
3. Score severity (Low, Medium, High, Critical) and explain the safety hazard logic.
4. Draft an automated title and descriptive summary.

### 📍 Proximity-Weighted Community Verification
- **Anti-Duplicate Check**: Before creating a report, the app checks if an issue in that category already exists within a **60-meter radius**. If it does, the user is redirected to upvote/confirm the existing issue instead of clogging the queue.
- **GPS-Based Verification**: Nearby citizens (within 500m) can upvote/confirm issues. Upvotes are weighted by the citizen's **Trust Score** (earned through previous verified reports). When the weighted threshold is met, the issue is promoted to **"Verified"** automatically.

### 🏢 Admin Command Center & Operations Dashboard
- **Operational Metrics**: Live counters of open, in-progress, resolved, and overdue tickets.
- **Interactive Visuals**: SLA performance trend lines and category distribution charts.
- **Predictive Insights**: Auto-calculates active hotspot zones, top recurring complaints, and predicts tickets at risk of breaching SLA deadlines.
- **Queue Management**: Direct assignment selection, bulk overdue assignment actions, and one-click data export to **CSV** and **PDF** for external records.

### 🛵 Field Officer GPS Check-In & Workflow
- **Assignments Feed**: A clean list of tasks assigned to the logged-in field officer.
- **On-Site Validation**: Officers must be within **200 meters** of the issue coordinates to check in. Their check-in logs their on-site arrival coordinates in the timeline.

### 🎖️ Gamified Civic Engagement
- Citizens maintain login streaks, earn experience points (XP), and unlock badges (e.g., *Local Watchdog* for verifying 3 issues, or *Daily Guardian* for 5-day active streaks) to incentivize continuous civic vigilance.

---

## 4. Technologies Used

- **Frontend UI/UX**: HTML5, Vanilla CSS3 (custom responsive layouts, modern Glassmorphism aesthetics, animated transitions), and ES6+ JavaScript.
- **Mapping & Geolocation**: **Leaflet.js** using Voyager theme layers for mapping pins and interactive coordinates.
- **Analytics & Data Vis**: **Chart.js** for rendering interactive dashboard trends and category ratios.
- **Backend Architecture**: Node.js running an Express.js server.
- **Data Exporting**: **jsPDF** and **PapaParse** (for PDF/CSV exports).
- **PWA Capabilities**: Service workers (`sw.js`) and app manifest (`manifest.json`) for offline file caching and installable application shortcuts.

---

## 5. Google Technologies Utilized

### 🤖 Google Gemini AI (via Google AI Studio)
The project utilizes the **official `@google/genai` SDK** (running the **`gemini-2.5-flash`** model) for multiple agentic workflows:
- **Visual Triage Endpoint (`/api/classify`)**: Analyzes base64 photo payloads to classify issues, assess severity, detect spam, and generate detailed logical summaries.
- **Smart Assignment Recommender (`/api/suggest-assignment`)**: Analyzes open tickets, active officer positions, and current workloads to suggest the best officer for a task.
- **Citizen Communication Updates (`/api/status-update`)**: Automatically converts dry status updates into citizen-friendly AI descriptions explaining what the action means.
- **Escalation Memos (`/api/escalate`)**: Automatically reviews overdue tickets and creates structured escalation memos for administration heads.

### ☁️ Google Cloud Run
- The Express application is containerized via a custom lightweight **Dockerfile** (running `node:20-slim`) and hosted on **Google Cloud Run** in the `europe-west1` region.
- Cloud Run handles serverless scaling (scaling down to zero instances when idle to minimize costs).

### 🚀 Google Cloud Build & Artifact Registry
- Integrated direct continuous deployment pipeline using **Cloud Build** linked to the GitHub repository (`Krishna-v03/community-hero`).
- Pushing to the `main` branch automatically triggers a Docker build, uploads the image to **Artifact Registry**, and performs a rolling deploy to Cloud Run.

### 🔥 Firebase (Firestore)
- Configured real-time data sync using **Firebase Firestore** via the client-side JavaScript SDK.
- The app maintains a sync engine that updates markers and dashboard statistics instantly as edits occur, falling back automatically to local storage if offline.
