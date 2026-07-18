(() => {
  const SUN_RADIUS = 14;
  const GLOW_RADIUS = 36;
  const GROUND_LINE = 0.5;
  const LABEL_PAD = 16;
  const CIRCLE_LABEL_FONT = "10px DM Sans, sans-serif";
  const TICK_MS = 1000;
  const SKIN_KEY = "solardashboard-skin";

  /** Minutes to burn at UV index 1 (approx public-health style tables). */
  const BURN_AT_UV1 = [67, 100, 200, 300, 400, 500];
  const SKIN = [
    { n: "I", h: "always burns" },
    { n: "II", h: "usually burns" },
    { n: "III", h: "sometimes burns" },
    { n: "IV", h: "rarely burns" },
    { n: "V", h: "very rarely burns" },
    { n: "VI", h: "never burns" },
  ];

  const canvas = document.getElementById("sky-canvas");
  const ctx = canvas.getContext("2d");
  const slider = document.getElementById("time-slider");
  const sliderTrack = document.getElementById("slider-track");
  const skinSlider = document.getElementById("skin-slider");
  const timeEl = document.getElementById("current-time");
  const nowBtn = document.getElementById("now-btn");
  const locationText = document.getElementById("location-text");
  const locateBtn = document.getElementById("locate-btn");
  const manualBtn = document.getElementById("manual-location-btn");
  const dialog = document.getElementById("location-dialog");
  const locationForm = document.getElementById("location-form");
  const latInput = document.getElementById("lat-input");
  const lonInput = document.getElementById("lon-input");
  const mapCoordsEl = document.getElementById("map-coords");
  const cancelLocation = document.getElementById("cancel-location");

  let lat = null;
  let lon = null;
  let terrainAltitudeM = 0;
  let dayEvents = null;
  let followNow = true;
  let trackedDay = null;
  let forecast = null;
  let airQ = null;
  let stars = null;
  let starsKey = "";
  let locationMap = null;
  let locationMarker = null;
  let pickLat = 35.5951;
  let pickLon = -82.5515;
  let midnightTimer = null;

  try {
    const saved = Number(localStorage.getItem(SKIN_KEY));
    if (saved >= 1 && saved <= 6) skinSlider.value = String(saved);
  } catch (_) {}

  function $(id) {
    return document.getElementById(id);
  }

  function lerpColor(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }
  function rgb(c) {
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function formatAltitude(meters) {
    return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
  }

  function setTerrainAltitude(meters) {
    terrainAltitudeM = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  }

  function getSolarTime() {
    const now = new Date();
    if (!dayEvents) return now;
    if (followNow) return now;
    return Solar.sliderToTime(Number(slider.value), now);
  }

  function syncSliderToNow() {
    slider.value = Solar.sliderForNow(new Date());
  }

  function updateSliderMarkers() {
    if (!dayEvents) return;
    const rise = (Solar.timeToSlider(dayEvents.sunrise) / 1000) * 100;
    const noon = (Solar.timeToSlider(dayEvents.solarNoon) / 1000) * 100;
    const set = (Solar.timeToSlider(dayEvents.sunset) / 1000) * 100;
    for (const el of [sliderTrack, slider]) {
      el.style.setProperty("--sunrise-pos", `${rise}%`);
      el.style.setProperty("--noon-pos", `${noon}%`);
      el.style.setProperty("--sunset-pos", `${set}%`);
    }
    $("sunrise-label").textContent = `Sunrise ${Solar.formatTime(dayEvents.sunrise)}`;
    $("noon-label").textContent = `Solar Noon ${Solar.formatTime(dayEvents.solarNoon)}`;
    $("sunset-label").textContent = `Sunset ${Solar.formatTime(dayEvents.sunset)}`;
    $("day-length").textContent = `Day length ${Solar.formatDuration(
      dayEvents.sunset - dayEvents.sunrise
    )}`;
  }

  function scheduleMidnightRefresh() {
    clearTimeout(midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(() => {
      refreshDay();
      scheduleMidnightRefresh();
    }, next.getTime() - now.getTime() + 100);
  }

  function ensureCurrentDay() {
    const stamp = Solar.dayStamp(new Date());
    if (trackedDay === stamp) return false;
    refreshDay();
    return true;
  }

  async function loadWeather() {
    if (lat == null || lon == null) return;
    try {
      const [fc, aq] = await Promise.all([
        Api.forecast(lat, lon),
        Api.airQuality(lat, lon).catch(() => null),
      ]);
      forecast = fc;
      airQ = aq;
    } catch (err) {
      console.warn("weather fetch failed", err);
    }
    update();
  }

  async function updateAltitude(latitude, longitude, gpsAltitude) {
    if (Number.isFinite(gpsAltitude)) {
      setTerrainAltitude(gpsAltitude);
      return;
    }
    try {
      const m = await Api.elevation(latitude, longitude);
      if (m != null) setTerrainAltitude(m);
      else setTerrainAltitude(0);
    } catch {
      setTerrainAltitude(0);
    }
  }

  function setLocation(newLat, newLon, label, gpsAltitude = null) {
    lat = newLat;
    lon = newLon;
    locationText.textContent = label;
    latInput.value = newLat.toFixed(4);
    lonInput.value = newLon.toFixed(4);
    updateAltitude(newLat, newLon, gpsAltitude).then(() => {
      refreshDay();
      loadWeather();
    });
  }

  function refreshDay() {
    if (lat == null || lon == null) return;
    const now = new Date();
    dayEvents = Solar.getDayEvents(lat, lon, now);
    trackedDay = Solar.dayStamp(now);
    updateSliderMarkers();
    if (followNow) syncSliderToNow();
    scheduleMidnightRefresh();
    update();
  }

  function nightBlend(elevation) {
    if (elevation >= 0) return { night: 0, twilight: 0 };
    const depth = -elevation;
    const night = Math.min(1, Math.max(0, (depth - 2) / 16));
    const twilight =
      depth < 14 ? Math.exp(-0.5 * Math.pow((depth - 4) / 4.5, 2)) : 0;
    return { night, twilight };
  }

  function skyColors(elevation, pct) {
    const dayT = Math.max(0, Math.min(1, elevation / 70));
    const warmth = pct / 100;
    const { night, twilight } = nightBlend(elevation);
    const day = {
      top: lerpColor([15, 20, 40], [55, 130, 210], dayT),
      mid: lerpColor([35, 45, 75], [120, 185, 240], dayT),
      horizon: lerpColor(
        [180, 90, 50],
        [255, 220, 160],
        Math.max(dayT, warmth * 0.6)
      ),
    };
    const nightSky = { top: [3, 5, 14], mid: [6, 10, 24], horizon: [10, 14, 32] };
    return {
      top: lerpColor(day.top, nightSky.top, night),
      mid: lerpColor(day.mid, nightSky.mid, night),
      horizon: lerpColor(
        lerpColor(day.horizon, nightSky.horizon, night),
        [140, 75, 48],
        twilight * (1 - night * 0.5)
      ),
      night,
      twilight,
    };
  }

  function buildStars(w, skyH) {
    let seed = 42;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    stars = [];
    const count = Math.floor((w * skyH) / 900);
    for (let i = 0; i < count; i++) {
      const bright = rng() > 0.92;
      stars.push({
        x: rng() * w,
        y: rng() * skyH * 0.96,
        r: bright ? rng() * 0.9 + 1.1 : rng() * 0.8 + 0.25,
        a: bright ? rng() * 0.35 + 0.65 : rng() * 0.35 + 0.2,
      });
    }
    starsKey = `${w}|${skyH}`;
  }

  function drawStars(w, groundY, night) {
    if (night < 0.03) return;
    if (starsKey !== `${w}|${groundY}`) buildStars(w, groundY);
    const fade = Math.pow(night, 1.15);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, groundY);
    ctx.clip();
    for (const star of stars) {
      ctx.globalAlpha = star.a * fade;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function maxCircleRadius(w, h, groundY) {
    return Math.max(
      40,
      Math.min(w * 0.48, groundY - LABEL_PAD, h - groundY - LABEL_PAD)
    );
  }

  function sunOnCircle(solarTime, groundY, arcR, arcCx) {
    const angle = Solar.cycleAngleForEvents(solarTime, dayEvents);
    return {
      x: arcCx + Math.cos(angle) * arcR,
      y: groundY - Math.sin(angle) * arcR,
    };
  }

  function moonOnCircle(moonElev, moonAz, groundY, arcR, arcCx) {
    // Map alt/az onto same display circle as sun path (visual, not true sky dome)
    const elevRad = (Math.max(-90, Math.min(90, moonElev)) * Math.PI) / 180;
    // Compass az 0N 90E 180S 270W → put E left-ish for solar-light style
    // Use hour-angle style: project with elevation height
    const azN = ((moonAz % 360) + 360) % 360;
    // Convert: solar light uses E=π (left) to W=0 (right) on upper half
    // Approximate moon angle from azimuth: 90°→π, 180°→π/2, 270°→0
    let angle = Math.PI - ((azN - 90) / 180) * Math.PI;
    if (moonElev < 0) {
      angle = -((azN - 90) / 180) * Math.PI;
    }
    const r = arcR * 0.94;
    // Prefer elevation-based height on circle
    const y = groundY - Math.sin(elevRad) * r;
    const xFrac = Math.max(-0.05, Math.min(1.05, (azN - 90) / 180));
    const x = arcCx - r + xFrac * 2 * r;
    return { x, y, below: moonElev < 0 };
  }

  function drawSun(sunX, sunY, groundY, w, belowHorizon, straddlesHorizon, night) {
    const alpha = belowHorizon ? 0.15 + 0.3 * (1 - night) : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!belowHorizon && !straddlesHorizon) {
      ctx.beginPath();
      ctx.rect(0, 0, w, groundY);
      ctx.clip();
    }
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, GLOW_RADIUS * 2);
    glow.addColorStop(0, "rgba(255, 230, 150, 0.35)");
    glow.addColorStop(0.4, "rgba(255, 180, 60, 0.12)");
    glow.addColorStop(1, "rgba(255, 150, 40, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, GLOW_RADIUS * 2, 0, Math.PI * 2);
    ctx.fill();
    const sunGrad = ctx.createRadialGradient(sunX - 4, sunY - 4, 2, sunX, sunY, SUN_RADIUS);
    sunGrad.addColorStop(0, "#fffbe8");
    sunGrad.addColorStop(0.6, "#ffd54a");
    sunGrad.addColorStop(1, "#f5a623");
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, SUN_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMoon(x, y, groundY, w, below, night, phase) {
    const r = 9;
    ctx.save();
    if (!below) {
      ctx.beginPath();
      ctx.rect(0, 0, w, groundY);
      ctx.clip();
    }
    ctx.globalAlpha = below ? 0.16 : 0.5 + 0.5 * night;
    if (!below && night > 0.15) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      glow.addColorStop(0, "rgba(200, 210, 230, 0.22)");
      glow.addColorStop(1, "rgba(200, 210, 230, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#d8dee8";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
    ctx.clip();
    const p = Math.max(0.05, Math.min(0.95, phase));
    const shadowX = x + (p - 0.5) * 2 * r * 1.15;
    ctx.fillStyle = "#0c1018";
    ctx.beginPath();
    ctx.arc(shadowX, y, r * 0.98, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSky(elevation, pct, solarTime, moonPos) {
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 2 || h < 2 || !dayEvents) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      starsKey = "";
    }

    const colors = skyColors(elevation, pct);
    const groundY = h * GROUND_LINE;
    const arcR = maxCircleRadius(w, h, groundY);
    const arcCx = w / 2;

    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, rgb(colors.top));
    skyGrad.addColorStop(0.55, rgb(colors.mid));
    skyGrad.addColorStop(1, rgb(colors.horizon));
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    if (colors.twilight > 0.05) {
      const glow = ctx.createLinearGradient(0, groundY - groundY * 0.45, 0, groundY);
      glow.addColorStop(0, "rgba(0,0,0,0)");
      glow.addColorStop(
        1,
        `rgba(180,90,50,${colors.twilight * 0.22 * (1 - colors.night * 0.6)})`
      );
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, groundY);
    }

    drawStars(w, groundY, colors.night);

    const groundBright = (pct / 100) * (1 - colors.night * 0.85);
    const groundGrad = ctx.createLinearGradient(0, groundY, 0, h);
    groundGrad.addColorStop(0, rgb(lerpColor([18, 32, 16], [78, 128, 62], groundBright)));
    groundGrad.addColorStop(1, rgb(lerpColor([10, 18, 9], [32, 52, 26], groundBright)));
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.arc(arcCx, groundY, arcR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (moonPos) {
      const m = moonOnCircle(moonPos.elevation, moonPos.azimuth, groundY, arcR, arcCx);
      drawMoon(m.x, m.y, groundY, w, m.below, colors.night, moonPos.phase);
    }

    const { x: sunX, y: sunY } = sunOnCircle(solarTime, groundY, arcR, arcCx);
    const daylight =
      solarTime.getTime() >= dayEvents.sunrise.getTime() &&
      solarTime.getTime() <= dayEvents.sunset.getTime();
    const straddles =
      sunY + SUN_RADIUS > groundY && sunY - SUN_RADIUS < groundY;
    drawSun(sunX, sunY, groundY, w, !daylight, straddles, colors.night);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = CIRCLE_LABEL_FONT;
    ctx.textAlign = "center";
    ctx.fillText("Solar Noon", arcCx, groundY - arcR - 6);
    ctx.fillText("E", arcCx - arcR - 8, groundY + 12);
    ctx.fillText("W", arcCx + arcR + 8, groundY + 12);
    ctx.fillText("Midnight", arcCx, groundY + arcR + 12);
  }

  function weatherAt(date) {
    if (!forecast?.hourly) return null;
    return Api.hourlyAt(forecast.hourly, forecast.hourly.time, date);
  }

  function airAt(date) {
    if (!airQ?.hourly) return null;
    return Api.hourlyAt(airQ.hourly, airQ.hourly.time, date);
  }

  /** UVA/UVB rough split from UV index (estimates). */
  function estimateUvaUvb(uv, elev) {
    if (uv <= 0 || elev <= 0) return { uva: 0, uvb: 0 };
    // Order-of-magnitude: UVB drives index; UVA much larger broadband
    const uvb = uv * 0.025; // W/m²-ish toy
    const uva = uv * 6.5;
    return { uva, uvb };
  }

  function update() {
    if (!dayEvents || lat == null) return;

    const solarTime = getSolarTime();
    const pos = Solar.getPosition(lat, lon, solarTime);
    const elev = pos.elevation;
    const pct = Solar.irradiancePercent(
      elev,
      dayEvents.maxElevation,
      terrainAltitudeM
    );
    const moonPos = Moon.getPosition(lat, lon, solarTime);
    const daylight =
      solarTime.getTime() >= dayEvents.sunrise.getTime() &&
      solarTime.getTime() <= dayEvents.sunset.getTime();

    const wx = weatherAt(solarTime);
    const aq = airAt(solarTime);

    const toa =
      wx?.terrestrial_radiation != null && daylight
        ? wx.terrestrial_radiation
        : daylight
          ? Solar.toaWm2(solarTime)
          : 0;
    const clear =
      daylight
        ? Solar.clearSkyGhi(elev, terrainAltitudeM, solarTime)
        : 0;
    const ground =
      wx?.shortwave_radiation != null
        ? wx.shortwave_radiation
        : clear * 0.7;
    const cloud = wx?.cloud_cover != null ? wx.cloud_cover : null;
    const uv = wx?.uv_index != null ? wx.uv_index : daylight ? (elev / Math.max(dayEvents.maxElevation, 1)) * 8 : 0;
    const uvClear = wx?.uv_index_clear_sky;
    const csf =
      uvClear > 0.2 && uv != null
        ? Math.min(1.2, uv / uvClear)
        : clear > 10
          ? Math.min(1.2, ground / clear)
          : null;

    const { uva, uvb } = estimateUvaUvb(uv, elev);
    const am = elev > 0 ? Solar.airMass(elev, terrainAltitudeM) : null;
    const altFactor = Math.exp(terrainAltitudeM / 8500);

    // Cards
    $("c-uv").textContent = daylight ? (uv != null ? Number(uv).toFixed(1) : "—") : "0";
    $("c-uv-s").textContent = Api.uvLabel(daylight ? uv : 0);
    $("c-uva").innerHTML = `${uva.toFixed(0)}<span class="u">W/m²</span>`;
    $("c-uvb").innerHTML = `${uvb.toFixed(2)}<span class="u">W/m²</span>`;
    $("c-cloud").innerHTML =
      cloud != null ? `${Math.round(cloud)}<span class="u">%</span>` : "—";
    $("c-csf").textContent = csf != null ? `csf ${csf.toFixed(2)}` : "csf —";
    $("c-toa").innerHTML = `${Math.round(toa)}<span class="u">W/m²</span>`;
    $("c-clear").innerHTML = `${Math.round(clear)}<span class="u">W/m²</span>`;
    $("c-ground").innerHTML = `${Math.round(ground)}<span class="u">W/m²</span>`;
    $("c-pct").innerHTML = daylight
      ? `${pct.toFixed(0)}<span class="u">%</span>`
      : "—";
    $("c-pct").className = daylight ? "v amber" : "v";

    const aqi = aq?.us_aqi ?? aq?.european_aqi ?? airQ?.current?.us_aqi;
    $("c-aqi").textContent = aqi != null ? Math.round(aqi) : "—";
    $("c-aqi").className = `v ${Api.aqiClass(aqi)}`;
    $("c-aqi-s").textContent = Api.aqiLabel(aqi);

    const pollen = Api.pollenSummary(aq);
    $("c-pollen").textContent = pollen.level;
    $("c-pollen-s").textContent = pollen.detail;

    $("c-sunel").innerHTML = `${elev.toFixed(0)}<span class="u">°</span>`;
    $("c-sunaz").textContent = `az ${pos.azimuth.toFixed(0)}°`;
    $("c-maxel").innerHTML = `${dayEvents.maxElevation.toFixed(0)}<span class="u">°</span>`;

    $("c-moonel").innerHTML = `${moonPos.elevation.toFixed(0)}<span class="u">°</span>`;
    $("c-moonph").textContent =
      moonPos.elevation >= 0
        ? `up · ${Math.round(moonPos.phase * 100)}% lit`
        : `below · ${Math.round(moonPos.phase * 100)}% lit`;

    timeEl.textContent = Solar.formatTime(solarTime);

    // Skin / exposure
    const skin = Number(skinSlider.value);
    const type = SKIN[skin - 1];
    const uvUse = daylight ? Number(uv) || 0 : 0;

    if (!daylight || uvUse < 0.3) {
      $("h-burn").textContent = "—";
      $("h-burn").className = "v";
      $("h-burn-s").textContent = `type ${type.n} · no UV`;
      $("h-vitd").innerHTML = `0<span class="u">IU/h</span>`;
      $("h-dose").textContent = "—";
      $("h-risk").textContent = "None · sun down";
      $("h-risk").className = "v sm ok";
      $("h-risk-s").textContent = `${type.h} · no UV`;
    } else {
      const burnMin = Math.round(BURN_AT_UV1[skin - 1] / Math.max(uvUse, 0.1));
      $("h-burn").innerHTML = `${burnMin}<span class="u">min</span>`;
      $("h-burn").className =
        burnMin < 25 ? "v hot" : burnMin < 45 ? "v amber" : "v ok";
      $("h-burn-s").textContent = `type ${type.n} · UV ${uvUse.toFixed(1)}`;
      // Rough vit D: higher UVB / lighter skin → faster (estimate only)
      const vitd = Math.round(uvUse * (7 - skin) * 180);
      $("h-vitd").innerHTML = `~${vitd}<span class="u">IU/h</span>`;
      const doseMin = Math.max(5, Math.round((1000 / Math.max(vitd, 1)) * 60));
      $("h-dose").innerHTML = `~${doseMin}<span class="u">min</span>`;
      $("h-risk").textContent =
        burnMin < 20
          ? "High · cover or shade soon"
          : burnMin < 40
            ? "Moderate · watch the clock"
            : "Lower · still possible";
      $("h-risk").className =
        burnMin < 20 ? "v sm hot" : burnMin < 40 ? "v sm amber" : "v sm ok";
      $("h-risk-s").textContent = `${type.h} · UV + cloud + skin + elev`;
    }

    // Moonlight
    if (!daylight && moonPos.elevation > 5) {
      const rel = Math.round(Moon.relativeBrightness(moonPos) * 100);
      $("h-moon").textContent = `~${rel}%`;
      $("h-moon-s").textContent = "of full moon";
    } else if (daylight) {
      $("h-moon").textContent = "—";
      $("h-moon-s").textContent = "sun up · N/A";
    } else {
      $("h-moon").textContent = "—";
      $("h-moon-s").textContent = "moon below";
    }

    $("h-altf").textContent = altFactor.toFixed(2);
    $("h-altf-s").textContent = formatAltitude(terrainAltitudeM);

    drawSky(elev, pct, solarTime, moonPos);
  }

  function updateMapCoordsDisplay() {
    mapCoordsEl.textContent = `${pickLat.toFixed(4)}°, ${pickLon.toFixed(4)}°`;
    latInput.value = pickLat.toFixed(4);
    lonInput.value = pickLon.toFixed(4);
  }

  function setMapPin(newLat, newLon, pan = false) {
    pickLat = newLat;
    pickLon = newLon;
    updateMapCoordsDisplay();
    if (!locationMap) return;
    if (locationMarker) {
      locationMarker.setLatLng([newLat, newLon]);
    } else {
      locationMarker = L.marker([newLat, newLon], { draggable: true }).addTo(locationMap);
      locationMarker.on("dragend", () => {
        const p = locationMarker.getLatLng();
        setMapPin(p.lat, p.lng);
      });
    }
    if (pan) locationMap.setView([newLat, newLon], locationMap.getZoom());
  }

  function initLocationMap() {
    if (locationMap) return;
    locationMap = L.map("location-map", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(locationMap);
    locationMap.on("click", (e) => setMapPin(e.latlng.lat, e.latlng.lng));
  }

  function openLocationDialog() {
    const startLat = lat ?? 35.5951;
    const startLon = lon ?? -82.5515;
    pickLat = startLat;
    pickLon = startLon;
    updateMapCoordsDisplay();
    dialog.showModal();
    requestAnimationFrame(() => {
      initLocationMap();
      const zoom = lat != null ? 10 : 4;
      locationMap.setView([startLat, startLon], zoom);
      setMapPin(startLat, startLon);
      locationMap.invalidateSize();
    });
  }

  function requestLocation(userInitiated = false) {
    if (userInitiated) locationText.textContent = "Detecting location…";
    if (!navigator.geolocation) {
      locationText.textContent = "Geolocation unavailable";
      openLocationDialog();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, altitude } = pos.coords;
        followNow = true;
        setLocation(
          latitude,
          longitude,
          `${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`,
          altitude
        );
      },
      () => {
        locationText.textContent = "Location denied — set on map";
        openLocationDialog();
      },
      { enableHighAccuracy: false, timeout: 12000 }
    );
  }

  slider.addEventListener("input", () => {
    followNow = false;
    update();
  });
  nowBtn.addEventListener("click", () => {
    followNow = true;
    syncSliderToNow();
    update();
  });
  skinSlider.addEventListener("input", () => {
    try {
      localStorage.setItem(SKIN_KEY, skinSlider.value);
    } catch (_) {}
    update();
  });
  locateBtn.addEventListener("click", () => requestLocation(true));
  manualBtn.addEventListener("click", openLocationDialog);
  cancelLocation.addEventListener("click", () => dialog.close());
  locationForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (Number.isFinite(pickLat) && Number.isFinite(pickLon)) {
      followNow = true;
      setLocation(
        pickLat,
        pickLon,
        `${pickLat.toFixed(2)}°, ${pickLon.toFixed(2)}°`
      );
      dialog.close();
    }
  });

  new ResizeObserver(() => update()).observe(canvas.parentElement);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshDay();
      loadWeather();
    }
  });

  setInterval(() => {
    if (lat == null) return;
    if (ensureCurrentDay()) return;
    if (followNow) {
      syncSliderToNow();
      update();
    }
  }, TICK_MS);

  // Refresh weather periodically
  setInterval(() => {
    if (lat != null) loadWeather();
  }, 15 * 60 * 1000);

  requestLocation();
})();
