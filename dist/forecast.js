/**
 * SEO Traffic Forecasting & Rolling-Origin Backtesting Engine.
 *
 * Implements 30-, 90-, and 180-day forecast horizons with:
 * - Deterministic trend + weekly seasonality modeling
 * - Parametric 95% uncertainty intervals
 * - Rolling-origin temporal cross-validation (zero data leakage)
 * - Benchmark comparisons against Naive (persistence) and Historical Mean baselines
 * - Rigorous error metrics: MAE, RMSE, MAPE, Mean Forecast Bias, and 95% Coverage
 * - Explicit 'insufficient_evidence' classification for sparse or short history (<30 days or low clicks)
 */
export const FORECAST_MODEL_VERSION = 'v1.4.0-ts-ensemble';
const FORECAST_PROVENANCE = {
    tier: 'statistical_model',
    isFactual: false,
    dataSource: 'First-party Google Search Console Observations',
    methodology: 'Ensemble OLS Linear Trend + Weekly Day-of-Week Seasonality + Rolling-Origin Backtesting',
    confidence: 'modeled',
    warning: 'Modeled projection. Search algorithm updates, competitor shifts, or site migrations can cause divergence.',
};
/**
 * Fits linear trend slope and intercept: y = a + b * t
 */
function fitLinearTrend(values) {
    const n = values.length;
    if (n < 2)
        return { slope: 0, intercept: values[0] ?? 0 };
    let sumT = 0;
    let sumY = 0;
    let sumTY = 0;
    let sumT2 = 0;
    for (let t = 0; t < n; t++) {
        const y = values[t];
        sumT += t;
        sumY += y;
        sumTY += t * y;
        sumT2 += t * t;
    }
    const denom = n * sumT2 - sumT * sumT;
    if (Math.abs(denom) < 1e-9) {
        return { slope: 0, intercept: sumY / n };
    }
    const slope = (n * sumTY - sumT * sumY) / denom;
    const intercept = (sumY - slope * sumT) / n;
    return { slope, intercept };
}
/**
 * Computes multiplicative day-of-week seasonal multipliers (0=Sun, 1=Mon, ..., 6=Sat)
 */
function computeDayOfWeekMultipliers(observations) {
    const dowSums = new Array(7).fill(0);
    const dowCounts = new Array(7).fill(0);
    for (const obs of observations) {
        const d = new Date(obs.date + 'T00:00:00Z');
        const dow = d.getUTCDay();
        dowSums[dow] += obs.clicks;
        dowCounts[dow] += 1;
    }
    const overallTotal = dowSums.reduce((a, b) => a + b, 0);
    const overallCount = dowCounts.reduce((a, b) => a + b, 0);
    const overallMean = overallCount > 0 ? overallTotal / overallCount : 1;
    const multipliers = new Array(7).fill(1.0);
    for (let i = 0; i < 7; i++) {
        const c = dowCounts[i];
        if (c > 0 && overallMean > 0) {
            const avg = dowSums[i] / c;
            multipliers[i] = Math.max(0.2, Math.min(2.5, avg / overallMean));
        }
    }
    return multipliers;
}
/**
 * Generates future dates in YYYY-MM-DD format starting from lastDate + 1 day
 */
function generateFutureDates(lastDateStr, count) {
    const res = [];
    const current = new Date(lastDateStr + 'T00:00:00Z');
    for (let i = 1; i <= count; i++) {
        current.setUTCDate(current.getUTCDate() + 1);
        res.push(current.toISOString().slice(0, 10));
    }
    return res;
}
/**
 * Calibrates prediction interval multiplier on internal training-window holdout splits
 * with zero temporal leakage (max(T_subtrain) < min(T_calib)).
 */
