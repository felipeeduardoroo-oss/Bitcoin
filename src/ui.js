// ================================================================
// UI.JS — Toda renderização DOM: Score, Candles, Tables, Toast, Header
// ================================================================
import { MAX_SCORE_HISTORY } from './config.js';
import { SUMMARY_PAIRS, MTF_INTERVALS } from './config.js';
import { telegramStatus, currentRegime } from './state.js';
import { checkAdditionalAlerts } from './engine.js';
import { fetchCandles } from './api.js';

// ----------------------------------------------------------------
// HELPERS DE UI
// ----------------------------------------------------------------
export function updateSourceTimestamp(id) {
    const el = document.getElementById(id); if (!el) return;
    if (!el.dataset.base) el.dataset.base = el.textContent.replace(/•.*$/, '').trim();
    el.textContent = el.dataset.base + ' • ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function updateLiveTime() {
    const el = document.getElementById('live-update-time');
    if (el) el.textContent = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const b = document.getElementById('status-badge');
    if (b) { b.textContent = 'LIVE'; b.className = 'status-badge live'; }
}

export function updateTimestamp() {
    const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const el1 = document.getElementById('header-timestamp'); if (el1) el1.textContent = ts;
    const el2 = document.getElementById('last-update'); if (el2) el2.textContent = ts;
}

export function updateRegimeDisplay(regime) {
    const el = document.getElementById('header-regime');
    if (el) { el.textContent = 'REGIME: ' + regime; el.className = 'badge badge-regime ' + regime.toLowerCase(); }
}

export function updateTelegramStatus() {
    const on = telegramStatus === 'online';
    const d = document.getElementById('telegram-status-dot');
    const b = document.getElementById('telegram-badge');
    const t = document.getElementById('telegram-status-text');
    if (d) { d.className = 'telegram-status ' + (on ? 'online' : 'offline'); }
    if (b) b.className = 'telegram-badge' + (on ? '' : ' error');
    if (t) t.textContent = on ? '🟢 Conectado' : '🔴 Desconectado';
}

// ----------------------------------------------------------------
// TOAST SYSTEM
// ----------------------------------------------------------------
export function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container'); if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, duration);
}

// ----------------------------------------------------------------
// SCORE DISPLAY + HISTORY CHART
// ----------------------------------------------------------------
let scoreHistory = [];
let scoreChart = null;
let currentScoreTimeframe = '1h';

const thresholdPlugin = {
    id: 'thresholdLines',
    beforeDraw(chart) {
        const yS = chart.scales.y; if (!yS) return; const ctx = chart.ctx;
        [25, 75].forEach(v => {
            const y = yS.getPixelForValue(v); const isShort = v === 25;
            ctx.save(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
            ctx.strokeStyle = isShort ? 'rgba(233,69,96,0.5)' : 'rgba(0,217,142,0.5)';
            ctx.beginPath(); ctx.moveTo(chart.chartArea.left, y); ctx.lineTo(chart.chartArea.right, y); ctx.stroke();
            ctx.fillStyle = isShort ? 'rgba(233,69,96,0.7)' : 'rgba(0,217,142,0.7)';
            ctx.font = '10px sans-serif';
            ctx.fillText(isShort ? 'SHORT (25)' : 'LONG (75)', chart.chartArea.right - 80, y - 6);
            ctx.restore();
        });
    }
};

export function initScoreChart() {
    if (window.ChartError || typeof Chart === 'undefined') return;
    const canvas = document.getElementById('scoreHistoryChart'); if (!canvas) return;
    scoreChart = new Chart(canvas, {
        type: 'line',
        data: { datasets: [{ label: 'Score', data: [], borderColor: '#00b4d8', backgroundColor: 'rgba(0,180,216,0.1)', borderWidth: 2, fill: true, tension: 0.3, pointRadius: 1, pointHoverRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => 'Score: ' + c.parsed.y.toFixed(0), title: i => new Date(i[0].parsed.x).toLocaleString('pt-BR') } } }, scales: { x: { type: 'linear', grid: { color: 'rgba(44,62,80,0.3)' }, ticks: { color: '#95a5a6', maxTicksLimit: 12, callback: v => new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } }, y: { min: 0, max: 100, grid: { color: 'rgba(44,62,80,0.3)' }, ticks: { color: '#95a5a6' } } } },
        plugins: [thresholdPlugin]
    });
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('#score-tf-buttons .tf-btn'); if (!btn) return;
        btn.closest('#score-tf-buttons').querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentScoreTimeframe = btn.dataset.tf || '1h';
        updateScoreChart();
    });
}

function updateScoreChart() {
    if (!scoreChart) return;
    const msMap = { '1h': 36e5, '6h': 216e5, '12h': 432e5, '24h': 864e5, '7d': 6048e5 };
    let f = scoreHistory.filter(p => p.time >= Date.now() - (msMap[currentScoreTimeframe] || 864e5));
    if (f.length > 300) { const step = Math.ceil(f.length / 300); f = f.filter((_, i) => i % step === 0); }
    scoreChart.data.datasets[0].data = f.map(p => ({ x: p.time, y: p.score }));
    scoreChart.update('none');
}

