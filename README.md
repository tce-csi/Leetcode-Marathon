# CodeQuest — CSI TCE LeetCode Marathon

A level-based competitive coding contest platform organized by the **Computer Society of India (CSI), Student Chapter, Thiagarajar College of Engineering (TCE)**.

Built on the **PERN stack** (PostgreSQL / Supabase + Express.js + React 19 + Node.js), CodeQuest features a minimalist black-and-white theme, official 10-level challenge progression tracks for First-Year and Second-Year participants, conceptual assessment questions, submission verification, live leaderboards, and an administrative console.

---

## 🏆 Event Structure & Tracks

CodeQuest hosts two distinct competition tracks running concurrently:

- **First-Year Track:** 10 curated LeetCode challenges focusing on core algorithmic problem solving:
  1. *Two Sum*
  2. *Reverse Integer*
  3. *Roman to Integer*
  4. *Add Binary*
  5. *Remove Element*
  6. *Merge Sorted Array*
  7. *Pascal's Triangle*
  8. *Valid Palindrome*
  9. *Sum of Squares of Special Elements*
  10. *Climbing Stairs*
- **Second-Year Track:** 10 advanced LeetCode challenges emphasizing data structures and algorithmic complexity:
  1. *Two Sum*
  2. *Valid Parentheses*
  3. *Integer to Roman*
  4. *Longest Substring Without Repeating Characters*
  5. *First Missing Positive*
  6. *Merge Sorted Array*
  7. *Pascal's Triangle*
  8. *Reverse Bits*
  9. *Sum of Squares of Special Elements*
  10. *Climbing Stairs*

### Key Features
- **Student Registration & Auth:** Collects student details, department, year, and verified LeetCode profile URL (`https://leetcode.com/u/<username>`).
- **Sequential Level Progression:** Levels unlock progressively upon completing coding submissions and conceptual assessments.
- **Conceptual Assessments:** MCQ and short-answer questions per level with deterministic variant selection to prevent cheating.
- **Admin Verification Console:** Single-administrator secured console for reviewing submission evidence, managing levels, tracking audit logs, and monitoring anti-cheat flags.
- **Separate Leaderboards:** Live scoreboards partitioned by academic year.
- **Theme:** Clean, modern monochrome / dark-mode interface with CSI TCE branding.

---

## 📁 Repository Layout

This repository is organized as an **npm workspaces monorepo**:

```text
Coding-Event-CSI/
├── client/                     # React 19 + Vite SPA (workspace: codequest-client)
│   ├── public/_redirects       # Netlify SPA routing fallback
│   ├── src/                    # Frontend UI (pages, components, theme)
│   └── vite.config.ts          # Vite configuration with /api proxy
├── server/                     # Express 5 + TypeScript API (workspace: codequest-server)
│   ├── migrations/             # Idempotent PostgreSQL DDL migrations (0001..0004)
│   ├── scripts/                # Migration, seed, and admin CLI tools
│   ├── src/                    # API routes, services, middleware, database layer
│   └── tests/                  # Automated integration test suite (PGlite + Supertest)
├── netlify/                    # Netlify serverless function adapters
│   └── functions/api.ts        # Serverless HTTP wrapper for Express API
├── netlify.toml                # Netlify build & rewrite configuration
├── package.json                # Root monorepo scripts & workspaces
├── run.bat / run.ps1           # One-click Windows local development runner
└── run.js                      # Cross-platform concurrent dev runner
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** `>= 20.9.0`
- **PostgreSQL 15+** or a **Supabase project** (e.g., project `lpdxqrmvbenitcgafhpj`)

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Copy the template files:
```bash
# Windows PowerShell
Copy-Item server\.env.example server\.env
Copy-Item client\.env.example client\.env

# Linux / macOS
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Edit `server/.env` with your real database credentials:
```env
PORT=5050
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
JWT_SECRET=your-random-32-character-secret
```

### 4. Database Setup
Run migrations and seed the official question sets:
```bash
npm run db:migrate    # Apply pending SQL migrations
npm run db:seed       # Seed contest tracks, 20 questions, and default admin
```

### 5. Launch Application
Launch both client and server concurrently using the one-click runner:
```bash
# Windows
.\run.bat

# Or cross-platform npm script:
npm run dev
```

- **Client SPA:** [http://localhost:5173](http://localhost:5173)
- **API Server:** [http://localhost:5050](http://localhost:5050)
- **Admin Console:** [http://localhost:5173/admin/login](http://localhost:5173/admin/login)
  - Default Admin: `admin@codequest.local` / `ChangeMe_12345`

---

## 🔒 Administrator Management

CodeQuest enforces a **single-administrator security constraint** at the database level (`migrations/0004_single_admin_constraint.sql`).

To provision or reset admin credentials safely in your terminal:
```bash
# Create or replace admin account:
npm run admin:create

# Reset password for the existing admin account:
npm run admin:reset-password
```

---

## ☁️ Production Deployment (Netlify + Supabase)

The project is pre-configured for a **single-site Netlify deployment** where the React frontend is served as static files and the Express API runs as a Netlify Function.

See [DEPLOYMENT.md](file:///c:/Users/karth/Desktop/Coding-Event-CSI/DEPLOYMENT.md) for complete step-by-step instructions.

### Netlify Configuration Summary
- **Build Command:** `npm run build`
- **Publish Directory:** `client/dist`
- **Functions Directory:** `netlify/functions`
- **Node Version:** `20`
- **Environment Variables on Netlify:**
  - `DATABASE_URL`: Supabase Transaction Pooler URL (port `6543`, `?sslmode=require`)
  - `JWT_SECRET`: Random 32+ character cryptographic secret
  - `NODE_ENV`: `production`

---

## 🧪 Verification & Quality Control

To run the complete test suite, linter, typecheck, and production builds:
```bash
npm run verify
```
The automated test suite runs 161 tests covering:
- Database schema and migrations
- First-Year and Second-Year tracks & ordering
- Question variant determinism & anti-tampering
- Student registration, authentication, & session lifecycle
- Submissions, progression, & scoring
- Netlify Functions adapter & request normalization

---

## 📜 License & Ownership
Computer Society of India (CSI), Student Chapter, Thiagarajar College of Engineering (TCE), Madurai.
Internal use for campus competitive programming events.
