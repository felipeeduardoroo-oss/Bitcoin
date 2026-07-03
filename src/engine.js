// ================================================================
// ENGINE.JS — Indicadores, Regime, Score, Sinais, Kelly, Optimizer
// ================================================================
import { CAPITAL, ALERT_COOLDOWN, REGIME_WEIGHTS, EMA50_HISTORY_MAX } from './config.js';
import { globalData, currentRegime, candleHistory, ema50History, fundingHistory, alertLog, tradeHistory, filterWeights, lastAlertTime, lastScore, previousScore } from './state.js';
import { sendTelegramAlert, sendStructuredAlert } from './telegram.js';
import { calculateKellySizing } from './utils/kelly.js';

// ================================================================
// INDICADORES PUROS
// ================================================================
export function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

export function calculateEMA(data, period) {
    if (!data || data.length < period) return null;
    const m = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) ema = (data[i] - ema) * m + ema;
    return ema;
}

export function calculateRSI(data, period = 14) {
    if (!data || data.length < period + 1) return 50;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) { const d = data[i] - data[i - 1]; if (d >= 0) g += d; else l -= d; }
    let ag = g / period, al = l / period;
    for (let i = period + 1; i < data.length; i++) {
        const d = data[i] - data[i - 1];
        if (d >= 0) { ag = (ag * (period - 1) + d) / period; al = (al * (period - 1)) / period; }
        else { ag = (ag * (period - 1)) / period; al = (al * (period - 1) - d) / period; }
    }
    return al === 0 ? 100 : 100 - (100 / (1 + ag / al));
}

export function calculateMACD(data, fast = 12, slow = 26) {
    if (!data || data.length < slow) return null;
    const ef = calculateEMA(data, fast), es = calculateEMA(data, slow);
    return (ef !== null && es !== null) ? ef - es : null;
}

export function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return candles ? candles[candles.length - 1].close * 0.02 : 1200;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += candles[i].high - candles[i].low;
    return sum / period;
}

export function calculateOBV(candles) {
    if (!candles || candles.length < 2) return 0;
    let obv = 0;
    for (let i = 1; i < candles.length; i++) {
        const c = candles[i].close, pc = candles[i - 1].close, v = candles[i].volume || 0;
        if (c > pc) obv += v; else if (c < pc) obv -= v;
    }
    return obv;
}

export function calculateBollingerBandWidth(candles, period = 20, mult = 2) {
    if (!candles || candles.length < period) return 0;
    const c = candles.slice(-period).map(x => x.close);
    const sma = c.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(c.reduce((a, b) => a + (b - sma) ** 2, 0) / period);
    return sma > 0 ? (2 * mult * std) / sma : 0;
}

// ================================================================
// REGIME DETECTION
// ================================================================
export function detectMarketRegime(price, ema50, ema50Prev, ema200, adx) {
    const slope = ema50Prev > 0 ? (ema50 - ema50Prev) / ema50Prev : 0;
    if (price > ema50 && ema50 > ema200 && slope > 0.0005 && adx > 25) return 'BULL';
    if (price < ema50 && ema50 < ema200 && slope < -0.0005 && adx > 25) return 'BEAR';
    return 'RANGE';
}

export function choppinessIndex(candles, period = 14) {
    if (!candles || candles.length < period) return 100;
    const s = candles.slice(-period);
    const atr = calculateATR(s, period);
    const range = Math.max(...s.map(c => c.high)) - Math.min(...s.map(c => c.low));
    return range === 0 ? 100 : 100 * Math.log10(atr / range) / Math.log10(period);
}

export function getTrendStrength(candles) {
    if (!candles || candles.length < 20) return { adx: 20, slope: 0, trending: false };
    const closes = candles.map(d => d.close);
    const g = [], l = [];
    for (let i = 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g.push(d); else l.push(-d); }
    const p = 14, ag = g.slice(-p).reduce((a, b) => a + b, 0) / p, al = l.slice(-p).reduce((a, b) => a + b, 0) / p;
    const rs = al === 0 ? 100 : ag / al;
    const adx = Math.min(100, (rs / (1 + rs)) * 100);
    const e20 = calculateEMA(closes, 20), e50 = calculateEMA(closes, 50);
    const slope = e20 && e50 ? (e20 - e50) / e50 * 100 : 0;
    return { adx, slope, trending: adx > 25 && Math.abs(slope) > 0.5 };
}

