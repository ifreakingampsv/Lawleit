# Deploy the Demo Version to Vercel (owner runbook, ~3 minutes)

The Demo Version is a static build — Vercel's free tier hosts it. No CLI needed;
Vercel imports directly from the GitHub repo.

## Steps

1. Sign up / log in at **vercel.com** (GitHub login works).
2. **Add New… → Project** → Import `ifreakingampsv/Lawleit` (grant Vercel access to
   the private repo when asked).
3. Configure the project:
   - **Framework Preset:** Vite
   - **Root Directory:** `app` (important — the app lives in the `app/` folder)
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)
   - No environment variables needed for the demo (it runs on the mock adapter).
4. **Deploy.** Vercel builds and gives you a URL like `lawleit-demo.vercel.app`.
5. Every future `git push` to `main` redeploys it automatically.

## Verify the deployment

- Open the URL → the marketing site loads.
- Click **"Explore demo"** in the hero → you land inside the Demo Firm
  (Kaul & Bhatnagar Associates) with **no login form**.
- Edit something (e.g. complete a task), then use the avatar menu → **Reset demo
  data** → the pristine Demo Firm returns.
- Refresh on a deep link (e.g. `/app/cases`) → no 404 (the build writes all 26
  route entrypoints).

## Production Version note

The production frontend deploys the same way (second Vercel project, same settings)
plus one environment variable — `VITE_API_MODE=http` and `VITE_API_BASE_URL` pointing
at the Fly.io API — configured in ticket 19. Don't set them on the demo project.
