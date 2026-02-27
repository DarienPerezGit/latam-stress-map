/**
 * compute.ts — Pure stress score mathematics
 *
 * No DB calls. No API calls. No side effects.
 * Input: raw metrics + normalization params
 * Output: stress_score (0–100) + data_flags
 *
 * Weight redistribution rule (user-approved):
 *   If a component is null, its weight is redistributed proportionally
 *   to the remaining available components.
 *   adjustedWeight_i = weight_i / availableWeight
 *
 * Low confidence rule:
 *   If availableWeight < 0.5 (more than half the signal is missing),
 *   flag "low_confidence": true. Score is still computed and stored,
 *   but downstream consumers can choose to display it with a caveat.
 */

export type MetricName =
    | 'fx_vol'
    | 'inflation'
    | 'risk_spread'
    | 'crypto_ratio'
    | 'reserves_change'
    | 'stablecoin_premium'

// Canonical weights — must sum to 1.0
// stablecoin_premium is AR-only; for other countries it's null and its 0.15
// weight gets redistributed automatically by the weight redistribution rule.
export const WEIGHTS: Record<MetricName, number> = {
    fx_vol: 0.25,
    inflation: 0.20,
    risk_spread: 0.20,
    crypto_ratio: 0.10,
    reserves_change: 0.10,
    stablecoin_premium: 0.15,
}

export interface NormParam {
    metric_name: MetricName
    min_val: number
    max_val: number
}

export interface RawMetrics {
    fx_vol?: number | null
    inflation?: number | null
    risk_spread?: number | null
    crypto_ratio?: number | null
    reserves_change?: number | null
    stablecoin_premium?: number | null
}

export interface StressResult {
    stress_score: number           // 0–100, always finite when any data exists
    available_weight: number          // fraction of original weight used (0–1)
    data_flags: Record<string, unknown>
}

/**
 * Normalize a raw value to [0, 1] using p5/p95 clamping.
 * Values below min → 0.0, above max → 1.0.
 *
 * Formula: clamp((v - min) / (max - min), 0, 1)
 */
export function normalizeScore(value: number, min_val: number, max_val: number): number {
    if (max_val === min_val) return 0.5 // degenerate case: no variance in history
    const raw = (value - min_val) / (max_val - min_val)
    return Math.max(0, Math.min(1, raw))
}

/**
 * Compute the final stress score for a single (country, date) data point.
 *
 * @param metrics     - Raw derived metrics for this row (nulls allowed)
 * @param normParams  - Normalization params for this country from normalization_params table
 * @returns StressResult with score, available weight fraction, and audit flags
 */
export function computeStressScore(
    metrics: RawMetrics,
    normParams: NormParam[]
): StressResult | null {
    const paramMap = new Map(normParams.map((p) => [p.metric_name, p]))
    const flags: Record<string, unknown> = {}
    const missing: MetricName[] = []

    // ── Step 1: Determine which components have both data and norm params ────────
    const available: { metric: MetricName; normalized: number; weight: number }[] = []

    for (const [metric, weight] of Object.entries(WEIGHTS) as [MetricName, number][]) {
        const value = metrics[metric]
        const param = paramMap.get(metric)

        if (value == null) {
            missing.push(metric)
            continue
        }
        if (!param) {
            // Norm params not yet computed for this metric — treat as missing
            missing.push(metric)
            flags[`${metric}_norm_missing`] = true
            continue
        }

        const normalized = normalizeScore(value, param.min_val, param.max_val)
        available.push({ metric, normalized, weight })
    }

    // ── Step 2: Cannot compute if zero components available ─────────────────────
    if (available.length === 0) return null

    // ── Step 3: Compute available weight sum ─────────────────────────────────────
    const availableWeight = available.reduce((sum, c) => sum + c.weight, 0)

    // ── Step 4: Redistribute weights proportionally ──────────────────────────────
    // adjustedWeight_i = weight_i / availableWeight
    // This guarantees Σ(adjustedWeights) = 1.0, keeping score in [0, 100]
    const weightedSum = available.reduce((sum, c) => {
        const adjustedWeight = c.weight / availableWeight
        return sum + adjustedWeight * c.normalized
    }, 0)

    const stress_score = Math.round(weightedSum * 100 * 10) / 10 // round to 1 decimal

    // ── Step 5: Build data flags ──────────────────────────────────────────────────
    if (missing.length > 0) {
        flags['partial'] = true
        flags['missing'] = missing
    }

    // Low confidence: more than 50% of signal weight is missing
    if (availableWeight < 0.5) {
        flags['low_confidence'] = true
    }

    return {
        stress_score,
        available_weight: Math.round(availableWeight * 100) / 100,
        data_flags: flags,
    }
}

/**
 * Compute per-component normalized scores for response presentation.
 * Returns null for components with no data or no norm params.
 */
export function computeComponentScores(
    metrics: RawMetrics,
    normParams: NormParam[]
): Record<MetricName, number | null> {
    const paramMap = new Map(normParams.map((p) => [p.metric_name, p]))
    const result = {} as Record<MetricName, number | null>

    for (const metric of Object.keys(WEIGHTS) as MetricName[]) {
        const value = metrics[metric]
        const param = paramMap.get(metric)
        if (value == null || !param) {
            result[metric] = null
        } else {
            result[metric] = Math.round(normalizeScore(value, param.min_val, param.max_val) * 100 * 10) / 10
        }
    }

    return result
}