// ================================================================
// SUPORTE / RESISTÊNCIA / ESTRUTURA
// ================================================================
export function getHorizontalSR(candles) {
    if (!candles || candles.length < 24) return { support: 58000, resistance: 70000 };
    const d = candles.slice(-24), w = candles.slice(-168), m = candles.slice(-720);
    return {
        support: Math.min(
            Math.min(...d.map(c => c.low)),
            w.length ? Math.min(...w.map(c => c.low)) : Infinity,
            m.length ? Math.min(...m.map(c => c.low)) : Infinity
        ),
        resistance: Math.max(
            Math.max(...d.map(c => c.high)),
            w.length ? Math.max(...w.map(c => c.high)) : 0,
            m.length ? Math.max(...m.map(c => c.high)) : 0
        )
    };
}

export function getDynamicLevels(candles) {
    if (!candles || candles.length < 20) return { support: 58000, resistance: 70000 };
    const s = candles.slice(-20);
    return { support: Math.min(...s.map(c => c.low)), resistance: Math.max(...s.map(c => c.high)) };
}

export function detectStructureBreak(candles, lb = 10) {
    if (!candles || candles.length < lb + 2) return { type: null, level: null };
    const prev = candles.slice(-lb - 1, -1), cur = candles[candles.length - 1];
    const sh = Math.max(...prev.map(c => c.high)), sl = Math.min(...prev.map(c => c.low));
    if (cur.close > sh) return { type: 'BOS_UP', level: sh };
    if (cur.close < sl) return { type: 'BOS_DOWN', level: sl };
    return { type: null, level: null };
}

export function getPriceActionScore(candles, signal) {
    const sb = detectStructureBreak(candles, 10);
    if (signal === 'LONG' && sb.type === 'BOS_UP') return 80;
    if (signal === 'SHORT' && sb.type === 'BOS_DOWN') return 80;
    return sb.type === null ? 45 : 25;
}

// ================================================================
// MTF, DIVERGÊNCIAS, FUNDING Z-SCORE
// ================================================================
export function getTrendEMA(candles) {
    if (!candles || candles.length < 50) return 0;
    const c = candles.map(d => d.close), e50 = calculateEMA(c, 50), e200 = calculateEMA(c, 200);
    return (e50 !== null && e200 !== null) ? (e50 > e200 ? 1 : -1) : 0;
}

export function checkMTFAlignment(mtf, signal) {
    if (!mtf?.c1h?.length || !mtf?.c4h?.length || !mtf?.c1d?.length) return { aligned: false };
    const t1 = getTrendEMA(mtf.c1h), t4 = getTrendEMA(mtf.c4h), td = getTrendEMA(mtf.c1d);
    if (!t1 || !t4 || !td) return { aligned: false };
    if (t1 !== t4 || t4 !== td) return { aligned: false };
    if ((signal === 'LONG' && t1 === 1) || (signal === 'SHORT' && t1 === -1)) return { aligned: true };
    return { aligned: false };
}

export function detectDivergenceClassic(candles, indVals, signal, atr) {
    if (!candles || !indVals || candles.length < 10) return false;
    const pr = Math.max(...candles.map(c => c.high)) - Math.min(...candles.map(c => c.low));
    const ap = atr / (pr || 1);
    let p = ap > 0.03 ? 3 : ap > 0.015 ? 5 : 7;
    p = Math.min(p, Math.floor(candles.length / 2));
    if (candles.length < p * 2) return false;
    const rc = candles.slice(-p), ri = indVals.slice(-p);
    const pc = candles.slice(-(p * 2), -p), pi = indVals.slice(-(p * 2), -p);
    if (!pc.length || !pi.length) return false;
    if (signal === 'LONG') return Math.min(...rc.map(c => c.low)) < Math.min(...pc.map(c => c.low)) && Math.min(...ri) > Math.min(...pi);
    if (signal === 'SHORT') return Math.max(...rc.map(c => c.high)) > Math.max(...pc.map(c => c.high)) && Math.max(...ri) < Math.max(...pi);
    return false;
}

