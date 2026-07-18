# Solar Dashboard

Outdoor sun & air dashboard for your location: UV, irradiance (TOA → clear sky → at your feet), cloud cover, air quality, pollen, sky path with sun & moon, and Fitzpatrick skin exposure estimates.

## Deploy on Vercel

1. Create a GitHub repo named `solardashboard-app` (or use the push script after the remote exists).
2. Double-click **PUSH-TO-GITHUB.command**.
3. Import on [vercel.com/new](https://vercel.com/new). Framework: **Other**. Root: `.`

No environment variables or build step.

## Local preview

```bash
python3 -m http.server 8890
```

Open http://localhost:8890

## Data

- **Open-Meteo** — UV, solar radiation, clouds, elevation, air quality, pollen  
- **Client astronomy** — sun path (Solar Light math), moon position/phase  
- Burn times & vitamin D are **estimates**, not medical advice

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout |
| `styles.css` | Full-bleed dashboard UI |
| `app.js` | Location, sky, cards, skin |
| `solar.js` | Sun position & clear-sky model |
| `moon.js` | Moon position & phase |
| `api.js` | Open-Meteo clients |