function calibratePredictionIntervalMultiplier(trainClicks, trainSet, resStd) {
    if (trainClicks.length < 30 || resStd <= 0)
        return 1.96;
    const calibLen = Math.max(10, Math.floor(trainClicks.length * 0.3));
    const calibStart = trainClicks.length - calibLen;
    const subClicks = trainClicks.slice(0, calibStart);
    const { slope: subSlope, intercept: subIntercept } = fitLinearTrend(subClicks);
    const subMults = computeDayOfWeekMultipliers(trainSet.slice(0, calibStart));
    const ratios = [];
    for (let i = 0; i < calibLen; i++) {
        const idx = calibStart + i;
        const obs = trainSet[idx];
        const dow = new Date(obs.date + 'T00:00:00Z').getUTCDay();
        const p = Math.max(0, (subIntercept + subSlope * idx) * subMults[dow]);
        const step = i + 1;
        const expansion = Math.sqrt(1 + step / 10 + Math.pow(step / 30, 1.5));
        ratios.push(Math.abs(obs.clicks - p) / (resStd * expansion));
    }
    ratios.sort((a, b) => a - b);
    const q95Idx = Math.min(ratios.length - 1, Math.floor(ratios.length * 0.95));
    return Math.max(1.96, Math.min(3.5, ratios[q95Idx] ?? 1.96));
}
/**
 * Executes a rolling-origin backtest for a specific horizon with zero data leakage.
 */
function evaluateHorizonRollingBacktest(observations, horizon, splits) {
    const n = observations.length;
    // We need at least 30 days of training data plus the test horizon
    const minRequiredDays = 30 + horizon;
    if (n < minRequiredDays) {
        return null;
    }
    const actualErrors = [];
    const absErrors = [];
    const sqErrors = [];
    const pctErrors = [];
    let inIntervalCount = 0;
    let totalEvaluatedPoints = 0;
    const naiveAbsErrors = [];
    const seasonalNaiveAbsErrors = [];
    const meanAbsErrors = [];
    // Determine split step size
    const maxTrainIndex = n - horizon;
    const minTrainIndex = Math.max(30, Math.floor(n * 0.4));
    const availableSpan = maxTrainIndex - minTrainIndex;
    const numFolds = Math.max(1, Math.min(splits, Math.floor(availableSpan / 10) + 1));
    const step = Math.max(1, Math.floor(availableSpan / numFolds));
    for (let s = 0; s < numFolds; s++) {
        const trainEndIdx = minTrainIndex + s * step;
        if (trainEndIdx > maxTrainIndex)
            break;
        const trainSet = observations.slice(0, trainEndIdx);
        const testSet = observations.slice(trainEndIdx, trainEndIdx + horizon);
        // Strictly verify zero data leakage: train dates strictly precede test dates
        const maxTrainDate = trainSet[trainSet.length - 1].date;
        const minTestDate = testSet[0].date;
        if (maxTrainDate >= minTestDate) {
            throw new Error(`Data leakage detected in backtest! maxTrainDate (${maxTrainDate}) >= minTestDate (${minTestDate})`);
        }
        // Train baseline models
        const trainClicks = trainSet.map(o => o.clicks);
        const naiveValue = trainClicks[trainClicks.length - 1];
        const meanValue = trainClicks.reduce((a, b) => a + b, 0) / trainClicks.length;
        // Train primary model (trend + DOW seasonality)
        const { slope, intercept } = fitLinearTrend(trainClicks);
        const dowMultipliers = computeDayOfWeekMultipliers(trainSet);
        // Residual std dev for 95% interval
        let residualSumSq = 0;
        for (let t = 0; t < trainSet.length; t++) {
            const dow = new Date(trainSet[t].date + 'T00:00:00Z').getUTCDay();
            const pred = Math.max(0, (intercept + slope * t) * dowMultipliers[dow]);
            const err = trainSet[t].clicks - pred;
            residualSumSq += err * err;
        }
        const residualStd = Math.sqrt(residualSumSq / Math.max(1, trainSet.length - 2));
        // Calibrate prediction interval quantile strictly on train validation split
        const calibMultiplier = calibratePredictionIntervalMultiplier(trainClicks, trainSet, residualStd);
        // Predict across test horizon
        for (let h = 0; h < testSet.length; h++) {
            const testPoint = testSet[h];
            const t = trainSet.length + h;
            const dow = new Date(testPoint.date + 'T00:00:00Z').getUTCDay();
            const predicted = Math.max(0, (intercept + slope * t) * dowMultipliers[dow]);
            // Compound forecast horizon uncertainty incorporating autoregressive variance
            const horizonExpansion = Math.sqrt(1 + (h + 1) / 10 + Math.pow((h + 1) / 30, 1.5));
            const margin = calibMultiplier * residualStd * horizonExpansion;
            const lower95 = Math.max(0, predicted - margin);
            const upper95 = predicted + margin;
            const actual = testPoint.clicks;
            const error = actual - predicted;
            actualErrors.push(error);
            absErrors.push(Math.abs(error));
            sqErrors.push(error * error);
            if (actual > 0) {
                pctErrors.push(Math.abs(error) / actual);
            }
            if (actual >= lower95 && actual <= upper95) {
                inIntervalCount++;
            }
            totalEvaluatedPoints++;
            // Baseline 1: Standard Naive (flat last observed value)
            naiveAbsErrors.push(Math.abs(actual - naiveValue));
            // Baseline 2: Seasonal-Naive (value observed on the same day-of-week 7 days prior)
            const seasonalNaiveValue = trainClicks[trainClicks.length - 7 + (h % 7)] ?? naiveValue;
            seasonalNaiveAbsErrors.push(Math.abs(actual - seasonalNaiveValue));
            // Baseline 3: Historical Training Mean
            meanAbsErrors.push(Math.abs(actual - meanValue));
        }
    }
    if (totalEvaluatedPoints === 0)
        return null;
    const mae = absErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints;
    const rmse = Math.sqrt(sqErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints);
    const mape = pctErrors.length > 0 ? (pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length) * 100 : 0;
    const bias = actualErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints;
    const coverage95 = inIntervalCount / totalEvaluatedPoints;
    const naiveMae = naiveAbsErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints;
    const seasonalNaiveMae = seasonalNaiveAbsErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints;
    const meanMae = meanAbsErrors.reduce((a, b) => a + b, 0) / totalEvaluatedPoints;
    const modelImprovementPercent = naiveMae > 0 ? Number((((naiveMae - mae) / naiveMae) * 100).toFixed(2)) : 0;
    return {
        horizonDays: horizon,
        mae: Number(mae.toFixed(2)),
        rmse: Number(rmse.toFixed(2)),
        mape: Number(mape.toFixed(2)),
        bias: Number(bias.toFixed(2)),
        coverage95: Number(coverage95.toFixed(4)),
        sampleSize: totalEvaluatedPoints,
        naiveMae: Number(naiveMae.toFixed(2)),
        seasonalNaiveMae: Number(seasonalNaiveMae.toFixed(2)),
        meanMae: Number(meanMae.toFixed(2)),
        modelImprovementPercent,
    };
}
/**
 * Orchestrates 30-, 90-, and 180-day forecasts and backtesting evaluation.
 */