export function detectDivergenceMulti(candles, rsiV, macdV, obvV, signal, atr) {
    if (!candles || candles.length < 20) return 0;
    const cnt = [detectDivergenceClassic(candles, rsiV, signal, atr), detectDivergenceClassic(candles, macdV, signal, atr), detectDivergenceClassic(candles, obvV, signal, atr)].filter(Boolean).length;
    let s = cnt >= 2 ? 30 : cnt === 1 ? 15 : 0;
    if (signal === 'LONG' && detectDivergenceClassic(candles, rsiV, 'SHORT', atr)) s -= 40;
    if (signal === 'SHORT' && detectDivergenceClassic(candles, rsiV, 'LONG', atr)) s -= 40;
    return clamp(s, -40, 40);
}

export function getFundingZScore(currentFunding, fHist) {
    if (!fHist || fHist.length < 10) return 0;
    const vals = fHist.map(f => f.fundingRate);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return std === 0 ? 0 : (currentFunding - mean) / std;
}

export function classifyOIRisk(oiDelta, priceDelta) {
    if (oiDelta > 10 && priceDelta > 1) return 'HEALTHY_LONG';
    if (oiDelta > 10 && priceDelta < -1) return 'SQUEEZE_SHORT';
    if (oiDelta > 10 && Math.abs(priceDelta) <= 1) return 'SQUEEZE_LONG';
    return 'NEUTRAL';
}

export function predictDirectionV3(data) {
    const rsiS = data.rsi ? (data.rsi - 50) / 50 : 0;
    const fS = data.fundingRate ? -data.fundingRate * 10000 : 0;
    const mS = data.mvrv ? (1 - data.mvrv) * 2 : 0;
    return clamp(0.5 + 0.1 * rsiS + 0.1 * fS + 0.1 * mS, 0, 1);
}

// ================================================================
// SINAIS POR REGIME
// ================================================================
export function getRegimeAwareSignal(data, regime) {
    if (regime === 'RANGE') {
        const range = data.resistance - data.support;
        if (range <= 0) return 'NEUTRAL';
        const pos = (data.price - data.support) / range;
        if (pos < 0.15 && data.rsi < 35) return 'LONG';
        if (pos > 0.85 && data.rsi > 65) return 'SHORT';
        return 'NEUTRAL';
    }
    const dist = data.ema50 ? Math.abs(data.price - data.ema50) / data.ema50 * 100 : 100;
    const pullback = dist < 2;
    if (regime === 'BULL' && pullback && data.rsi > 45 && data.rsi < 65) return 'LONG';
    if (regime === 'BEAR' && pullback && data.rsi < 55 && data.rsi > 35) return 'SHORT';
    return 'NEUTRAL';
}

