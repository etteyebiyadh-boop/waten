# WATEN — Streetwear Store

## Deploy live (free)

### Option 1: Render (recommended)

1. Push this folder to **GitHub** (create a repo, then `git init`, `git add .`, `git commit`, `git push`).
2. Go to [render.com](https://render.com) → Sign up (free).
3. **New** → **Web Service** → Connect your GitHub repo.
4. Render auto-detects Node.js. Click **Create Web Service**.
5. Your site goes live at `https://your-app-name.onrender.com`.
6. **Important:** Change the admin password in `config.json` before pushing.
7. **Note:** On Render's free tier, product edits may reset when the service restarts. For persistent storage, consider adding a database later.

**To update the live site:** push to GitHub and Render will redeploy automatically.
```bash
git add .
git commit -m "Update store"
git push
```

### Option 2: Railway

1. Push to GitHub.
2. Go to [railway.app](https://railway.app) → Sign up.
3. **New Project** → **Deploy from GitHub** → Select your repo.
4. Railway auto-detects and deploys. You get a live URL.

---

## Quick start (local)

1. **Install dependencies**
   ```
   npm install
   ```

2. **Start the server**
   ```
   npm start
   ```

3. **Open in browser**
   - **Site:** http://localhost:3000/idex.html
   - **Dashboard:** http://localhost:3000/admin.html
   - **Password:** `waten2026` (change in `config.json`)

## Dashboard

Use the dashboard to:
- Add new products (name, price, image URL)
- Edit existing products
- Delete products

Changes appear on the site immediately.

## Change password

Edit `config.json` and set your own `adminPassword`.
