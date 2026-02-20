/**
 * Rolling window utility functions.
 * Pure math — no external dependencies.
 */

/**
 * Compute 30-day rolling standard deviation of log returns.
 * Input: array of closing prices in ascending date order.
 * Returns: array of same length where each entry is the std dev
 *          of the prior 30 log returns (null for insufficient data).
 */
export function rollingLogReturnStdDev(
    closes: number[],
    window = 30
): (number | null)[] {
    // Step 1: compute log returns
    const logReturns: (number | null)[] = [null]
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > 0 && closes[i - 1] > 0) {
            logReturns.push(Math.log(closes[i] / closes[i - 1]))
        } else {
            logReturns.push(null)
        }
    }

    // Step 2: compute rolling std dev over the log returns
    const result: (number | null)[] = []
    for (let i = 0; i < logReturns.length; i++) {
        if (i < window) {
            result.push(null)
            continue
        }
        const slice = logReturns.slice(i - window, i).filter((v): v is number => v !== null)
        if (slice.length < window * 0.8) {
            // Require at least 80% non-null values in window
            result.push(null)
            continue
        }
        result.push(stdDev(slice))
    }
    return result
}

/**
 * Compute rolling N-period simple moving average.
 */
export function rollingMean(values: (number | null)[], window: number): (number | null)[] {
    return values.map((_, i) => {
        if (i < window - 1) return null
        const slice = values.slice(i - window + 1, i + 1).filter((v): v is number => v !== null)
        if (slice.length < Math.floor(window * 0.8)) return null
        return slice.reduce((a, b) => a + b, 0) / slice.length
    })
}

/**
 * Population standard deviation.
 */
export function stdDev(values: number[]): number {
    if (values.length === 0) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
    return Math.sqrt(variance)
}

/**
 * Compute Nth percentile of an array (linear interpolation).
 */
export function percentile(values: number[], p: number): number {
    if (values.length === 0) throw new Error('Empty array for percentile computation')
    const sorted = [...values].sort((a, b) => a - b)
    const idx = (p / 100) * (sorted.length - 1)
    const lower = Math.floor(idx)
    const upper = Math.ceil(idx)
    if (lower === upper) return sorted[lower]
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower)
}

/**
 * Clamp-normalize a value between min and max to [0, 1].
 * Clamps result to [0, 1] regardless of input range.
 */
export function normalizeMinMax(value: number, min: number, max: number): number {
    if (max === min) return 0
    return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/**
 * Compute 90-day percentage change.
 * Returns null if reference value is 0 or missing.
 */
export function pctChange90d(
    values: (number | null)[],
    window = 90
): (number | null)[] {
    return values.map((v, i) => {
        if (i < window || v === null) return null
        const ref = values[i - window]
        if (ref === null || ref === 0) return null
        return ((v - ref) / Math.abs(ref)) * 100
    })
}