// ================================================================
// CONFIRMAÇÃO DE SINAL V13
// ================================================================
export async function confirmSignalV13(signal, data, candles, rsiVals, macdVals, obvVals, mtfData, isBacktest = false) {
    if (!signal || signal === 'NEUTRAL') return { approved: false, score: 0, reasons: ['Neutro'], regime: currentRegime, required: 60, scoreComponents: {}, volatilityRegime: 'NORMAL', support: data.support, resistance: data.resistance };

    const now = Date.now();
    const hour = new Date().getUTCHours(), day = new Date().getUTCDay();
    if (!isBacktest && hour >= 0 && hour < 2) return { approved: false, score: 0, reasons: ['Madrugada UTC'], regime: currentRegime, required: 60, scoreComponents: {}, volatilityRegime: 'NORMAL' };

    const closes = candles.map(c => c.close);
    const ema50 = calculateEMA(closes, 50) || data.price;
    const ema200 = calculateEMA(closes, 200) || data.price;
    const ts = getTrendStrength(candles);
    const atr = data.atr || calculateATR(candles) || data.price * 0.02;

    const regime = detectMarketRegime(data.price, ema50, data.ema50Prev || ema50, ema200, ts.adx);

    if (!isBacktest && regime === 'RANGE') {
        const ci = choppinessIndex(candles, 14);
        if (ci > 60) return { approved: false, score: 0, reasons: ['Choppiness ' + ci.toFixed(0) + '% > 60'], regime, required: 75, scoreComponents: {}, volatilityRegime: 'NORMAL' };
    }

    const bbW = calculateBollingerBandWidth(candles);
    let volRegime = 'NORMAL';
    if (bbW > 0 && bbW < 0.05) volRegime = 'SQUEEZE';
    else if (bbW > 0.15) volRegime = 'HIGH';
    else if (bbW <= 0.08) volRegime = 'LOW';

    // Filtro de volume
    if (data.volume && data.avgVolume) {
        const vr = data.volume / data.avgVolume;
        const threshold = isBacktest ? 0.8 : 1.0;
        if (vr < threshold) return { approved: false, score: 0, reasons: ['Volume baixo ' + vr.toFixed(2)], regime, required: 65, scoreComponents: {}, volatilityRegime: volRegime };
    }

    // MTF penalty
    let mtfPenalty = 0;
    if (mtfData && !isBacktest) {
        if (!checkMTFAlignment(mtfData, signal).aligned) mtfPenalty = -15;
    } else if (isBacktest) {
        mtfPenalty = -5;
    }

    // Calcular scores parciais
    const paScore = getPriceActionScore(candles, signal);
    const rsi = data.rsi || 50;
    let momScore = 50;
    if ((signal === 'LONG' && rsi > 70) || (signal === 'SHORT' && rsi < 30)) momScore = 35;
    else if ((signal === 'LONG' && rsi > 50) || (signal === 'SHORT' && rsi < 50)) momScore = 65;

    let macroScore = 50;
    if (data.mvrv < 0.85 && data.sopr < 0.9) macroScore = 75;
    else if (data.mvrv > 1.3 && data.sopr > 1.1) macroScore = 25;

    let mtfScore = 50;
    if (mtfData) mtfScore = checkMTFAlignment(mtfData, signal).aligned ? 85 : 20;

    let volScore = 50;
    if (data.volume && data.avgVolume) { const vr = data.volume / data.avgVolume; volScore = vr > 1.5 ? 70 : vr > 1.0 ? 60 : 40; }

    const fZ = getFundingZScore(data.fundingRate || 0, fundingHistory);
    let fundScore = 50;
    if (signal === 'LONG' && fZ < -2) fundScore = 75;
    else if (signal === 'SHORT' && fZ > 2) fundScore = 75;
    else if (signal === 'LONG' && fZ > 2) fundScore = 30;
    else if (signal === 'SHORT' && fZ < -2) fundScore = 30;

    const oiRisk = classifyOIRisk(data.oiDelta || 0, data.priceDeltaPct || 0);
    let oiScore = 50;
    if (signal === 'LONG' && oiRisk === 'HEALTHY_LONG') oiScore = 80;
    else if (signal === 'SHORT' && oiRisk === 'SQUEEZE_SHORT') oiScore = 80;
    else if (signal === 'LONG' && oiRisk === 'SQUEEZE_LONG') oiScore = 30;

    let divScore = 50;
    if (candles?.length > 0 && rsiVals?.length > 0) {
        divScore = clamp(50 + detectDivergenceMulti(candles, rsiVals, macdVals, obvVals, signal, atr), 20, 90);
    }

    let trendScore = 50;
    if (candles?.length > 0) {
        if (ts.trending && ts.adx > 40) trendScore = 80;
        else if (ts.trending) trendScore = 70;
        else if (ts.adx < 20) trendScore = 30;
    }

    const mlScore = 20 + predictDirectionV3(data) * 60;
    const scores = { price_action: paScore, momentum: momScore, macro_crypto: macroScore, liquidity_spread: 50, ml_probability: mlScore, mtf_alignment: mtfScore, volume_liquidity: volScore, funding_onchain: fundScore, divergence_penalty: divScore, trend_strength: trendScore };

    const w = filterWeights;
    let finalScore = 0;
    for (const [k, weight] of Object.entries(w)) finalScore += (scores[k] || 50) * weight;
    finalScore = clamp(finalScore + mtfPenalty, 0, 100);

    const required = isBacktest ? 50 : (regime === 'RANGE' ? 75 : 65);

    return {
        approved: finalScore >= required,
        score: Math.round(finalScore),
        reasons: ['PA:' + paScore, 'Tr:' + trendScore, 'Mo:' + momScore, 'Vol:' + volScore, 'MTF:' + mtfScore, 'OI:' + oiScore],
        regime, required, scoreComponents: scores,
        volatilityRegime: volRegime,
        support: data.support, resistance: data.resistance
    };
}

