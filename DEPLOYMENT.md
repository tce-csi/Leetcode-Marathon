# Deployment & Runbook — CodeQuest (CSI TCE LeetCode Marathon)

This runbook provides complete instructions for deploying the **CSI TCE LeetCode Marathon** to **Netlify** with a **Supabase PostgreSQL** database.

---

## 1. Architecture Overview

CodeQuest can be deployed as a **single Netlify site** using Netlify Functions:

| Component | Technology | Deployed Destination |
|---|---|---|
| **Frontend** | React 19, Vite, Tailwind CSS v4 | Netlify Static Hosting (`client/dist`) |
| **Backend** | Express 5, TypeScript | Netlify Serverless Function (`netlify/functions/api.ts`) |
| **Database** | PostgreSQL 17 / 15+ | Supabase (`db.<project-ref>.supabase.co`) |

- **Routing:** All `/api/*` requests are proxied internally by Netlify to the serverless function handler (`/.netlify/functions/api/:splat`).
- **SPA Fallback:** All frontend routes (`/dashboard`, `/admin`, `/login`, etc.) fall back to `/index.html` via `netlify.toml` and `client/dist/_redirects`, ensuring hard refreshes work seamlessly.
- **Cookies & Origin:** Because the client and API share the same Netlify domain, authentication cookies and CSRF protections operate smoothly with zero cross-origin friction.

---

## 2. Supabase Database Configuration

### 2.1 Database Connection Modes
Supabase provides two connection types in **Project Settings -> Database -> Connection string**:

1. **Direct Connection (Port 5432):**
   ```text
   postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
   ```
   *Ideal for local development or IPv6-compatible environments.*

2. **Transaction Pooler (Port 6543) — Recommended for Netlify Functions:**
   ```text
   postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require
   ```
   *Essential for serverless runtimes to prevent connection starvation.*

> **Tip on Passwords:** If your database password contains special characters (such as `@`, `#`, or `/`), URL-encode them (e.g., `@` becomes `%40`, `#` becomes `%23`).

### 2.2 Applying Migrations & Seed Data
Before the first deployment, run migrations and seeds from your local repository with your production `server/.env` configured:

```bash
# 1. Test database connection
npm run db:test

# 2. Apply all migrations (0001..0004)
npm run db:migrate

# 3. Seed contest tracks, 20 LeetCode problems, and admin account
npm run db:seed
```

---

## 3. Netlify Deployment Setup

### 3.1 Repository & Build Settings
In your Netlify Dashboard (**Add new site -> Import an existing project -> GitHub**):

- **Base directory:** *(leave blank / repository root)*
- **Build command:** `npm run build`
- **Publish directory:** `client/dist`
- **Functions directory:** `netlify/functions`

### 3.2 Required Environment Variables on Netlify
In **Site configuration -> Environment variables**, add:

| Key | Example / Description |
|---|---|
| `NODE_VERSION` | `20` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?sslmode=require` |
| `JWT_SECRET` | 32+ character random secret (generate via `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `FRONTEND_URL` | *(Optional - automatically auto-detected by Netlify's `URL` environment variable)* |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` |
| `RATE_LIMIT_MAX_REQUESTS` | `30` |

---

## 4. Administrator Provisioning

CodeQuest enforces a **single-administrator constraint** at the database level.

- Default Seed Account:
  - **Email:** `admin@codequest.local`
  - **Password:** `ChangeMe_12345`

To create or reset your private administrator credentials securely without sharing passwords:
```bash
# Set custom administrator email and password:
npm run admin:create

# Or reset password for the existing administrator:
npm run admin:reset-password
```

---

## 5. Post-Deployment Verification Checklist

Once Netlify finishes building and deploys your site, verify the live installation:

- [ ] **1. API Health Check:**
  - Visit: `https://<your-site>.netlify.app/api/health`
  - Expected response: `{"ok":true,"data":{"status":"ok"}}`

- [ ] **2. Single-Admin Login:**
  - Visit: `https://<your-site>.netlify.app/admin/login`
  - Sign in with your admin credentials. Confirm access to the dashboard.

- [ ] **3. Student Registration & Login:**
  - Visit: `https://<your-site>.netlify.app/register`
  - Register a test participant with a valid LeetCode profile URL (e.g. `https://leetcode.com/u/student_sample/`).
  - Verify immediate redirection to `/dashboard`.
  - Sign out and sign back in from `/login`.

- [ ] **4. SPA Refresh Routing:**
  - Navigate to `/dashboard` or `/admin` and press hard reload (<kbd>Ctrl</kbd> + <kbd>F5</kbd> / <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>).
  - Verify that the page reloads without a 404 error.

- [ ] **5. Contest Tracks & Problems:**
  - Confirm both First Year and Second Year tracks are enabled with 10 sequential levels each.
  - Verify questions reflect the official contest syllabus.

---

## 6. Git Push & Deployment Commands

To push this repository to your GitHub account:

```bash
# 1. Check git status to confirm no secrets are staged
git status

# 2. Stage all project files
git add .

# 3. Create initial deployment commit
git commit -m "feat: complete CodeQuest PERN platform with Netlify & Supabase integration"

# 4. Link your GitHub remote repository (replace with your repo URL)
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git

# 5. Push to GitHub
git branch -M main
git push -u origin main
```
