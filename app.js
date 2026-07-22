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

  const CELL_TIPS = {
    uv: "Sunburn-causing UV strength right now (0–11+).",
    uva: "Longer UV; ages skin, goes deeper.",
    uvb: "Shorter UV; sunburn & vitamin D.",
    cloud: "How cloudy the sky is. CSF = clear sky fraction.",
    toa: "Solar power above the atmosphere.",
    clear: "Ideal ground sunlight with no clouds.",
    ground: "Sunlight at ground after air & clouds.",
    pct: "Ground light now vs today’s noon peak.",
    aqi: "US air quality from pollutants. Higher = worse.",
    pollen: "Estimated pollen load for allergy risk.",
    sunel: "Sun height above horizon. Az = direction.",
    maxel: "Highest the sun gets today (solar noon).",
    burn: "Minutes to sunburn for your skin type.",
    vitd: "Vitamin D rate for full-body exposure.",
    dose: "Time outdoors for about 1000 IU vitamin D.",
    kp: "Geomagnetic activity; aurora & radio effects.",
    risk: "Sunburn risk for your skin type & UV.",
    altf: "Extra UV from elevation (thinner air).",
    moonlight: "Moonlight strength from phase & height.",
    moonel: "Moon height above horizon; phase below.",
    skin: "Fitzpatrick I–VI rates how easily skin burns in sun. Sets time-to-burn, burn risk, and vitamin D estimates.",
  };

  function initCellTips() {
    const hosts = Array.from(document.querySelectorAll("[data-tip]"));
    let suppressClick = false;
    let down = null;

    function setOpen(host, open) {
      hosts.forEach((h) => {
        h.classList.toggle("is-explain", open && h === host);
        h.setAttribute("aria-expanded", open && h === host ? "true" : "false");
      });
    }

    function toggleHost(host) {
      if (!host) return;
      setOpen(host, !host.classList.contains("is-explain"));
    }

    function hostFromEvent(e) {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      for (const node of path) {
        if (node && node.dataset && node.dataset.tip) return node;
      }
      const t = e.target;
      if (t && typeof t.closest === "function") {
        return t.closest("[data-tip]");
      }
      return null;
    }

    function isSkinSliderTarget(e) {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      for (const node of path) {
        if (node && node.id === "skin-slider") return true;
        if (node && node.matches && node.matches('input[type="range"]')) return true;
      }
      const t = e.target;
      return !!(t && (t.id === "skin-slider" || t.closest?.("#skin-slider")));
    }

    hosts.forEach((host) => {
      const key = host.dataset.tip;
      const text = CELL_TIPS[key];
      if (!text) return;

      if (host.classList.contains("cell")) {
        host.removeAttribute("role");
        host.removeAttribute("tabindex");
      }

      const tip = document.createElement("span");
      tip.className = "cell-tip";
      tip.textContent = text;
      tip.setAttribute("aria-hidden", "true");
      host.appendChild(tip);

      const label =
        host.querySelector(".k, .lbl")?.textContent || "Metric";
      if (host.classList.contains("cell")) {
        host.setAttribute("aria-label", `${label}. Tap for explanation.`);
      } else {
        host.setAttribute(
          "aria-label",
          `${label}. Tap bar for explanation; use slider to set type.`
        );
      }
    });

    document.addEventListener(
      "pointerdown",
      (e) => {
        const host = hostFromEvent(e);
        if (!host || !hosts.includes(host)) {
          down = null;
          return;
        }
        // Keep Fitzpatrick slider usable — don't start a tip gesture on the thumb
        if (
          host.classList.contains("skin-bar") &&
          !host.classList.contains("is-explain") &&
          isSkinSliderTarget(e)
        ) {
          down = null;
          return;
        }
        down = { host, x: e.clientX, y: e.clientY, id: e.pointerId };
      },
      true
    );

    document.addEventListener(
      "pointerup",
      (e) => {
        if (!down || down.id !== e.pointerId) return;
        const start = down;
        down = null;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy > 100) return;
        if (!start.host.contains(e.target) && hostFromEvent(e) !== start.host) {
          return;
        }
        toggleHost(start.host);
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 450);
      },
      true
    );

    document.addEventListener(
      "pointercancel",
      () => {
        down = null;
      },
      true
    );

    document.addEventListener(
      "click",
      (e) => {
        const host = hostFromEvent(e);
        if (!host || !hosts.includes(host)) return;
        if (
          host.classList.contains("skin-bar") &&
          !host.classList.contains("is-explain") &&
          isSkinSliderTarget(e)
        ) {
          return;
        }
        if (host.classList.contains("cell")) e.preventDefault();
        if (suppressClick) return;
        toggleHost(host);
      },
      true
    );
  }
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
  let kpLatest = null;
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

  function kpLabel(kp) {
    if (kp == null || !Number.isFinite(kp)) return "—";
    if (kp < 3) return "Quiet";
    if (kp < 4) return "Unsettled";
    if (kp < 5) return "Active";
    if (kp < 6) return "G1 minor";
    if (kp < 7) return "G2 moderate";
    if (kp < 8) return "G3 strong";
    if (kp < 9) return "G4 severe";
    return "G5 extreme";
  }

  function kpClass(kp) {
    if (kp == null || !Number.isFinite(kp)) return "";
    if (kp < 4) return "ok";
    if (kp < 5) return "amber";
    return "hot";
  }

  async function loadKp() {
    try {
      const res = await fetch(
        "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
      );
      if (!res.ok) throw new Error(`Kp HTTP ${res.status}`);
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length) {
        const last = rows[rows.length - 1];
        // Prefer estimated_kp; do not use || — Kp of 0 is valid (Quiet)
        let v = Number(last.estimated_kp);
        if (!Number.isFinite(v)) v = Number(last.kp_index);
        if (!Number.isFinite(v)) v = Number(last.Kp);
        kpLatest = Number.isFinite(v) ? v : null;
      }
    } catch (err) {
      console.warn("Kp fetch failed", err);
      kpLatest = null;
    }
  }

  async function loadWeather() {
    if (lat == null || lon == null) return;
    try {
      const [fc, aq] = await Promise.all([
        Api.forecast(lat, lon),
        Api.airQuality(lat, lon).catch(() => null),
        loadKp(),
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

  /**
   * Pin moon to the SAME path circle as the sun (Solar Light style).
   * Angle from local hour angle: meridian (H=0) at top, east before, west after.
   * Continuous on the circle — no free-roam sky projection.
   */
  function moonOnCircle(moonPos, groundY, arcR, arcCx) {
    const r = arcR * 0.94;
    // H: (−π, π], 0 = south meridian. Display: top = π/2, E = π, W = 0, bottom = −π/2
    const H = Number.isFinite(moonPos.hourAngle) ? moonPos.hourAngle : 0;
    const angle = Math.PI / 2 - H;
    return {
      x: arcCx + Math.cos(angle) * r,
      y: groundY - Math.sin(angle) * r,
      below: moonPos.elevation < 0,
    };
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

  /**
   * Draw moon with correct phase shape (sphere terminator = half-ellipse).
   * Old offset-circle trick made ~17% look ~half-lit (~65% visual).
   * @param {number} fraction illuminated 0–1
   * @param {boolean} waxing light on the right (N-hemisphere evening convention)
   */
  function drawMoon(x, y, groundY, w, below, night, fraction, waxing) {
    const r = 9;
    const f = Math.max(0, Math.min(1, fraction));
    ctx.save();
    if (!below) {
      ctx.beginPath();
      ctx.rect(0, 0, w, groundY);
      ctx.clip();
    }
    ctx.globalAlpha = below ? 0.16 : 0.55 + 0.45 * night;

    if (!below && night > 0.15) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      glow.addColorStop(0, "rgba(200, 210, 230, 0.22)");
      glow.addColorStop(1, "rgba(200, 210, 230, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Unlit disc
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#2a303c";
    ctx.fill();

    if (f >= 0.99) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#e4e8f0";
      ctx.fill();
      ctx.restore();
      return;
    }
    if (f <= 0.01) {
      ctx.restore();
      return;
    }

    // Lit region clipped to disc. cos(i) = 2f − 1 → ellipse half-width.
    const cosI = 2 * f - 1;
    const rx = Math.abs(cosI) * r;
    const lit = "#e4e8f0";

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = lit;
    ctx.beginPath();

    if (waxing) {
      // Light on the right
      if (f <= 0.5) {
        ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
        ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
      } else {
        ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false);
        ctx.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, false);
      }
    } else {
      // Light on the left
      if (f <= 0.5) {
        ctx.arc(x, y, r, Math.PI / 2, -Math.PI / 2, false);
        ctx.ellipse(x, y, rx, r, 0, -Math.PI / 2, Math.PI / 2, true);
      } else {
        ctx.arc(x, y, r, Math.PI / 2, -Math.PI / 2, false);
        ctx.ellipse(x, y, rx, r, 0, -Math.PI / 2, Math.PI / 2, false);
      }
    }
    ctx.fill();
    ctx.restore();
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
      const m = moonOnCircle(moonPos, groundY, arcR, arcCx);
      drawMoon(
        m.x,
        m.y,
        groundY,
        w,
        m.below,
        colors.night,
        moonPos.phase,
        moonPos.waxing !== false
      );
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
    // When following "Now", prefer Open-Meteo current (matches weather apps better).
    // Hourly is for scrubbing the day slider.
    if (followNow && forecast?.current) {
      return { ...forecast.current, source: "current" };
    }
    if (!forecast?.hourly) return null;
    const hour = Api.hourlyAt(forecast.hourly, forecast.hourly.time, date);
    if (hour) hour.source = "hourly";
    return hour;
  }

  function airAt(date) {
    if (followNow && airQ?.current) {
      return { ...airQ.current, source: "current" };
    }
    if (!airQ?.hourly) return null;
    return Api.hourlyAt(airQ.hourly, airQ.hourly.time, date);
  }

  /**
   * UVA / UVB (W/m²) from UV index + geometry + clouds.
   *
   * 1) Erythemal irradiance from UVI (WHO: UVI = 40 × E_ery in W/m²).
   * 2) Broadband UVB from erythemal with air-mass–aware CIE-effective fraction.
   * 3) UVA from UVB×(UVA/UVB ratio grows with AM) blended with GHI-based UVA
   *    when ground shortwave is available (all-sky).
   *
   * Still an estimate — not a spectral radiometer.
   */
  function estimateUvaUvb(uv, elevDeg, altitudeM, csf, groundWm2) {
    if (!(uv > 0) || !(elevDeg > 0)) return { uva: 0, uvb: 0, ery: 0 };

    const am = Solar.airMass(elevDeg, altitudeM || 0);
    const amClamped = Number.isFinite(am) ? Math.min(Math.max(am, 1), 8) : 1.5;

    // WHO / CIE: UV Index = 40 × erythemal irradiance (W/m²)
    const ery = uv / 40;

    // Fraction of broadband UVB (≈280–315 nm) that is CIE-erythemal effective.
    // Slightly higher effective fraction when AM is large (short UVB stripped).
    const fEryOfUvb = 0.085 + 0.012 * Math.min(amClamped - 1, 5);
    const uvb = ery / Math.max(fEryOfUvb, 0.05);

    // UVA/UVB ratio rises with air mass (UVB attenuates faster than UVA)
    const uvaUvbRatio = 26 + 5.5 * Math.min(amClamped, 6);

    // Cloud / atmosphere factor already in UVI; optional GHI anchor for UVA
    let uvaFromUvb = uvb * uvaUvbRatio;
    let uva = uvaFromUvb;

    if (groundWm2 != null && groundWm2 > 20) {
      // Empirical: UVA is roughly ~4–7% of broadband GHI, rises a bit with AM
      const uvaFromGhi =
        groundWm2 * (0.042 + 0.006 * Math.min(amClamped, 4));
      // Prefer UVI path; pull toward GHI when both exist (all-sky consistency)
      const wGhi = 0.45;
      uva = (1 - wGhi) * uvaFromUvb + wGhi * uvaFromGhi;
    }

    // Mild CSF sanity: if we have a strong clear-sky UV but low UV, UVA shouldn't
    // exceed a clear-ish GHI-based ceiling when GHI is known
    if (csf != null && csf > 0 && csf < 1.05 && groundWm2 > 20) {
      const uvaCeil = groundWm2 * 0.09;
      uva = Math.min(uva, uvaCeil);
    }

    return {
      uva: Math.max(0, uva),
      uvb: Math.max(0, uvb),
      ery: Math.max(0, ery),
    };
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
    // Use API UV only — never invent high clear-sky UV from elevation
    // (old fallback elev/maxElev × 8 looked like ~8 under clouds).
    let uv = 0;
    if (wx?.uv_index != null && Number.isFinite(Number(wx.uv_index))) {
      uv = Number(wx.uv_index);
    } else if (!daylight) {
      uv = 0;
    }
    // else leave 0 / show low — missing data, don't fake noon UV
    const uvClear = wx?.uv_index_clear_sky;
    const csf =
      uvClear > 0.2 && uv != null
        ? Math.min(1.2, uv / uvClear)
        : clear > 10
          ? Math.min(1.2, ground / clear)
          : null;

    const { uva, uvb } = estimateUvaUvb(
      uv,
      elev,
      terrainAltitudeM,
      csf,
      ground
    );
    const am = elev > 0 ? Solar.airMass(elev, terrainAltitudeM) : null;
    const altFactor = Math.exp(terrainAltitudeM / 8500);

    // Cards
    $("c-uv").textContent = daylight ? (uv != null ? Number(uv).toFixed(1) : "—") : "0";
    $("c-uv-s").textContent = Api.uvLabel(daylight ? uv : 0);
    $("c-uva").innerHTML =
      uva > 0 ? `${uva.toFixed(0)}<span class="u">W/m²</span>` : "—";
    $("c-uvb").innerHTML =
      uvb > 0 ? `${uvb.toFixed(2)}<span class="u">W/m²</span>` : "—";
    $("c-cloud").innerHTML =
      cloud != null ? `${Math.round(cloud)}<span class="u">%</span>` : "—";
    $("c-csf").textContent = csf != null ? `csf ${csf.toFixed(2)}` : "csf —";
    $("c-toa").innerHTML = `${Math.round(toa)}<span class="u">W/m²</span>`;
    $("c-clear").innerHTML = `${Math.round(clear)}<span class="u">W/m²</span>`;
    $("c-ground").innerHTML = `${Math.round(ground)}<span class="u">W/m²</span>`;
    $("c-pct").innerHTML = daylight
      ? `${pct.toFixed(0)}<span class="u">%</span>`
      : "—";
    $("c-pct").className = "v";

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
      $("h-risk").textContent = "None";
      $("h-risk").className = "v ok";
      $("h-risk-s").textContent = type.h;
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
        burnMin < 20 ? "High" : burnMin < 40 ? "Moderate" : "Lower";
      $("h-risk").className =
        burnMin < 20 ? "v hot" : burnMin < 40 ? "v amber" : "v ok";
      $("h-risk-s").textContent = type.h;
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

    // Kp (geomagnetic) — global, not location-tied
    if (kpLatest != null && Number.isFinite(kpLatest)) {
      $("h-kp").textContent = kpLatest.toFixed(1);
      $("h-kp").className = `v ${kpClass(kpLatest)}`.trim();
      $("h-kp-s").textContent = kpLabel(kpLatest);
    } else {
      $("h-kp").textContent = "—";
      $("h-kp").className = "v";
      $("h-kp-s").textContent = "geomagnetic";
    }

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

  /** Fallback so the sky isn't an empty black hole before GPS. */
  function useFallbackLocation() {
    // Asheville NC — matches other Mark apps
    setLocation(35.5951, -82.5515, "Asheville, NC (tap Edit to change)");
  }

  function requestLocation(userInitiated = false) {
    if (userInitiated) locationText.textContent = "Detecting location…";
    if (!navigator.geolocation) {
      locationText.textContent = "Geolocation unavailable";
      if (userInitiated) openLocationDialog();
      else useFallbackLocation();
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
        if (userInitiated) {
          locationText.textContent = "Location denied — set on map";
          openLocationDialog();
        } else {
          useFallbackLocation();
        }
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
    // Pull fresh Open-Meteo + Kp, then re-render (location stays put)
    if (lat != null) loadWeather();
    else {
      loadKp().then(() => update());
      update();
    }
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

  /**
   * Shell detection + viewport fit (no human tuning required).
   *
   * Safari tab: bottom toolbar steals height; layout viewport ≠ visible area.
   * PWA standalone: no toolbar; visual height is mostly full screen.
   *
   * Rules we always apply on phone:
   *  1) Size stage to visualViewport when available (not 100vh alone).
   *  2) Never stack VV height + env(safe-area-inset-bottom) — double-count = ghost gap.
   *  3) Standalone vs browser get data-shell for CSS if needed.
   *  4) Re-fit on VV resize/scroll, orientation, pageshow (bfcache), visibility.
   */
  function isStandaloneShell() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      // iOS legacy
      (typeof navigator !== "undefined" && navigator.standalone === true)
    );
  }

  function isPhoneShell() {
    return (
      window.matchMedia("(max-width: 500px)").matches ||
      (window.matchMedia("(pointer: coarse)").matches &&
        Math.min(window.innerWidth, window.innerHeight) <= 500)
    );
  }

  function isTouchLike() {
    return (
      (navigator.maxTouchPoints || 0) > 0 ||
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches
    );
  }

  /** iPad etc.: coarse/touch, larger than phone — not MacBook. */
  function isTabletShell() {
    if (isPhoneShell()) return false;
    return (
      isTouchLike() && Math.min(window.innerWidth, window.innerHeight) > 500
    );
  }

  function syncShellAttr() {
    const shell = isStandaloneShell() ? "standalone" : "browser";
    const layout = isPhoneShell()
      ? "phone"
      : isTabletShell()
        ? "tablet"
        : "desktop";
    document.documentElement.dataset.shell = shell;
    document.documentElement.dataset.layout = layout;
    if (document.body) {
      document.body.dataset.shell = shell;
      document.body.dataset.layout = layout;
    }
  }

  let fitRaf = 0;
  let hasRevealed = false;
  let revealFailsafe = null;
  let revealTimer = null;
  let lastFitKey = "";
  let stableFitCount = 0;

  function scheduleFit() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      fitRaf = requestAnimationFrame(() => fitArtboard());
    });
  }

  /** Show board only after layout math is applied (no startup jump). */
  function revealApp(appEl) {
    if (!appEl || hasRevealed) return;
    hasRevealed = true;
    appEl.classList.add("is-fitted");
    if (revealFailsafe != null) {
      clearTimeout(revealFailsafe);
      revealFailsafe = null;
    }
    if (revealTimer != null) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  /** Hold hidden until VV size stops changing — kills Safari flash/hop. */
  function armReveal(appEl) {
    if (hasRevealed || !appEl) return;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = null;
      // One last measure after Safari chrome settles, then show
      fitArtboard(true);
    }, 140);
  }

  function fitArtboard(fromRevealSettle = false) {
    const stage = document.getElementById("fit-stage");
    const appEl = document.getElementById("app");
    if (!stage || !appEl) return;

    syncShellAttr();
    const phone = isPhoneShell();
    const vv = window.visualViewport;
    const standalone = isStandaloneShell();

    if (phone) {
      appEl.style.transform = "";
      appEl.style.zoom = "";
      appEl.style.width = "";
      appEl.style.height = "";

      stage.classList.toggle("fit-stage--standalone", standalone);
      stage.classList.toggle("fit-stage--browser", !standalone);

      if (vv && vv.height > 0) {
        stage.classList.add("fit-stage--vv");
        stage.style.position = "fixed";
        stage.style.top = `${Math.round(vv.offsetTop)}px`;
        stage.style.left = `${Math.round(vv.offsetLeft)}px`;
        stage.style.width = `${Math.round(vv.width)}px`;
        // Exact VV height — never extend (clips under home indicator).
        // Bottom air = CSS padding only. See supermoon-bottom-black-strip-fix.txt
        stage.style.height = `${Math.round(vv.height)}px`;
        stage.style.right = "auto";
        stage.style.bottom = "auto";
        stage.style.margin = "0";
        stage.style.paddingBottom = "";
      } else {
        stage.classList.remove("fit-stage--vv");
        stage.style.position = "fixed";
        stage.style.inset = "0";
        stage.style.width = "";
        stage.style.height = "";
        stage.style.top = "";
        stage.style.left = "";
        stage.style.paddingBottom = "";
      }

      const fitKey = vv
        ? `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}:${standalone ? 1 : 0}`
        : `novv:${window.innerWidth}x${window.innerHeight}`;
      if (fitKey === lastFitKey) stableFitCount += 1;
      else {
        lastFitKey = fitKey;
        stableFitCount = 0;
      }

      update();
      requestAnimationFrame(() => {
        update();
        if (fromRevealSettle || stableFitCount >= 1) {
          revealApp(appEl);
        } else {
          armReveal(appEl);
        }
      });
      return;
    }

    // Desktop / tablet — clear phone VV pin, proportional artboard scale
    stage.classList.remove("fit-stage--vv", "fit-stage--standalone", "fit-stage--browser");
    stage.style.position = "fixed";
    stage.style.inset = "0";
    stage.style.top = "";
    stage.style.left = "";
    stage.style.right = "";
    stage.style.bottom = "";
    stage.style.width = "";
    stage.style.height = "";
    stage.style.margin = "";
    stage.style.paddingBottom = "";

    const ART_W = 390;
    const ART_H = 844;
    appEl.style.width = `${ART_W}px`;
    appEl.style.height = `${ART_H}px`;

    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (sw < 2 || sh < 2) return;

    const scale = Math.min(sw / ART_W, sh / ART_H);
    // iOS: transform scale misaligns touch targets; zoom keeps hits on the visuals
    const touchUI =
      (navigator.maxTouchPoints || 0) > 0 ||
      window.matchMedia("(pointer: coarse)").matches;
    if (touchUI && typeof CSS !== "undefined" && CSS.supports?.("zoom", "1")) {
      appEl.style.transform = "";
      appEl.style.zoom = String(scale);
    } else {
      appEl.style.zoom = "";
      appEl.style.transform = `scale(${scale})`;
    }
    update();
    requestAnimationFrame(() => {
      update();
      revealApp(appEl);
    });
  }

  window.addEventListener("resize", scheduleFit);
  window.addEventListener("orientationchange", () => setTimeout(scheduleFit, 50));
  window.visualViewport?.addEventListener("resize", scheduleFit);
  window.visualViewport?.addEventListener("scroll", scheduleFit);
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", scheduleFit);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshDay();
      loadWeather();
      scheduleFit();
    }
  });

  window.addEventListener("pageshow", (e) => {
    scheduleFit();
    if (e.persisted && lat != null) {
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

  // Refresh weather + Kp periodically
  setInterval(() => {
    if (lat != null) loadWeather();
    else loadKp().then(() => update());
  }, 15 * 60 * 1000);

  // Kp is global — load even before GPS settles
  loadKp().then(() => update());

  initCellTips();
  requestLocation();
  scheduleFit();
  // Never leave a blank screen if fit is slow
  revealFailsafe = setTimeout(() => {
    const appEl = document.getElementById("app");
    if (appEl) revealApp(appEl);
  }, 700);
})();