// ================================================================
// STOPS E TARGETS V8
// ================================================================
export function getStopLossV8(regime, atr, price, side, support, resistance) {
    const mult = regime === 'RANGE' ? 1.5 : 2.5;
    let stop = side === 'LONG' ? price - atr * mult : price + atr * mult;
    if (side === 'LONG' && support && stop < support) stop = support * 0.995;
    if (side === 'SHORT' && resistance && stop > resistance) stop = resistance * 1.005;
    return stop;
}

export function generateScaledTargetsV8(entry, stop, signalType, volRegime, regime) {
    const risk = Math.abs(entry - stop);
    const p = regime === 'RANGE' ? { tp1: 1.5, tp2: 2.5, tp3: 3.5 } : { tp1: 2.0, tp2: 3.5, tp3: 5.0 };
    const configs = [
        { rr: p.tp1, size: regime === 'RANGE' ? 0.30 : 0.30, label: 'TP1' },
        { rr: p.tp2, size: regime === 'RANGE' ? 0.70 : 0.30, label: 'TP2' },
        { rr: p.tp3, size: regime === 'RANGE' ? 0 : 0.40, label: 'TP3' }
    ];
    return configs.filter(c => c.size > 0).map(c => {
        const raw = signalType === 'LONG' ? entry + c.rr * risk : entry - c.rr * risk;
        return { label: c.label, price: raw, size: c.size, rr: c.rr };
    });
}

// ================================================================
// OTIMIZAÇÃO DE PESOS (Simulated Annealing) — sem Kelly aqui
// ================================================================
function evalWeights(weights, dataset) {
    const names = Object.keys(filterWeights);
    let correct = 0;
    for (const trade of dataset) {
        const f = trade.features || {}; let score = 0;
        names.forEach((n, i) => { score += (f[n] || 50) * weights[i]; });
        score = clamp(score, 0, 100);
        if ((score >= 55 ? 1 : 0) === (trade.outcome ? 1 : 0)) correct++;
    }
    return dataset.length > 0 ? correct / dataset.length : 0;
}

export function optimizeWeights(history) {
    if (history.length < 30) return null;
    const sh = [...history].sort(() => Math.random() - 0.5);
    const ti = Math.floor(sh.length * 0.7), train = sh.slice(0, ti), val = sh.slice(ti);
    const names = Object.keys(filterWeights);
    let rawInit = names.map(n => filterWeights[n] || 0.1);
    const sumInit = rawInit.reduce((a, b) => a + b, 0);
    let bestW = rawInit.map(w => w / sumInit);
    let bestScore = evalWeights(bestW, train);
    let curW = [...bestW], curScore = bestScore;
    for (let i = 0; i < 100; i++) {
        const temp = 1 - i / 100;
        const nb = curW.map(w => clamp(w + (Math.random() - 0.5) * 0.05 * (temp + 0.05), 0.01, 0.5));
        const ns = nb.reduce((a, b) => a + b, 0);
        const norm = nb.map(w => w / ns);
        const nScore = evalWeights(norm, train);
        if (nScore > curScore || Math.random() < Math.exp((nScore - curScore) / (temp + 0.001))) {
            curW = norm; curScore = nScore;
            if (nScore > bestScore) { bestW = [...norm]; bestScore = nScore; }
        }
    }
    if (evalWeights(bestW, val) < bestScore * 0.85) console.warn('Overfitting detectado nos pesos');
    const result = {}; names.forEach((n, i) => result[n] = bestW[i]);
    return result;
}