export function generateTrafficForecast(domain, rawObservations, options = {}) {
    const minObs = options.minObservations ?? 30;
    const minClicks = options.minClicksThreshold ?? 50;
    const backtestFolds = options.backtestFolds ?? 4;
    const nowIso = new Date().toISOString();
    // Sort observations chronologically
    const observations = [...rawObservations].sort((a, b) => a.date.localeCompare(b.date));
    const totalObservedClicks = observations.reduce((acc, o) => acc + o.clicks, 0);
    const startDate = observations[0]?.date ?? '';
    const endDate = observations[observations.length - 1]?.date ?? '';
    const observationWindow = {
        startDate,
        endDate,
        totalDays: observations.length,
        totalObservedClicks,
    };
    // Check acceptance criteria: Missing or inadequate historical data returns an explicit insufficient-evidence result
    if (observations.length < minObs || totalObservedClicks < minClicks) {
        const reason = observations.length < minObs
            ? `Insufficient history: found ${observations.length} days of telemetry, minimum required is ${minObs} days.`
            : `Sparse telemetry volume: total observed clicks (${totalObservedClicks}) is below minimum threshold (${minClicks}).`;
        return {
            domain,
            status: 'insufficient_evidence',
            reason,
            modelVersion: FORECAST_MODEL_VERSION,
            generatedAt: nowIso,
            observationWindow,
            horizons: { 30: null, 90: null, 180: null },
            dataLimitations: [
                'Insufficient historical data to construct statistically sound rolling-origin projections.',
                'At least 30 days of consecutive Search Console telemetry with >=50 total clicks is required.',
                'Estimates under sparse history exhibit high variance and unreliable prediction intervals.',
            ],
            provenance: FORECAST_PROVENANCE,
        };
    }
    // Model fitting
    const clicks = observations.map(o => o.clicks);
    const { slope, intercept } = fitLinearTrend(clicks);
    const dowMultipliers = computeDayOfWeekMultipliers(observations);
    // In-sample residuals for uncertainty intervals
    let residualSumSq = 0;
    for (let t = 0; t < observations.length; t++) {
        const dow = new Date(observations[t].date + 'T00:00:00Z').getUTCDay();
        const pred = Math.max(0, (intercept + slope * t) * dowMultipliers[dow]);
        const err = observations[t].clicks - pred;
        residualSumSq += err * err;
    }
    const residualStd = Math.sqrt(residualSumSq / Math.max(1, observations.length - 2));
    // Baselines
    const naiveValue = clicks[clicks.length - 1];
    const meanValue = Math.round(clicks.reduce((a, b) => a + b, 0) / clicks.length);
    // Generate projections for 30, 90, 180 days
    const futureDates = generateFutureDates(endDate, 180);
    const allFuturePoints = [];
    // Calibrate prediction interval quantile strictly on internal holdout split
    const calibMultiplier = calibratePredictionIntervalMultiplier(clicks, observations, residualStd);
    for (let h = 0; h < futureDates.length; h++) {
        const date = futureDates[h];
        const t = observations.length + h;
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        const predClicks = Math.max(0, Math.round((intercept + slope * t) * dowMultipliers[dow]));
        const expansion = Math.sqrt(1 + (h + 1) / 10 + Math.pow((h + 1) / 30, 1.5));
        const margin = Math.round(calibMultiplier * residualStd * expansion);
        allFuturePoints.push({
            date,
            predictedClicks: predClicks,
            lower95: Math.max(0, predClicks - margin),
            upper95: predClicks + margin,
            baselineNaive: naiveValue,
            baselineMean: meanValue,
        });
    }
    const buildHorizon = (days) => {
        const points = allFuturePoints.slice(0, days);
        const expectedTotal = points.reduce((a, p) => a + p.predictedClicks, 0);
        const lower95Total = points.reduce((a, p) => a + p.lower95, 0);
        const upper95Total = points.reduce((a, p) => a + p.upper95, 0);
        const targetEndDate = points[points.length - 1]?.date ?? '';
        return {
            horizonDays: days,
            targetEndDate,
            expectedTotalClicks: expectedTotal,
            lower95TotalClicks: lower95Total,
            upper95TotalClicks: upper95Total,
            points,
        };
    };
    const horizons = {
        30: buildHorizon(30),
        90: buildHorizon(90),
        180: buildHorizon(180),
    };
    // Perform rolling backtests on unseen holdout splits
    const backtest30 = evaluateHorizonRollingBacktest(observations, 30, backtestFolds);
    const backtest90 = evaluateHorizonRollingBacktest(observations, 90, backtestFolds);
    const backtest180 = evaluateHorizonRollingBacktest(observations, 180, backtestFolds);
    const backtestEvaluation = {
        rollingOriginSplits: backtestFolds,
        metrics: {
            30: backtest30,
            90: backtest90,
            180: backtest180,
        },
        dataLeakageFree: true,
        ...(totalObservedClicks < 300
            ? { lowVolumeWarning: 'Low historical volume may increase relative forecast errors (MAPE).' }
            : {}),
    };
    return {
        domain,
        status: 'completed',
        modelVersion: FORECAST_MODEL_VERSION,
        generatedAt: nowIso,
        observationWindow,
        horizons,
        backtestEvaluation,
        dataLimitations: [
            'Forecasts represent statistical trend projections, not guaranteed commercial outcomes.',
            'Exogenous algorithmic changes (e.g. Google core updates) are non-stationary and cannot be fully predicted.',
            '95% confidence intervals expand over longer horizons (90 and 180 days) reflecting compound uncertainty.',
        ],
        provenance: FORECAST_PROVENANCE,
    };
}
