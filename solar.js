/**
 * Solar position and irradiance (SunCalc / aa.quae.nl).
 */
const Solar = (() => {
  const PI = Math.PI;
  const DEG = PI / 180;
  const RAD = 180 / PI;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const OBLIQUITY = DEG * 23.4397;
  const SUNRISE_ANGLE = -0.833 * DEG;
  /** Clear-sky broadband extinction coefficient (sea level). */
  const EXTINCTION_K = 0.12;
  const PRESSURE_SCALE_M = 8500;

  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }

  function fromJulian(j) {
    return new Date((j + 0.5 - J1970) * dayMs);
  }

  function toDays(date) {
    return toJulian(date) - J2000;
  }

  function localMidnight(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function localNoon(date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      12,
      0,
      0,
      0
    );
  }

  function dayStamp(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function alignToCalendarDay(instant, calendarDate) {
    return new Date(
      calendarDate.getFullYear(),
      calendarDate.getMonth(),
      calendarDate.getDate(),
      instant.getHours(),
      instant.getMinutes(),
      instant.getSeconds(),
      instant.getMilliseconds()
    );
  }

  function sameCalendarDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function rightAscension(l) {
    return Math.atan2(
      Math.sin(l) * Math.cos(OBLIQUITY),
      Math.cos(l)
    );
  }

  function declination(l) {
    return Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
  }

  function siderealTime(d, lw) {
    return DEG * (280.16 + 360.9856235 * d) - lw;
  }

  function solarMeanAnomaly(d) {
    return DEG * (357.5291 + 0.98560028 * d);
  }

  function eclipticLongitude(M) {
    const C =
      DEG *
      (1.9148 * Math.sin(M) +
        0.02 * Math.sin(2 * M) +
        0.0003 * Math.sin(3 * M));
    const P = DEG * 102.9372;
    return M + C + P + PI;
  }

  function sunCoords(d) {
    const M = solarMeanAnomaly(d);
    const L = eclipticLongitude(M);
    return { dec: declination(L), ra: rightAscension(L) };
  }

  function altitude(H, phi, dec) {
    return Math.asin(
      Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(H)
    );
  }

  function astroRefraction(h) {
    if (h < 0) h = 0;
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
  }

  function getPosition(lat, lon, date) {
    const lw = DEG * -lon;
    const phi = DEG * lat;
    const d = toDays(date);
    const c = sunCoords(d);
    const H = siderealTime(d, lw) - c.ra;
    const geometric = altitude(H, phi, c.dec);
    const elev = (geometric + astroRefraction(geometric)) * RAD;
    // Azimuth: 0° = north, 90° = east (compass)
    const az = (
      Math.atan2(
        Math.sin(H),
        Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)
      ) *
        RAD +
      180
    ) % 360;
    return { elevation: elev, azimuth: az };
  }

  const J0 = 0.0009;

  function julianCycle(d, lw) {
    return Math.round(d - J0 - lw / (2 * PI));
  }

  function approxTransit(Ht, lw, n) {
    return J0 + (Ht + lw) / (2 * PI) + n;
  }

  function solarTransitJ(ds, M, L) {
    return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  }

  function hourAngle(h, phi, dec) {
    return Math.acos(
      (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) /
        (Math.cos(phi) * Math.cos(dec))
    );
  }

  function getSetJ(h, lw, phi, dec, n, M, L) {
    const w = hourAngle(h, phi, dec);
    const a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
  }

  function computeCycle(lat, lon, n, lw, phi) {
    const ds = approxTransit(0, lw, n);
    const M = solarMeanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L);
    const Jnoon = solarTransitJ(ds, M, L);
    const Jset = getSetJ(SUNRISE_ANGLE, lw, phi, dec, n, M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    return { Jrise, Jnoon, Jset };
  }

  function getDayEvents(lat, lon, date) {
    const lw = DEG * -lon;
    const phi = DEG * lat;
    const calendarDay = localMidnight(date);
    let n = julianCycle(toDays(localNoon(calendarDay)), lw);

    let { Jrise, Jnoon, Jset } = computeCycle(lat, lon, n, lw, phi);
    let solarNoon = alignToCalendarDay(fromJulian(Jnoon), calendarDay);

    if (!sameCalendarDay(solarNoon, calendarDay)) {
      const next = computeCycle(lat, lon, n + 1, lw, phi);
      const prev = computeCycle(lat, lon, n - 1, lw, phi);
      const nextNoon = alignToCalendarDay(fromJulian(next.Jnoon), calendarDay);
      const prevNoon = alignToCalendarDay(fromJulian(prev.Jnoon), calendarDay);

      if (sameCalendarDay(nextNoon, calendarDay)) {
        n += 1;
        ({ Jrise, Jnoon, Jset } = next);
        solarNoon = nextNoon;
      } else if (sameCalendarDay(prevNoon, calendarDay)) {
        n -= 1;
        ({ Jrise, Jnoon, Jset } = prev);
        solarNoon = prevNoon;
      }
    }

    const sunrise = alignToCalendarDay(fromJulian(Jrise), calendarDay);
    const sunset = alignToCalendarDay(fromJulian(Jset), calendarDay);

    return {
      sunrise,
      sunset,
      solarNoon,
      maxElevation: getPosition(lat, lon, solarNoon).elevation,
    };
  }

  /**
   * Kasten & Young (1989) relative airmass; optional site-elevation pressure correction.
   * AM ≈ 1 / cos(zenith) in the plane-parallel limit.
   */
  function airMass(elevationDeg, altitudeMeters = 0) {
    if (elevationDeg <= 0) return Infinity;
    const sinEl = Math.sin(elevationDeg * DEG);
    const am =
      1 /
      (sinEl +
        0.50572 * Math.pow(elevationDeg + 6.07995, -1.6364));
    const pressureScale = Math.exp(
      -Math.max(0, altitudeMeters) / PRESSURE_SCALE_M
    );
    return am * pressureScale;
  }

  /** Direct horizontal irradiance ∝ sin(elevation) × exp(−k × AM). */
  function horizontalIrradiance(elevationDeg, altitudeMeters = 0) {
    if (elevationDeg <= 0) return 0;
    const am = airMass(elevationDeg, altitudeMeters);
    if (!Number.isFinite(am)) return 0;
    return Math.sin(elevationDeg * DEG) * Math.exp(-EXTINCTION_K * am);
  }

  function irradiancePercent(elevation, maxElevation, altitudeMeters = 0) {
    if (elevation <= 0 || maxElevation <= 0) return 0;
    const current = horizontalIrradiance(elevation, altitudeMeters);
    const peak = horizontalIrradiance(maxElevation, altitudeMeters);
    if (peak <= 0) return 0;
    return Math.max(0, Math.min(100, (current / peak) * 100));
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m}m`;
  }

  function sliderToTime(sliderValue, date) {
    const midnight = localMidnight(date);
    const fraction = Math.min(Math.max(Number(sliderValue), 0), 1000) / 1000;
    const offset = fraction >= 1 ? dayMs - 1 : fraction * dayMs;
    return new Date(midnight.getTime() + offset);
  }

  function timeToSlider(time) {
    const midnight = localMidnight(time);
    const t = (time.getTime() - midnight.getTime()) / dayMs;
    return Math.round(Math.max(0, Math.min(1, t)) * 1000);
  }

  function sliderForNow(now) {
    return timeToSlider(now);
  }

  /**
   * Full 24h circle anchored to today's sun events:
   * east horizon (π) = sunrise, top (π/2) = solar noon, west (0) = sunset,
   * bottom (-π/2) = midnight.
   */
  function sunCycleAngle(solarTime, events) {
    const { sunrise, solarNoon, sunset } = events;
    const dayStart = localMidnight(sunrise).getTime();
    const dayEnd = dayStart + dayMs;
    let t = solarTime.getTime();

    if (t >= dayEnd) return -Math.PI / 2;
    if (t < dayStart) t = dayStart;

    const sr = sunrise.getTime();
    const sn = solarNoon.getTime();
    const ss = sunset.getTime();

    if (t >= sr && t <= ss) {
      if (t <= sn) {
        const f = (t - sr) / (sn - sr);
        return Math.PI - f * (Math.PI / 2);
      }
      const f = (t - sn) / (ss - sn);
      return Math.PI / 2 - f * (Math.PI / 2);
    }

    if (t > ss) {
      const span = dayEnd - ss;
      if (span <= 0) return 0;
      const f = (t - ss) / span;
      return -f * (Math.PI / 2);
    }

    const span = sr - dayStart;
    if (span <= 0) return -Math.PI / 2;
    const f = (t - dayStart) / span;
    return -Math.PI / 2 - f * (Math.PI / 2);
  }

  function cycleAngleForEvents(solarTime, events) {
    return sunCycleAngle(solarTime, events);
  }

  /** Extraterrestrial irradiance scale ~1361 W/m² with small Earth–Sun distance factor. */
  function toaWm2(date) {
    const d = toDays(date);
    // Approximate Earth–Sun distance variation
    const g = DEG * (357.529 + 0.98560028 * d);
    const dist = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    return 1361 / (dist * dist);
  }

  /**
   * Clear-sky global horizontal irradiance estimate (W/m²).
   * TOA × sin(elev) × exp(−k·AM) broadband toy model (matches Solar Light shape).
   */
  function clearSkyGhi(elevationDeg, altitudeMeters, date) {
    if (elevationDeg <= 0) return 0;
    const toa = toaWm2(date || new Date());
    return toa * horizontalIrradiance(elevationDeg, altitudeMeters);
  }

  return {
    getPosition,
    getDayEvents,
    irradiancePercent,
    airMass,
    horizontalIrradiance,
    clearSkyGhi,
    toaWm2,
    formatTime,
    formatDuration,
    sliderToTime,
    timeToSlider,
    sliderForNow,
    sunCycleAngle,
    cycleAngleForEvents,
    localMidnight,
    dayStamp,
  };
})();