export function updateScoreDisplay(scoreData) {
    const { score, components } = scoreData;
    const color = score >= 75 ? 'var(--accent-green)' : score <= 25 ? 'var(--accent-red)' : 'var(--accent-yellow)';
    const sv = document.getElementById('score-value'); if (sv) { sv.textContent = score; sv.style.color = color; }
    const sb = document.getElementById('score-bar'); if (sb) { sb.style.width = score + '%'; sb.style.background = color; }
    const bar = sb?.parentElement; if (bar) bar.setAttribute('aria-valuenow', score);

    const map = { 'score-trend': components.trend, 'score-momentum': components.momentum, 'score-structure': components.structure, 'score-onchain': components.onchain, 'score-volume': components.volume, 'score-oi': components.oi };
    for (const [id, v] of Object.entries(map)) { const el = document.getElementById(id); if (el) el.textContent = v; }

    scoreHistory.push({ time: Date.now(), score });
    if (scoreHistory.length > MAX_SCORE_HISTORY) scoreHistory.splice(0, scoreHistory.length - MAX_SCORE_HISTORY);
    updateScoreChart();
    checkAdditionalAlerts(score);
}

// ----------------------------------------------------------------
// CANDLESTICK CHARTS — LW Charts
// ----------------------------------------------------------------
const candleCharts = {};
const mtfCandleCharts = {};

function createLWChart(containerId, upColor) {
    if (window.LWChartError || typeof LightweightCharts === 'undefined') {
        const c = document.getElementById(containerId); if (c) c.innerHTML = '<div class="chart-fallback">Indisponivel</div>';
        return null;
    }
    const c = document.getElementById(containerId); if (!c) return null;
    const chart = LightweightCharts.createChart(c, {
        width: c.clientWidth, height: 250,
        layout: { background: { color: '#1a1a2e' }, textColor: '#95a5a6' },
        grid: { vertLines: { color: '#2c3e50' }, horzLines: { color: '#2c3e50' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        timeScale: { borderColor: '#2c3e50', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({ upColor: upColor || '#00d98e', downColor: '#e94560', borderDownColor: '#e94560', borderUpColor: upColor || '#00d98e', wickDownColor: '#e94560', wickUpColor: upColor || '#00d98e' });
    if (window.ResizeObserver) new ResizeObserver(entries => { if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width }); }).observe(c);
    return { chart, series };
}

export async function updateSummaryCandles() {
    for (const p of SUMMARY_PAIRS) {
        try {
            if (!candleCharts[p.id]) { const o = createLWChart(p.id, p.color); if (o) candleCharts[p.id] = o; else continue; }
            const data = await fetchCandles(p.symbol, '1h', 24);
            if (data?.length) { candleCharts[p.id].series.setData(data.map(c => ({ time: c.time / 1000, open: c.open, high: c.high, low: c.low, close: c.close }))); candleCharts[p.id].chart.timeScale().fitContent(); }
            const daily = await fetchCandles(p.symbol, '1d', 31);
            if (daily?.length > 1) {
                const closes = daily.map(d => d.close), cur = closes[closes.length - 1];
                for (const [key, idx] of Object.entries({ '1d': -2, '1s': -8, '1m': -31 })) {
                    const ref = closes[closes.length + idx]; if (!ref || ref <= 0) continue;
                    const pct = ((cur - ref) / ref) * 100;
                    const el = document.getElementById(p.prefix + '-stat-' + key);
                    if (el) { el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'; el.className = 'stat ' + (pct >= 0 ? 'positive' : 'negative'); }
                }
            }
        } catch (_) {}
    }
}

export async function initMTFCharts() {
    for (const iv of MTF_INTERVALS) {
        const data = await fetchCandles('BTCUSDT', iv, 50);
        if (data) { const o = createLWChart('chart-' + iv, '#00d98e'); if (o) { o.series.setData(data.map(c => ({ time: c.time / 1000, open: c.open, high: c.high, low: c.low, close: c.close }))); o.chart.timeScale().fitContent(); mtfCandleCharts[iv] = o; } }
    }
}

export async function updateMTFCharts() {
    for (const iv of MTF_INTERVALS) {
        if (!mtfCandleCharts[iv]) continue;
        const data = await fetchCandles('BTCUSDT', iv, 50);
        if (data) mtfCandleCharts[iv].series.setData(data.map(c => ({ time: c.time / 1000, open: c.open, high: c.high, low: c.low, close: c.close })));
    }
}

// ----------------------------------------------------------------
// HEADER UI
// ----------------------------------------------------------------
export function updateHeaderUI(ticker) {
    if (!ticker) return;
    const priceEl = document.getElementById('btc-price');
    if (priceEl) priceEl.textContent = '$' + Number(parseFloat(ticker.lastPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const changeEl = document.getElementById('btc-change');
    if (changeEl) { const ch = parseFloat(ticker.priceChangePercent); changeEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'; changeEl.className = 'badge ' + (ch >= 0 ? 'sentiment-bullish' : 'sentiment-bearish'); }
}
