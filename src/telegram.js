// ================================================================
// BACKTEST.JS — Runner + Report usando engine V13 simplificado
// ================================================================
import { calculateEMA, calculateRSI, getRegimeAwareSignal, getStopLossV8, generateScaledTargetsV8 } from './engine.js';
import { fetchWithTimeout } from './api.js';

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
        const r = await fetchWithTimeout(
            'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=' + (Date.now() - 30 * 864e5) + '&limit=45',
            {},
            10000
        );
        let klines;
        if (!r || !r.ok) throw new Error('Falha ao buscar dados históricos');
        klines = await r.json();
        if (!klines || klines.length < 10) throw new Error('Dados insuficientes');

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

                const reversed = (position.type === 'LONG' && (signal === 'SHORT' || signal === 'NEUTRAL')) || (position.type === 'SHORT' && (signal === 'LONG' || signal === 'NEUTRAL'));
                if (exitPrice !== null || reversed || i === ds.length - 1) {
                    if (!exitPrice) { exitPrice = price; exitReason = reversed ? 'Reversao' : 'Fim periodo'; }
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

        // --- Renderização segura (sem innerHTML) ---
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'backtest-stats-grid';

        const statData = [
            { val: winRate.toFixed(1)+'%', label: 'Win Rate', cls: winRate >= 60 ? 'positive' : winRate < 40 ? 'negative' : 'neutral' },
            { val: totalReturn.toFixed(2)+'%', label: 'Retorno Total', cls: totalReturn >= 0 ? 'positive' : 'negative' },
            { val: '$'+balance.toFixed(2), label: 'Saldo Final', cls: balance >= 1000 ? 'positive' : 'negative' },
            { val: ''+totalTrades, label: 'Total Trades', cls: '' },
            { val: pf === Infinity ? '∞' : pf.toFixed(2), label: 'Profit Factor', cls: pf >= 1.5 ? 'positive' : 'neutral' },
            { val: wins+' / '+losses, label: 'Wins / Losses', cls: '' },
            { val: (maxDD*100).toFixed(1)+'%', label: 'Max Drawdown', cls: maxDD < 0.1 ? 'positive' : 'negative' },
            { val: ''+stopCount, label: 'Stops', cls: '' },
            { val: ''+tp1Count, label: 'TP1', cls: '' },
            { val: ''+tp2Count, label: 'TP2', cls: '' }
        ];
        statData.forEach(s => {
            const card = document.createElement('div');
            card.className = 'backtest-stat-card';
            const valDiv = document.createElement('div');
            valDiv.className = 'stat-value ' + s.cls;
            valDiv.textContent = s.val;
            const labDiv = document.createElement('div');
            labDiv.className = 'stat-label';
            labDiv.textContent = s.label;
            card.appendChild(valDiv); card.appendChild(labDiv); grid.appendChild(card);
        });
        container.appendChild(grid);

        if (trades.length > 0) {
            const title = document.createElement('h4');
            title.style.cssText = 'color:var(--text-light);margin:20px 0 10px;';
            title.textContent = 'Historico de Trades';
            container.appendChild(title);

            const wrap = document.createElement('div');
            wrap.className = 'backtest-table-wrap';
            const table = document.createElement('table');
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>Entrada</th><th>Saida</th><th>Tipo</th><th>Preco Entrada</th><th>Preco Saida</th><th>PnL %</th><th>Dias</th><th>Motivo</th></tr>';
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            trades.slice().reverse().forEach(t => {
                const tr = document.createElement('tr');
                tr.className = t.pnlUsd > 0 ? 'row-win' : 'row-loss';
                const cells = [
                    t.entryDate, t.exitDate, t.type,
                    '$'+t.entryPrice.toFixed(0), '$'+t.exitPrice.toFixed(0),
                    t.pnlPct.toFixed(2)+'%', ''+t.daysOpen, t.exitReason
                ];
                cells.forEach(text => {
                    const td = document.createElement('td');
                    td.textContent = text;
                    if (text.includes('%')) td.style.color = t.pnlUsd > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
        } else {
            const noTrades = document.createElement('div');
            noTrades.className = 'no-trades';
            noTrades.innerHTML = '<p>Nenhum trade gerado.</p>';
            container.appendChild(noTrades);
        }

        const footer = document.createElement('p');
        footer.style.cssText = 'color:var(--text-muted);font-size:0.85em;margin-top:12px;';
        footer.textContent = 'Periodo: ' + ds[0].date + ' — ' + ds[ds.length - 1].date + ' (' + ds.length + ' dias)';
        container.appendChild(footer);

    } catch (err) {
        container.innerHTML = '<div class="no-trades"><p>Erro: ' + err.message + '</p></div>';
    } finally {
        backtestRunning = false; btn.disabled = false; btn.textContent = 'Executar Backtest';
    }
}
