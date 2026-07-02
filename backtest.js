// ================================================================
// BACKTEST.JS — Runner + Report usando engine V13 simplificado
// ================================================================
import { calculateEMA, calculateRSI, getRegimeAwareSignal, getStopLossV8, generateScaledTargetsV8 } from './engine.js';

let backtestRunning = false;

function generateSimData(days) {
    const d = []; let p = 60000; const now = Date.now();
    for (let i = days; i >= 0; i--) {
        p *= (1 + (Math.random() - 0.5) * 0.03);
        const dt = new Date(now - i * 864e5);
        const o = p * (1 + (Math.random() - 0.5) * 0.005);
        d.push([dt.getTime(), o.toFixed(2), (Math.max(o, p) * (1 + Math.random() * 0.01)).toFixed(2), (Math.min(o, p) * (1 - Math.random() * 0.01)).toFixed(2), p.toFixed(2), (Math.random() * 1000 + 500).toFixed(0)]);
    }
    return d;
}

export async function runBacktest() {
    const container = document.getElementById('backtestResults');
    const btn = document.getElementById('runBacktestBtn');
    if (backtestRunning) return;
    backtestRunning = true; btn.disabled = true; btn.textContent = 'Carregando...';
    container.innerHTML = '<div class="backtest-loading"><div class="spinner" aria-hidden="true"></div><p>Baixando dados...</p></div>';

    try {
        const r = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=' + (Date.now() - 30 * 864e5) + '&limit=45');
        let klines;
        if (!r.ok) klines = generateSimData(30);
        else { klines = await r.json(); if (!klines || klines.length < 10) klines = generateSimData(30); }

        const ds = klines.map(k => ({ date: new Date(k[0]).toISOString().split('T')[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })).filter(d => d.close > 0);
        if (ds.length < 10) { container.innerHTML = '<div class="no-trades"><p>Dados insuficientes.</p></div>'; return; }

        const closes = ds.map(d => d.close);
        let position = null;
        const trades = [];
        let balance = 1000, peak = balance, maxDD = 0;
        let totalTrades = 0, wins = 0, losses = 0;
        let stopCount = 0, tp1Count = 0, tp2Count = 0;

        for (let i = 20; i < ds.length; i++) {
            const slice = ds.slice(0, i + 1);
            const sliceCloses = slice.map(d => d.close);
            const price = sliceCloses[sliceCloses.length - 1];
            const ema50 = calculateEMA(sliceCloses, 50) || price;
            const ema200 = calculateEMA(sliceCloses, 200) || price;
            const rsi = calculateRSI(sliceCloses, 14);
            const support = Math.min(...slice.slice(-20).map(d => d.low));
            const resistance = Math.max(...slice.slice(-20).map(d => d.high));
            const atr = slice.length > 14 ? slice.slice(-15).reduce((s, c) => s + (c.high - c.low), 0) / 14 : price * 0.02;

            const simData = { price, ema50, ema200, rsi, support, resistance, atr };
            const regime = price > ema50 && ema50 > ema200 ? 'BULL' : price < ema50 && ema50 < ema200 ? 'BEAR' : 'RANGE';
            const signal = getRegimeAwareSignal(simData, regime);

            if (!position && signal !== 'NEUTRAL') {
                const stop = getStopLossV8(regime, atr, price, signal, support, resistance);
                position = { type: signal, entryPrice: price, stop, entryIndex: i, daysOpen: 0, tp1Hit: false };
            } else if (position) {
                position.daysOpen++;
                let exitPrice = null, exitReason = '';
                const isLong = position.type === 'LONG';

                if (isLong) {
                    if (ds[i].low <= position.stop) { exitPrice = position.stop; exitReason = 'Stop'; stopCount++; }
                    else if (ds[i].high >= position.entryPrice * 1.06) { exitPrice = position.entryPrice * 1.06; exitReason = 'TP2'; tp2Count++; position.tp1Hit = true; }
                    else if (ds[i].high >= position.entryPrice * 1.03) { if (!position.tp1Hit) { exitPrice = position.entryPrice * 1.03; exitReason = 'TP1'; tp1Count++; position.tp1Hit = true; } }
                } else {
                    if (ds[i].high >= position.stop) { exitPrice = position.stop; exitReason = 'Stop'; stopCount++; }
                    else if (ds[i].low <= position.entryPrice * 0.94) { exitPrice = position.entryPrice * 0.94; exitReason = 'TP2'; tp2Count++; position.tp1Hit = true; }
                    else if (ds[i].low <= position.entryPrice * 0.97) { if (!position.tp1Hit) { exitPrice = position.entryPrice * 0.97; exitReason = 'TP1'; tp1Count++; position.tp1Hit = true; } }
                }

                // Saída por reversão de sinal ou fim do período
                const reversed = (position.type === 'LONG' && (signal === 'SHORT' || signal === 'NEUTRAL')) || (position.type === 'SHORT' && (signal === 'LONG' || signal === 'NEUTRAL'));
                if (exitPrice !== null || reversed || i === ds.length - 1) {
                    if (!exitPrice) { exitPrice = price; exitReason = reversed ? 'Reversao' : 'Fim periodo'; }
                    // Breakeven após TP1
                    if (position.tp1Hit) {
                        const be = isLong ? position.entryPrice * 1.002 : position.entryPrice * 0.998;
                        if (isLong && exitPrice < be) exitPrice = be;
                        if (!isLong && exitPrice > be) exitPrice = be;
                    }
                    const pnl = isLong ? (exitPrice - position.entryPrice) : (position.entryPrice - exitPrice);
                    const pnlUsd = (pnl / position.entryPrice) * balance;
                    trades.push({ entryDate: ds[position.entryIndex].date, exitDate: ds[i].date, type: position.type, entryPrice: position.entryPrice, exitPrice, pnlPct: (pnl / position.entryPrice) * 100, pnlUsd, exitReason, daysOpen: position.daysOpen });
                    balance += pnlUsd;
                    totalTrades++;
                    if (pnlUsd > 0) wins++; else losses++;
                    if (balance > peak) peak = balance;
                    const dd = (peak - balance) / peak;
                    if (dd > maxDD) maxDD = dd;
                    position = null;
                }
            }
        }

        const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
        const grossWin = trades.filter(t => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
        const grossLoss = Math.abs(trades.filter(t => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0));
        const pf = grossLoss > 0 ? grossWin / grossLoss : (wins > 0 ? Infinity : 0);
        const totalReturn = ((balance - 1000) / 1000) * 100;

        let html = '<div class="backtest-stats-grid">' +
            statCard(winRate.toFixed(1) + '%', 'Win Rate', winRate >= 60 ? 'positive' : winRate < 40 ? 'negative' : 'neutral') +
            statCard(totalReturn.toFixed(2) + '%', 'Retorno Total', totalReturn >= 0 ? 'positive' : 'negative') +
            statCard('$' + balance.toFixed(2), 'Saldo Final', balance >= 1000 ? 'positive' : 'negative') +
            statCard('' + totalTrades, 'Total Trades', '') +
            statCard(pf === Infinity ? '∞' : pf.toFixed(2), 'Profit Factor', pf >= 1.5 ? 'positive' : 'neutral') +
            statCard(wins + ' / ' + losses, 'Wins / Losses', '') +
            statCard((maxDD * 100).toFixed(1) + '%', 'Max Drawdown', maxDD < 0.1 ? 'positive' : 'negative') +
            statCard('' + stopCount, 'Stops', '') +
            statCard('' + tp1Count, 'TP1', '') +
            statCard('' + tp2Count, 'TP2', '') +
            '</div>';

        if (trades.length === 0) {
            html += '<div class="no-trades"><p>Nenhum trade gerado.</p></div>';
        } else {
            html += '<h4 style="color:var(--text-light);margin:20px 0 10px;">Historico de Trades</h4><div class="backtest-table-wrap"><table><thead><tr><th>Entrada</th><th>Saida</th><th>Tipo</th><th>Preco Entrada</th><th>Preco Saida</th><th>PnL %</th><th>Dias</th><th>Motivo</th></tr></thead><tbody>';
            for (const t of trades.slice().reverse()) {
                html += '<tr class="' + (t.pnlUsd > 0 ? 'row-win' : 'row-loss') + '"><td>' + t.entryDate + '</td><td>' + t.exitDate + '</td><td>' + t.type + '</td><td>$' + t.entryPrice.toFixed(0) + '</td><td>$' + t.exitPrice.toFixed(0) + '</td><td style="color:' + (t.pnlUsd > 0 ? 'var(--accent-green)' : 'var(--accent-red)') + '">' + t.pnlPct.toFixed(2) + '%</td><td>' + t.daysOpen + '</td><td>' + t.exitReason + '</td></tr>';
            }
            html += '</tbody></table></div>';
        }
        html += '<p style="color:var(--text-muted);font-size:0.85em;margin-top:12px;">Periodo: ' + ds[0].date + ' — ' + ds[ds.length - 1].date + ' (' + ds.length + ' dias)</p>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div class="no-trades"><p>Erro: ' + err.message + '</p></div>';
    } finally {
        backtestRunning = false; btn.disabled = false; btn.textContent = 'Executar Backtest';
    }
}

function statCard(value, label, cls) {
    return '<div class="backtest-stat-card"><div class="stat-value ' + cls + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}
