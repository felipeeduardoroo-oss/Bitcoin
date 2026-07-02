import { FAST_INTERVAL, SLOW_INTERVAL, CANDLE_INTERVAL, EMA50_HISTORY_MAX } from './config.js';
import { globalData, ema50History, lastScore, setLastScore } from './state.js';
import { fetchCandles, fetchTickerData, slowLoop, sendTestAlert } from './api.js';
import { processIndicators, computeScore, loadWeights, loadAlertLog, checkAdditionalAlerts } from './engine.js';
import { updateScoreDisplay, initScoreChart, updateSummaryCandles, initMTFCharts, updateMTFCharts, updateHeaderUI, updateTelegramStatus, updateTimestamp, updateLiveTime, updateRegimeDisplay } from './ui.js';
import { runBacktest } from './backtest.js';
import { initStaticCharts } from './charts-static.js';

let isUpdating = false;

async function fastLoop() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const ticker = await fetchTickerData();
        if (ticker) {
            updateHeaderUI(ticker);
            globalData.price = parseFloat(ticker.lastPrice) || globalData.price;
            globalData.priceDeltaPct = parseFloat(ticker.priceChangePercent) || 0;
        }

        const candles = await fetchCandles('BTCUSDT', '1h', 100);
        if (candles?.length > 0) {
            const regime = processIndicators();

            if (globalData.ema50) {
                ema50History.push(globalData.ema50);
                if (ema50History.length > EMA50_HISTORY_MAX) ema50History.shift();
            }

            updateRegimeDisplay(regime);
            const sd = computeScore(globalData);
            updateScoreDisplay(sd);
            setLastScore(sd.score);
        }

        updateMTFCharts();
    } catch (e) { console.error('Fast loop error:', e); }
    isUpdating = false;
}

function initApp() {
    console.log('BTC Analyzer v13 — Inicializando...');
    loadWeights();
    loadAlertLog();
    initStaticCharts();
    initScoreChart();
    updateSummaryCandles();
    initMTFCharts();

    fastLoop();
    slowLoop();

    setInterval(fastLoop, FAST_INTERVAL);
    setInterval(slowLoop, SLOW_INTERVAL);
    setInterval(updateSummaryCandles, CANDLE_INTERVAL);

    setTimeout(() => runBacktest(), 3000);

    const testBtn = document.getElementById('test-telegram-btn');
    const testLabel = document.getElementById('test-btn-label');
    if (testBtn && testLabel) {
        testBtn.addEventListener('click', async () => {
            testLabel.innerHTML = '<span class="spinner" aria-hidden="true"></span> Enviando...';
            testBtn.disabled = true;
            const scoreText = document.getElementById('score-value')?.textContent || '50';
            const priceText = document.getElementById('btc-price')?.textContent || '$60.000';
            const ok = await sendTestAlert(scoreText, priceText);
            testLabel.textContent = ok ? 'Enviado!' : 'Falha';
            setTimeout(() => { testLabel.textContent = 'Testar Alerta'; testBtn.disabled = false; }, 2500);
        });
    }

    const backtestBtn = document.getElementById('runBacktestBtn');
    if (backtestBtn) backtestBtn.addEventListener('click', runBacktest);

    updateTelegramStatus();
    updateTimestamp();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