export function updateFilterWeights() {
    if (tradeHistory.length < 50) return;
    const nw = optimizeWeights(tradeHistory.slice(-50));
    if (nw) { Object.assign(filterWeights, nw); try { localStorage.setItem('filterWeightsV6', JSON.stringify(filterWeights)); } catch (_) {} }
}

export function loadWeights() {
    try {
        const s = localStorage.getItem('filterWeightsV6'); if (!s) return;
        const p = JSON.parse(s); if (!p || typeof p !== 'object' || Array.isArray(p)) return;
        for (const k of Object.keys(filterWeights)) if (typeof p[k] === 'number' && p[k] > 0) filterWeights[k] = p[k];
    } catch (_) { localStorage.removeItem('filterWeightsV6'); }
}

export function loadAlertLog() {
    try {
        const s = localStorage.getItem('alertLog'); if (!s) return;
        const p = JSON.parse(s); if (!Array.isArray(p)) return;
        alertLog.length = 0; alertLog.push(...p.filter(t => t && typeof t === 'object' && typeof t.timestamp === 'number'));
    } catch (_) { alertLog.length = 0; localStorage.removeItem('alertLog'); }
}

// ================================================================
// SCORE INSTITUCIONAL V13 (com regime weights + adaptação por histórico)
// ================================================================
export function computeScore(data) {
    const hist = alertLog.filter(t => t.win !== null);
    let cw = { trend: 0.25, momentum: 0.20, structure: 0.15, onchain: 0.10, volume: 0.15, oi: 0.15 };
    if (hist.length > 20) {
        const comps = ['trend', 'momentum', 'structure', 'onchain', 'volume', 'oi'];
        const stats = {}; comps.forEach(c => stats[c] = { w: 0, l: 0 });
        hist.forEach(t => { if (!t.components) return; const win = t.win; comps.forEach(k => { if (stats[k]) { if (win) stats[k].w++; else stats[k].l++; } }); });
        let total = 0; const nw = {};
        comps.forEach(k => { const s = stats[k]; const wr = (s.w + s.l > 0) ? s.w / (s.w + s.l) : 0.5; nw[k] = wr; total += wr; });
        if (total > 0) comps.forEach(k => cw[k] = nw[k] / total);
    }

    const dw = REGIME_WEIGHTS[currentRegime] || REGIME_WEIGHTS.BULL;
    const weights = { trend: dw.trend, momentum: dw.momentum, structure: dw.structure, onchain: dw.onChain, volume: dw.volume, oi: dw.oi };

    const price = data.price || 60000, ema50 = data.ema50 || 65000, ema200 = data.ema200 || 62000;
    const rsi = data.rsi !== undefined ? data.rsi : 45, macd = data.macd || 120, macdSignal = data.macdSignal || 100;
    const roc = data.roc || -2.5, support = data.support || 58000, resistance = data.resistance || 70000;
    const fvgZones = data.fvgZones || [], mvrv = data.mvrv || 1.2, sopr = data.sopr || 0.95;
    const volumeRel = data.volumeRel || 1.0, oiDelta = data.oiDelta || 0.0;

    const t = (ema50 > ema200) ? 1 : -1;
    const m = (clamp((rsi - 30) / 40, 0, 1) + clamp(((macd - macdSignal) / 200) + 0.5, 0, 1) + clamp((roc / 100) + 0.5, 0, 1)) / 3;
    const range = resistance - support;
    let se = 1 - clamp(range > 0 ? (price - support) / range : 0.5, 0, 1);
    if (fvgZones.some(f => price >= f.low && price <= f.high)) se = Math.min(se + 0.2, 1);
    const o = ((1 - clamp((mvrv - 1) / 3, 0, 1)) + clamp(sopr - 0.5, 0, 1)) / 2;
    const vol = (clamp((volumeRel - 0.5) * 2, -1, 1) + 1) / 2;
    const oi = (clamp(oiDelta / 20, -1, 1) + 1) / 2;

    let raw = t * weights.trend + m * weights.momentum + se * weights.structure + o * weights.onchain + vol * weights.volume + oi * weights.oi;
    if (Math.abs(oiDelta) > 10) raw -= 0.10;
    const finalScore = clamp((raw + 1) / 2, 0, 1) * 100;

    return {
        score: Math.round(finalScore),
        components: {
            trend: (t * 50 + 50).toFixed(1), momentum: (m * 50 + 50).toFixed(1),
            structure: (se * 50 + 50).toFixed(1), onchain: (o * 50 + 50).toFixed(1),
            volume: (vol * 50 + 50).toFixed(1), oi: (oi * 50 + 50).toFixed(1)
        }
    };
}

