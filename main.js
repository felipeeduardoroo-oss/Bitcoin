// ================================================================
// MAIN.JS — Orquestrador: loops, init, event listeners
// ================================================================
import { FAST_INTERVAL, SLOW_INTERVAL, CANDLE_INTERVAL } from './config.js';
import { globalData, currentRegime, ema50History, lastScore, EMA50_HISTORY_MAX } from './state.js';
import { fetchCandles, fetchTickerData, slowLoop, sendTestAlert } from './api.js';
import { processIndicators, computeScore, loadWeights, loadAlertLog, updateFilterWeights } from './engine.js';
import { updateScoreDisplay, initScoreChart, updateSummaryCandles, initMTFCharts, updateMTFCharts, updateHeaderUI, updateTelegramStatus, updateTimestamp, updateLiveTime, updateRegimeDisplay, showToast } from './ui.js';
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
        // 1. Ticker rápido
        const ticker = await fetchTickerData();
        if (ticker) {
            updateHeaderUI(ticker);
            globalData.price = parseFloat(ticker.lastPrice) || globalData.price;
            globalData.priceDeltaPct = parseFloat(ticker.priceChangePercent) || 0;
        }

        // 2. Candles 1h para indicadores
        const candles = await fetchCandles('BTCUSDT', '1h', 100);
        if (candles?.length > 0) {
            // Atualizar histórico
            const closes = candles.map(c => c.close);
            const ema50 = closes.length >= 50 ? require('./engine.js').calculateEMA(closes, 50) : null;
            if (ema50) { ema50History.push(ema50); if (ema50History.length > EMA50_HISTORY_MAX) ema50History.shift(); }

            // Processar indicadores (muta globalData)
            const { calculateEMA } = require('./engine.js');
            // Importação direta já feita no topo — usar função exportada
            const regime = processIndicators();
            updateRegimeDisplay(regime);

            // 3. Calcular e renderizar score
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
    console.log('🚀 BTC Analyzer v13 — Inicializando...');
    loadWeights();
    loadAlertLog();
    initStaticCharts();
    initScoreChart();

    // Candles resumo + MTF
    updateSummaryCandles();
    initMTFCharts();

    // Primeira execução imediata
    fastLoop();
    slowLoop();

    // Loops recorrentes
    setInterval(fastLoop, FAST_INTERVAL);
    setInterval(slowLoop, SLOW_INTERVAL);
    setInterval(updateSummaryCandles, CANDLE_INTERVAL);

    // Backtest inicial (após 3s para não bloquear)
    setTimeout(() => runBacktest(), 3000);

    // ----------------------------------------------------------------
    // EVENT LISTENERS
    // ----------------------------------------------------------------
    // Botão Testar Telegram
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

    // Botão Backtest
    const backtestBtn = document.getElementById('runBacktestBtn');
    if (backtestBtn) backtestBtn.addEventListener('click', runBacktest);

    // Telegram status inicial
    updateTelegramStatus();
    updateTimestamp();

    console.log('✅ Motor ativo. Fast: ' + (FAST_INTERVAL / 1000) + 's | Slow: ' + (SLOW_INTERVAL / 1000) + 's');
}

// ----------------------------------------------------------------
// PONTO DE ENTRADA
// ----------------------------------------------------------------
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
