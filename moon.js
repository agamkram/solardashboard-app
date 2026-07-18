/**
 * Compact moon position + phase (Meeus-style approximations).
 * Good enough for elevation, azimuth, phase display — not navigation grade.
 */
const Moon = (() => {
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;

  function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
  }

  function toDays(date) {
    return toJulian(date) - J2000;
  }

  /** Illuminated fraction 0–1 and phase angle. */
  function phase(date) {
    const d = toDays(date);
    // Mean elongations / anomalies (deg)
    const D = (297.8501921 + 445267.1114034 * d) * DEG;
    const M = (357.5291092 + 35999.0502909 * d) * DEG;
    const Mp = (134.9633964 + 477198.8675055 * d) * DEG;
    // Phase angle (rad)
    const i =
      Math.PI -
      D -
      6.289 * DEG * Math.sin(Mp) +
      2.1 * DEG * Math.sin(M) -
      1.274 * DEG * Math.sin(2 * D - Mp) -
      0.658 * DEG * Math.sin(2 * D) -
      0.214 * DEG * Math.sin(2 * Mp) -
      0.11 * DEG * Math.sin(D);
    const frac = (1 + Math.cos(i)) / 2;
    return { fraction: Math.max(0, Math.min(1, frac)), angle: i };
  }

  /** Geocentric ecliptic → approximate topocentric alt/az. */
  function getPosition(lat, lon, date) {
    const d = toDays(date);
    const L0 = (218.3164477 + 481267.88123421 * d) * DEG;
    const M = (357.5291092 + 35999.0502909 * d) * DEG;
    const Mp = (134.9633964 + 477198.8675055 * d) * DEG;
    const D = (297.8501921 + 445267.1114034 * d) * DEG;
    const F = (93.272095 + 483202.0175233 * d) * DEG;

    let lonEcl =
      L0 +
      6.289 * DEG * Math.sin(Mp) +
      1.274 * DEG * Math.sin(2 * D - Mp) +
      0.658 * DEG * Math.sin(2 * D) +
      0.214 * DEG * Math.sin(2 * Mp) -
      0.186 * DEG * Math.sin(M) -
      0.114 * DEG * Math.sin(2 * F);
    let latEcl =
      5.128 * DEG * Math.sin(F) +
      0.281 * DEG * Math.sin(Mp + F) +
      0.278 * DEG * Math.sin(Mp - F) +
      0.173 * DEG * Math.sin(2 * D - F);

    const eps = (23.4397 - 0.0000004 * d) * DEG;
    const ra = Math.atan2(
      Math.sin(lonEcl) * Math.cos(eps) - Math.tan(latEcl) * Math.sin(eps),
      Math.cos(lonEcl)
    );
    const dec = Math.asin(
      Math.sin(latEcl) * Math.cos(eps) +
        Math.cos(latEcl) * Math.sin(eps) * Math.sin(lonEcl)
    );

    const lw = -lon * DEG;
    const phi = lat * DEG;
    const thr = (280.16 + 360.9856235 * d) * DEG - lw;
    const H = thr - ra;

    const elev = Math.asin(
      Math.sin(phi) * Math.sin(dec) +
        Math.cos(phi) * Math.cos(dec) * Math.cos(H)
    );
    let az =
      Math.atan2(
        Math.sin(H),
        Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)
      ) *
        RAD +
      180;
    az = ((az % 360) + 360) % 360;

    const ph = phase(date);
    return {
      elevation: elev * RAD,
      azimuth: az,
      phase: ph.fraction,
      phaseAngle: ph.angle,
    };
  }

  /** Relative moonlight brightness vs full moon overhead (0–1-ish). */
  function relativeBrightness(moonPos) {
    if (moonPos.elevation <= 0) return 0;
    const phaseFactor = Math.max(0, moonPos.phase);
    const elevFactor = Math.sin((Math.max(0, moonPos.elevation) * Math.PI) / 180);
    return phaseFactor * elevFactor;
  }

  return { getPosition, phase, relativeBrightness };
})();
