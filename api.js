/**
 * Open-Meteo clients: forecast radiation/UV/clouds, air quality, elevation.
 */
const Api = (() => {
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function elevation(lat, lon) {
    const data = await fetchJson(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`
    );
    const m = data.elevation?.[0];
    return Number.isFinite(m) ? m : null;
  }

  /**
   * Hourly weather + solar for ~48h so time-slider scrubbing works.
   */
  async function forecast(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone: "auto",
      forecast_days: "2",
      current:
        "cloud_cover,is_day",
      hourly: [
        "uv_index",
        "uv_index_clear_sky",
        "cloud_cover",
        "shortwave_radiation",
        "direct_radiation",
        "diffuse_radiation",
        "terrestrial_radiation",
        "direct_normal_irradiance",
      ].join(","),
    });
    return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  }

  async function airQuality(lat, lon) {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      timezone: "auto",
      forecast_days: "2",
      current: "us_aqi,european_aqi",
      hourly: [
        "us_aqi",
        "european_aqi",
        "pm2_5",
        "alder_pollen",
        "birch_pollen",
        "grass_pollen",
        "mugwort_pollen",
        "olive_pollen",
        "ragweed_pollen",
      ].join(","),
    });
    return fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`);
  }

  /** Nearest hour index for a Date in Open-Meteo hourly.time ISO list. */
  function nearestHourIndex(times, date) {
    if (!times?.length) return -1;
    const t = date.getTime();
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(new Date(times[i]).getTime() - t);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  }

  function hourlyAt(series, times, date) {
    const i = nearestHourIndex(times, date);
    if (i < 0) return null;
    const out = { index: i, time: times[i] };
    for (const [key, arr] of Object.entries(series)) {
      if (Array.isArray(arr)) out[key] = arr[i];
    }
    return out;
  }

  function aqiLabel(aqi) {
    if (aqi == null || !Number.isFinite(aqi)) return "—";
    if (aqi <= 50) return "Good";
    if (aqi <= 100) return "Moderate";
    if (aqi <= 150) return "Sensitive";
    if (aqi <= 200) return "Unhealthy";
    if (aqi <= 300) return "Very unhealthy";
    return "Hazardous";
  }

  function aqiClass(aqi) {
    if (aqi == null || !Number.isFinite(aqi)) return "";
    if (aqi <= 50) return "ok";
    if (aqi <= 100) return "amber";
    return "hot";
  }

  function pollenSummary(row) {
    if (!row) return { level: "—", detail: "—" };
    const kinds = [
      ["trees", Math.max(row.alder_pollen || 0, row.birch_pollen || 0, row.olive_pollen || 0)],
      ["grass", row.grass_pollen || 0],
      ["weeds", Math.max(row.mugwort_pollen || 0, row.ragweed_pollen || 0)],
    ];
    const max = Math.max(...kinds.map((k) => k[1]));
    if (!Number.isFinite(max) || max <= 0) return { level: "Low", detail: "quiet" };
    let level = "Low";
    if (max >= 50) level = "High";
    else if (max >= 20) level = "Mod";
    else if (max >= 5) level = "Low+";
    const top = kinds.sort((a, b) => b[1] - a[1])[0];
    return { level, detail: top[1] > 0 ? top[0] : "quiet" };
  }

  function uvLabel(uv) {
    if (uv == null || uv < 0.5) return "None";
    if (uv < 3) return "Low";
    if (uv < 6) return "Moderate";
    if (uv < 8) return "High";
    if (uv < 11) return "Very high";
    return "Extreme";
  }

  return {
    elevation,
    forecast,
    airQuality,
    hourlyAt,
    aqiLabel,
    aqiClass,
    pollenSummary,
    uvLabel,
  };
})();
