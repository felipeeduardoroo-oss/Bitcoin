// ================================================================
// MAIN.JS — Orquestrador: loops, init, event listeners
// ================================================================
import { FAST_INTERVAL, SLOW_INTERVAL, CANDLE_INTERVAL, EMA50_HISTORY_MAX } from './config.js';
import { globalData, ema50History, lastScore } from './state.js';
import { fetchCandles, fetchTickerData, slowLoop, sendTestAlert } from './api.js';
import { processIndicators, computeScore, loadWeights, loadAlertLog, updateFilterWeights } from './engine.js';
import { updateScoreDisplay, initScoreChart, updateSummaryCandles, initMTFCharts, updateMTFCharts, updateHeaderUI, updateTelegramStatus, updateTimestamp, updateLiveTime, updateRegimeDisplay } from './ui.js';
import { runBacktest } from './backtest.js';
import { initStaticCharts } from './charts-static.js';

let isUpdating = false;

// ----------------------------------------------------------------
// FAST LOOP — 15s: Ticker + Candles 1h + Indicadores + Score
// ----------------------------------------------------------------
async function fastLoop() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        // 1. Ticker rapido
        const ticker = await fetchTickerData();
        if (ticker) {
            updateHeaderUI(ticker);
            globalData.price = parseFloat(ticker.lastPrice) || globalData.price;
            globalData.priceDeltaPct = parseFloat(ticker.priceChangePercent) || 0;
        }

        // 2. Candles 1h para indicadores
        const candles = await fetchCandles('BTCUSDT', '1h', 100);
        if (candles?.length > 0) {
            // processIndicators() calcula EMA50 internamente e armazena em globalData.ema50
            const regime = processIndicators();

            // Armazenar EMA50 no histórico para detecção de regime
            if (globalData.ema50) {
                ema50History.push(globalData.ema50);
                if (ema50History.length > EMA50_HISTORY_MAX) ema50History.shift();
            }

            // 3. Calcular e renderizar score (uma unica vez por ciclo)
            updateRegimeDisplay(regime);
            const sd = computeScore(globalData);
            updateScoreDisplay(sd);
            lastScore = sd.score;
        }

        // 4. Atualizar candles MTF
        updateMTFCharts();
    } catch (e) { console.error('Fast loop error:', e); }
    isUpdating = false;
}

// ----------------------------------------------------------------
// INIT
// ----------------------------------------------------------------
function initApp() {
    console.log('BTC Analyzer v13 — Inicializando...');
    loadWeights();
    loadAlertLog();
    initStaticCharts();
    initScoreChart();

    // Candles resumo + MTF
    updateSummaryCandles();
    initMTFCharts();

    // Primeira execucao imediata
    fastLoop();
    slowLoop();

    // Loops recorrentes
    setInterval(fastLoop, FAST_INTERVAL);
    setInterval(slowLoop, SLOW_INTERVAL);
    setInterval(updateSummaryCandles, CANDLE_INTERVAL);

    // Backtest inicial (após 3s para não bloquear renderização)
    setTimeout(() => runBacktest(), 3000);

    // ----------------------------------------------------------------
    // EVENT LISTENERS
    // ----------------------------------------------------------------
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

    console.log('Motor ativo. Fast: ' + (FAST_INTERVAL / 1000) + 's | Slow: ' + (SLOW_INTERVAL / 1000) + 's');
}

// ----------------------------------------------------------------
// PONTO DE ENTRADA
// ----------------------------------------------------------------
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
