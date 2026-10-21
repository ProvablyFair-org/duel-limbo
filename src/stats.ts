/**
 * Statistical tests for the Limbo audit. Game-agnostic.
 *
 * chiSquaredTest   — goodness-of-fit with exact p-values via regularized incomplete gamma.
 * lagOneAutocorrelation — lag-1 autocorrelation of a numeric series.
 * waldsWolfowitzRunsTest — Wald-Wolfowitz runs test for serial randomness.
 */

// ── Chi-squared ────────────────────────────────────────────────────────────────

export interface ChiSquaredResult {
  chi2: number;
  df: number;
  pValue: number;
}

/**
 * Chi-squared goodness-of-fit.
 * Bins with expected < 5 are pooled with their neighbours before the test.
 * Returns chi2, degrees of freedom, and exact p-value via regularized incomplete gamma.
 */
export function chiSquaredTest(
  observed: number[],
  expected: number[],
): ChiSquaredResult {
  if (observed.length !== expected.length) {
    throw new Error('observed and expected must have the same length');
  }

  // Pool bins with expected < 5 — front tail
  let obs = [...observed];
  let exp = [...expected];

  while (obs.length > 2 && exp[0] < 5) {
    obs[1] += obs[0]; exp[1] += exp[0];
    obs.shift(); exp.shift();
  }
  // Back tail
  while (obs.length > 2 && exp[exp.length - 1] < 5) {
    const n = obs.length;
    obs[n - 2] += obs[n - 1]; exp[n - 2] += exp[n - 1];
    obs.pop(); exp.pop();
  }

  let chi2 = 0;
  for (let i = 0; i < obs.length; i++) {
    if (exp[i] > 0) {
      chi2 += (obs[i] - exp[i]) ** 2 / exp[i];
    }
  }

  const df     = obs.length - 1;
  const pValue = 1 - regularizedGamma(df / 2, chi2 / 2);

  return { chi2, df, pValue };
}

// ── Regularized incomplete gamma (exact) ──────────────────────────────────────

/**
 * Regularized lower incomplete gamma P(a, x) = γ(a,x)/Γ(a).
 * Uses series expansion for x < a+1, continued fraction for x >= a+1.
 * Accuracy: ~14 significant digits (Lanczos log-Γ + series/CF).
 */
function regularizedGamma(a: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaCF(a, x);
}

function logGamma(z: number): number {
  // Lanczos approximation, g=7, n=9
  const c = [
     0.99999999999980993,
    676.5203681218851,
   -1259.1392167224028,
    771.32342877765313,
   -176.61502916214059,
     12.507343278686905,
     -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function gammaSeries(a: number, x: number): number {
  const lnGa = logGamma(a);
  let ap  = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < 300; n++) {
    ap++;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGa);
}

function gammaCF(a: number, x: number): number {
  const lnGa = logGamma(a);
  let b  = x + 1 - a;
  let c  = 1 / 1e-30;
  let d  = 1 / b;
  let h  = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d  = an * d + b; if (Math.abs(d) < 1e-30) d = 1e-30;
    c  = b + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d  = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGa) * h;
}

// ── Lag-1 autocorrelation ─────────────────────────────────────────────────────

export function lagOneAutocorrelation(series: number[]): number {
  const n    = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) num += (series[i] - mean) * (series[i + 1] - mean);
  for (let i = 0; i < n; i++)     den += (series[i] - mean) ** 2;
  return den === 0 ? 0 : num / den;
}

// ── Wald-Wolfowitz runs test ──────────────────────────────────────────────────

export interface RunsTestResult {
  runs: number;
  expectedRuns: number;
  zScore: number;
  pValue: number;
}

export function waldsWolfowitzRunsTest(series: number[]): RunsTestResult {
  const med = median(series);
  const bitmask = series.map(v => v >= med ? 1 : 0);
  const n1 = bitmask.filter(v => v === 1).length;
  const n2 = bitmask.length - n1;
  let runs = 1;
  for (let i = 1; i < bitmask.length; i++) {
    if (bitmask[i] !== bitmask[i - 1]) runs++;
  }
  const n = n1 + n2;
  const expectedRuns  = (2 * n1 * n2) / n + 1;
  const varRuns       = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const zScore        = varRuns > 0 ? (runs - expectedRuns) / Math.sqrt(varRuns) : 0;
  const pValue        = 2 * (1 - normalCDF(Math.abs(zScore)));
  return { runs, expectedRuns, zScore, pValue };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz & Stegun approximation, max error < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}

/** Standard normal CDF (exported for the scored live-fit step). */
export function normalCdf(z: number): number { return normalCDF(z); }

/**
 * One-sample Kolmogorov–Smirnov statistic D against a continuous CDF, with the asymptotic
 * Kolmogorov p-value (Stephens' small-sample correction). Informational use only.
 */
export function ksTest(sample: number[], cdf: (x: number) => number): { d: number; pValue: number } {
  const xs = [...sample].sort((a, b) => a - b);
  const n = xs.length;
  let d = 0;
  for (let i = 0; i < n; i++) {
    const f = cdf(xs[i]);
    d = Math.max(d, (i + 1) / n - f, f - i / n);
  }
  const lam = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam);
  return { d, pValue: Math.min(1, Math.max(0, p)) };
}
