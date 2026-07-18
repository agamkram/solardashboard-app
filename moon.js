/**
 * Moon position + phase (compact, based on common Meeus / SunCalc-style formulas).
 * All mean elements reduced mod 360° so hour angle stays continuous.
 */
const Moon = (() => {
  const PI = Math.PI;
  const DEG = PI / 180;
  const RAD = 180 / PI;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;

  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }

  function toDays(date) {
    return toJulian(date) - J2000;
  }

  /** Reduce degrees to [0, 360). */
  function degMod(x) {
    return ((x % 360) + 360) % 360;
  }

  /** Reduce radians to (−π, π]. Continuous for cos/sin of hour angle. */
  function radNorm(a) {
    return a - 2 * PI * Math.floor((a + PI) / (2 * PI));
  }

  function rightAscension(lon, lat, eps) {
    return Math.atan2(
      Math.sin(lon) * Math.cos(eps) - Math.tan(lat) * Math.sin(eps),
      Math.cos(lon)
    );
  }

  function declination(lon, lat, eps) {
    return Math.asin(
      Math.sin(lat) * Math.cos(eps) +
        Math.cos(lat) * Math.sin(eps) * Math.sin(lon)
    );
  }

  /** Ecliptic geocentric moon (rad). */
  function moonCoords(d) {
    // Mean elements (degrees), then mod before trig
    const L = degMod(218.316 + 13.176396 * d) * DEG; // mean longitude
    const M = degMod(134.963 + 13.064993 * d) * DEG; // mean anomaly
    const F = degMod(93.272 + 13.22935 * d) * DEG; // mean distance argument

    const lon = L + 6.289 * DEG * Math.sin(M);
    const lat = 5.128 * DEG * Math.sin(F);
    return { lon, lat };
  }

  function siderealTime(d, lw) {
    // Same convention as solar.js: lw = −lon east-positive
    return degMod(280.16 + 360.9856235 * d) * DEG - lw;
  }

  /** Sun RA/Dec (rad) — same level of approximation as solar.js. */
  function sunCoords(d) {
    const M = DEG * (357.5291 + 0.98560028 * d);
    const C =
      DEG *
      (1.9148 * Math.sin(M) +
        0.02 * Math.sin(2 * M) +
        0.0003 * Math.sin(3 * M));
    const P = DEG * 102.9372;
    const L = M + C + P + PI;
    const eps = DEG * 23.4397;
    return {
      ra: Math.atan2(Math.sin(L) * Math.cos(eps), Math.cos(L)),
      dec: Math.asin(Math.sin(eps) * Math.sin(L)),
    };
  }

  /**
   * Illuminated fraction 0–1 (SunCalc / Meeus-style).
   * Uses sun–moon elongation on the sphere + distance correction — not crude mean longitudes.
   */
  function phase(date) {
    const d = toDays(date);
    const s = sunCoords(d);
    const c = moonCoords(d);
    const eps = (23.4397 - 0.0000004 * d) * DEG;
    const mRa = rightAscension(c.lon, c.lat, eps);
    const mDec = declination(c.lon, c.lat, eps);
    // Moon distance km (mean anomaly term)
    const Mp = degMod(134.963 + 13.064993 * d) * DEG;
    const dist = 385001 - 20905 * Math.cos(Mp);
    const sdist = 149598000; // km Earth–Sun

    const phi = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          Math.sin(s.dec) * Math.sin(mDec) +
            Math.cos(s.dec) * Math.cos(mDec) * Math.cos(s.ra - mRa)
        )
      )
    );
    const inc = Math.atan2(
      sdist * Math.sin(phi),
      dist - sdist * Math.cos(phi)
    );
    const frac = (1 + Math.cos(inc)) / 2;

    // Waxing = moon ecliptic lon is 0–180° ahead of sun (new → full)
    const sunLon =
      DEG * (357.5291 + 0.98560028 * d) +
      DEG *
        (1.9148 * Math.sin(DEG * (357.5291 + 0.98560028 * d)) +
          0.02 * Math.sin(DEG * 2 * (357.5291 + 0.98560028 * d))) +
      DEG * 102.9372 +
      PI;
    const elong = degMod((c.lon - sunLon) * RAD); // 0–360°
    const waxing = elong < 180;

    return {
      fraction: Math.max(0, Math.min(1, frac)),
      angle: radNorm(inc),
      waxing,
    };
  }

  /**
   * @returns {{ elevation, azimuth, hourAngle, phase, phaseAngle }}
   * elevation/azimuth deg; hourAngle rad (−π, π], 0 = on meridian.
   */
  function getPosition(lat, lon, date) {
    const d = toDays(date);
    const c = moonCoords(d);
    const eps = (23.4397 - 0.0000004 * d) * DEG;
    const ra = rightAscension(c.lon, c.lat, eps);
    const dec = declination(c.lon, c.lat, eps);

    const lw = -lon * DEG;
    const phi = lat * DEG;
    const H = radNorm(siderealTime(d, lw) - ra);

    const elev = Math.asin(
      Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(H)
    );

    // Azimuth: 0° N, 90° E (same style as solar getPosition)
    let az =
      Math.atan2(
        Math.sin(H),
        Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
      ) *
        RAD +
      180;
    az = degMod(az);

    const ph = phase(date);
    return {
      elevation: elev * RAD,
      azimuth: az,
      hourAngle: H,
      phase: ph.fraction,
      phaseAngle: ph.angle,
      waxing: ph.waxing,
    };
  }

  function relativeBrightness(moonPos) {
    if (moonPos.elevation <= 0) return 0;
    const phaseFactor = Math.max(0, moonPos.phase);
    const elevFactor = Math.sin((Math.max(0, moonPos.elevation) * Math.PI) / 180);
    return phaseFactor * elevFactor;
  }

  return { getPosition, phase, relativeBrightness };
})();
