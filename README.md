# AIVORA API Server

Handles media generation requests from the Chrome Extension and orchestrates the Content Waterfall distribution across Hub-and-Spoke accounts.

## Features

- Receive generation requests from Chrome Extension
- Interface with AI APIs (Gemini, Seedream, WAN Animate, Kling, etc.)
- Store results in Supabase
- Trigger n8n workflows for Content Waterfall scheduling

---

## Quick Start (Local Development)

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env

# Start development server
npm run dev
```

Server runs on `http://localhost:3000`

---

## Deployment on Coolify (Hetzner VPS)

### Step 1: Push to GitHub

```bash
# Initialize git repo (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: AIVORA API Server"

# Create repo on GitHub first, then:
git remote add origin https://github.com/YOUR_USERNAME/aivora-api-server.git
git branch -M main
git push -u origin main
```

### Step 2: Create Supabase Tables

1. Go to your Supabase project → SQL Editor
2. Copy contents of `supabase-schema.sql`
3. Run the SQL to create all tables

### Step 3: Deploy in Coolify

1. **Open Coolify Dashboard** → `https://your-coolify-domain.com`

2. **Create New Project:**
   - Click "New Project"
   - Name: `AIVORA`
   - Click "Create"

3. **Create New Service:**
   - In the AIVORA project, click "New Service"
   - Select **"Git"** (public or private based on your repo)

4. **Configure Service:**
   ```
   Repository: https://github.com/YOUR_USERNAME/aivora-api-server.git
   Branch: main
   ```

5. **Configure Environment Variables:**
   Click "Environment Variables" and add:

   | Variable | Value |
   |----------|-------|
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |
   | `SUPABASE_URL` | `https://your-project.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | Your service role key |
   | `GOOGLE_API_KEY` | Your Gemini API key |
   | `FAL_API_KEY` | Your FAL.ai key |
   | `WAVESPEED_API_KEY` | Your Wavespeed key |
   | `N8N_WEBHOOK_URL` | `http://n8n:5678/webhook/aivora` (localhost) |

6. **Configure Domain:**
   - Click "Domains"
   - Add: `api.yourdomain.com`
   - Coolify will auto-generate SSL certificate

7. **Deploy:**
   - Click "Deploy"
   - Wait for build to complete (~2-3 minutes)

### Step 4: Test Deployment

```bash
# Test health endpoint
curl https://api.yourdomain.com/api/health

# Should return:
# {"status":"healthy","timestamp":"...","uptime":...}
```

---

## API Endpoints

### Health Check
```http
GET /api/health
```

### Generate (Chrome Extension)
```http
POST /api/generate
Content-Type: application/json

{
  "mode": "image",
  "platform": "pinterest",
  "sourceUrl": "https://i.pinimg.com/originals/...",
  "shotType": "half-body",
  "settings": {
    "enableNSFW": false,
    "style": "natural"
  }
}
```

### Check Job Status
```http
GET /api/generate/status/:jobId
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | No | `production` or `development` |
| `PORT` | No | Port to listen on (default: 3000) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS) |
| `GOOGLE_API_KEY` | Yes | For Gemini image generation |
| `FAL_API_KEY` | Yes | For FAL.ai models (WAN, Kling, etc.) |
| `WAVESPEED_API_KEY` | Yes | For Seedream models |
| `N8N_WEBHOOK_URL` | No | Webhook to trigger after generation |
| `APIFY_API_TOKEN` | No | For TikTok video fetching |

---

## Updating Chrome Extension

Once deployed, update the webhook URL in your Chrome Extension:

### chrome-extension/popup.js or background.js

```javascript
// Replace with your Coolify domain
const WEBHOOK_URL = 'https://api.yourdomain.com/api/generate';

// When sending to API
fetch(WEBHOOK_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
```

---

## Monitoring

### View Logs in Coolify
1. Go to your service in Coolify
2. Click "Logs" tab
3. Real-time logs from your API server

### Health Check
```bash
curl https://api.yourdomain.com/api/health/detailed
```

Returns status of all dependencies (Supabase, etc.)

---

## Troubleshooting

### "Cannot connect to Supabase"
- Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct
- Verify service role key (not anon key)

### "Generation failed"
- Check API keys are valid
- View logs in Coolify for detailed error

### Service not starting
- Check health check is passing: `/api/health`
- View logs in Coolify

---

## Architecture

```
Chrome Extension → API Server → AI APIs (Gemini, Seedream, etc.)
                                      ↓
                                Supabase Storage
                                      ↓
                              n8n (Content Waterfall)
```