// ================================================================
// PROCESSAR INDICADORES — chamado pelo fastLoop
// ================================================================
export function processIndicators() {
    if (candleHistory.length < 50) return;
    const closes = candleHistory.map(c => c.close);
    const price = closes[closes.length - 1];
    const ema50 = calculateEMA(closes, 50) || price;
    const ema200 = calculateEMA(closes, 200) || price;
    const ema50Prev = ema50History.length >= 2 ? ema50History[ema50History.length - 2] : ema50;
    const ts = getTrendStrength(candleHistory);

    globalData.price = price;
    globalData.ema50 = ema50;
    globalData.ema200 = ema200;
    globalData.ema50Prev = ema50Prev;
    globalData.rsi = calculateRSI(closes, 14);
    globalData.macd = calculateMACD(closes) || 0;
    globalData.atr = calculateATR(candleHistory);
    globalData.adx = ts.adx;
    globalData.volume = candleHistory[candleHistory.length - 1]?.volume || 0;
    globalData.avgVolume = candleHistory.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20;
    globalData.volumeRel = globalData.avgVolume > 0 ? globalData.volume / globalData.avgVolume : 1;

    const sr = getHorizontalSR(candleHistory);
    globalData.support = sr.support || 58000;
    globalData.resistance = sr.resistance || 70000;

    const regime = detectMarketRegime(price, ema50, ema50Prev, ema200, ts.adx);
    return regime;
}

// ================================================================
// ALERTAS ADICIONAIS
// ================================================================
export function checkAdditionalAlerts(score) {
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN) return;
    const price = globalData.price || 60000;
    const ts = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (previousScore < 50 && score >= 50) { sendTelegramAlert('🔄 <b>MUDANCA DE TENDENCIA</b>\nScore: ' + previousScore + ' → ' + score + '\n💰 BTC: $' + price.toFixed(2) + '\n⏰ ' + ts()); lastAlertTime = now; }
    else if (previousScore > 50 && score <= 50) { sendTelegramAlert('🔄 <b>MUDANCA DE TENDENCIA</b>\nScore: ' + previousScore + ' → ' + score + '\n💰 BTC: $' + price.toFixed(2) + '\n⏰ ' + ts()); lastAlertTime = now; }
    if (previousScore - score >= 20) { sendTelegramAlert('⚠️ <b>RISCO ELEVADO</b>\nScore caiu ' + (previousScore - score) + ' pts\n💰 BTC: $' + price.toFixed(2) + '\n⏰ ' + ts()); lastAlertTime = now; }
    if (score <= 20) { sendTelegramAlert('🔴 <b>SAIDA TOTAL</b>\nScore: ' + score + '\n💰 BTC: $' + price.toFixed(2) + '\n⏰ ' + ts()); lastAlertTime = now; }
    if (score >= 85) { sendTelegramAlert('🟢 <b>SINAL FORTE</b>\nScore: ' + score + ' | Regime: ' + currentRegime + '\n💰 BTC: $' + price.toFixed(2) + '\n⏰ ' + ts()); lastAlertTime = now; }

    previousScore = score;
}
