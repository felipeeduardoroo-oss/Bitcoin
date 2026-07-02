// ================================================================
// API.JS — Toda comunicação com APIs externas de dados
// Telegram movido para telegram.js para eliminar dependência circular
// ================================================================
import { FRED_API_KEY, ETHERSCAN_KEY } from './config.js';
import { globalData, currentFundingRate, fundingHistory, setCurrentFundingRate } from './state.js';

// ----------------------------------------------------------------
// CLIENT BASE
// ----------------------------------------------------------------
export function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const signal = options.signal || controller.signal;
    const merged = { ...options, signal };
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, merged)
        .then(r => { clearTimeout(tid); return r; })
        .catch(e => { clearTimeout(tid); if (e.name === 'AbortError') return null; throw e; });
}

// ----------------------------------------------------------------
// BINANCE — Candles genérico
// ----------------------------------------------------------------
export async function fetchCandles(symbol, interval, limit = 50) {
    try {
        const r = await fetchWithTimeout(
            'https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=' + interval + '&limit=' + limit, {}, 8000
        );
        if (!r || !r.ok) return null;
        return (await r.json()).map(k => ({
            time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
        }));
    } catch (_) { return null; }
}

// ----------------------------------------------------------------
// BINANCE — Ticker 24h
// ----------------------------------------------------------------
export async function fetchTickerData() {
    try {
        const r = await fetchWithTimeout(
            'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {}, 5000
        );
        if (!r || !r.ok) return null;
        return await r.json();
    } catch (_) { return null; }
}

// ----------------------------------------------------------------
// COINGECKO — Preços BTC, ETH, SOL
// ----------------------------------------------------------------
export async function fetchPrices() {
    try {
        const r = await fetchWithTimeout(
            'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true'
        );
        if (!r || !r.ok) return;
        const d = await r.json();
        const set = (id) => {
            const v = d[id]; if (!v) return;
            const pe = document.getElementById(id + '-price');
            if (pe) { pe.textContent = '$' + Number(v.usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); pe.className = 'value ' + (v.usd_24h_change >= 0 ? 'positive' : 'negative'); }
            const ce = document.getElementById(id + '-change');
            if (ce) { const ch = v.usd_24h_change; ce.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '% (live)'; }
        };
        set('btc'); set('eth'); set('sol');
        if (d.bitcoin?.usd) globalData.price = d.bitcoin.usd;
    } catch (_) {}
}

// ----------------------------------------------------------------
// FEAR & GREED
// ----------------------------------------------------------------
export async function fetchFearGreed() {
    try {
        const r = await fetchWithTimeout('https://api.alternative.me/fng/?limit=1');
        if (!r || !r.ok) return;
        const d = await r.json(); const i = d.data[0]; const v = +i.value;
        const el = document.getElementById('header-fng');
        if (el) { el.innerHTML = 'FEAR & GREED: ' + v + ' (' + i.value_classification + ')'; el.className = 'badge' + (v <= 25 ? ' extreme-fear' : ''); }
        const se = document.getElementById('header-sentiment');
        if (se) { se.textContent = v <= 25 ? 'SENTIMENTO: PESSIMISTA' : v <= 45 ? 'SENTIMENTO: NEUTRO' : 'SENTIMENTO: BULLISH'; se.className = 'badge ' + (v <= 25 ? 'sentiment-bearish' : 'sentiment-bullish'); }
    } catch (_) {}
}

// ----------------------------------------------------------------
// DEFILLAMA — Stablecoins + DeFi TVL
// ----------------------------------------------------------------
export async function fetchDeFiData() {
    try {
        const r1 = await fetchWithTimeout('https://stablecoins.llama.fi/stablecoins');
        if (r1?.ok) { const d = await r1.json(); let t = 0; if (d?.peggedAssets) d.peggedAssets.forEach(a => { if (a.total) t += a.total; }); if (t > 0) { const el = document.getElementById('stablecoin-supply'); if (el) el.textContent = '$' + Number(t).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (live)'; } }
        const r2 = await fetchWithTimeout('https://api.llama.fi/charts');
        if (r2?.ok) { const d = await r2.json(); const last = d[d.length - 1]?.totalLiquidityUSD || 0, prev = d[d.length - 2]?.totalLiquidityUSD || 0; if (last > 0) { const ch = prev ? ((last - prev) / prev) * 100 : 0; const el = document.getElementById('defi-tvl'); if (el) el.textContent = '$' + Number(last).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (live)'; const ce = document.getElementById('defi-tvl-change'); if (ce) ce.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '% (live)'; const ie = document.getElementById('defi-tvl-interp'); if (ie) ie.textContent = ch >= 0 ? 'Entrada de liquidez' : 'Saida de liquidez'; } }
    } catch (_) {}
}

// ----------------------------------------------------------------
// BINANCE FUTURES — Derivativos
// ----------------------------------------------------------------
export async function fetchBinanceDerivatives() {
    try {
        const r1 = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1');
        if (r1?.ok) { const d = await r1.json(); const fr = parseFloat(d[0]?.fundingRate) || 0; setCurrentFundingRate(fr); fundingHistory.push({ fundingRate: fr }); if (fundingHistory.length > 100) fundingHistory.shift(); globalData.fundingRate = fr; const el = document.getElementById('funding-rate'); if (el) el.textContent = (fr * 100).toFixed(4) + '% (live)'; const ie = document.getElementById('funding-rate-interp'); if (ie) ie.textContent = fr > 0.0001 ? 'Longs pagam' : fr < -0.0001 ? 'Shorts pagam' : 'Neutro'; }
        const rA = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=8');
        if (rA?.ok) { const d = await rA.json(); const avg = d.reduce((s, i) => s + parseFloat(i.fundingRate), 0) / d.length; if (!isNaN(avg)) { const el = document.getElementById('funding-rate-avg'); if (el) el.textContent = (avg * 100).toFixed(4) + '% (live)'; } }
        const r2 = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT');
        if (r2?.ok) {
            const d = await r2.json(); const oi = parseFloat(d.openInterest) || 0;
            if (oi > 0) {
                const el = document.getElementById('open-interest'); if (el) el.textContent = '$' + Number(oi).toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' (live)';
                // FIX: não fabricar baseline (antes usava oi*0.915 como "prev" fake).
                // Sem histórico real na primeira carga, reporta honestamente "coletando" em vez de um delta inventado.
                const stored = (() => { try { return parseFloat(localStorage.getItem('prevOI')); } catch (_) { return NaN; } })();
                const el2 = document.getElementById('oi-delta');
                const ie = document.getElementById('oi-delta-interp');
                if (!isNaN(stored) && stored > 0) {
                    const delta = ((oi - stored) / stored) * 100;
                    globalData.oiDelta = delta;
                    if (el2) el2.textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '% (live)';
                    if (ie) { if (delta > 10) { ie.textContent = 'OI >10% — divergencia!'; ie.className = 'alert-divergence'; } else { ie.textContent = 'Normal'; ie.className = ''; } }
                } else {
                    globalData.oiDelta = 0;
                    if (el2) el2.textContent = 'Coletando baseline... (live)';
                    if (ie) { ie.textContent = 'Aguardando 2a leitura'; ie.className = ''; }
                }
                try { localStorage.setItem('prevOI', oi); } catch (_) {}
            }
        }
        const rLS = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/topLongShortPositionRatio?symbol=BTCUSDT&period=24h&limit=1');
        if (rLS?.ok) { const d = (await rLS.json())[0]; if (d) { const lp = (+d.longPositionRatio * 100).toFixed(1); const el = document.getElementById('ls-ratio-pos'); if (el) el.textContent = lp + '% / ' + (+d.shortPositionRatio * 100).toFixed(1) + '% (live)'; const ie = document.getElementById('ls-ratio-pos-interp'); if (ie) { if (+lp > 70) { ie.textContent = 'Long extremo (>70%)'; ie.className = 'alert-divergence'; } else { ie.textContent = 'Neutro'; ie.className = ''; } } globalData.rsi = 50 + (+lp - 50) * 0.5; } }
        const rLA = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/topLongShortAccountRatio?symbol=BTCUSDT&period=24h&limit=1');
        if (rLA?.ok) { const d = (await rLA.json())[0]; if (d) { const el = document.getElementById('ls-ratio-acc'); if (el) el.textContent = (+d.longAccountRatio * 100).toFixed(1) + '% / ' + (+d.shortAccountRatio * 100).toFixed(1) + '% (live)'; } }
        const rP = await fetchWithTimeout('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT');
        if (rP?.ok) { const pp = parseFloat((await rP.json()).price) || 0; if (pp > 0 && globalData.price > 0) { const b = ((pp - globalData.price) / globalData.price) * 100; const el = document.getElementById('basis'); if (el) el.textContent = (b >= 0 ? '+' : '') + b.toFixed(2) + '% (live)'; } }
    } catch (_) {}
}

// ----------------------------------------------------------------
// BITVIEW — On-chain
// ----------------------------------------------------------------
export async function fetchBRK() {
    const metrics = [
        { id: 'mvrv', el: 'mvrv', interp: 'mvrv-interp' },
        { id: 'mvrv_short', el: 'mvrv-sth', interp: 'mvrv-sth-interp' },
        { id: 'sopr', el: 'sopr', interp: 'sopr-interp' },
        { id: 'sopr_adjusted', el: 'asopr', interp: 'asopr-interp' },
        { id: 'realized_price', el: 'realized-price', interp: null },
        { id: 'active_addresses', el: 'active-addresses', interp: null }
    ];
    await Promise.allSettled(metrics.map(async m => {
        try {
            const r = await fetchWithTimeout('https://bitview.space/api/metrics/btc/' + m.id + '?resolution=1d');
            if (!r || !r.ok) return;
            const d = await r.json(); const v = d?.[0]?.[1]; if (v == null) return;
            const display = m.id === 'realized_price' ? '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : Number(v).toFixed(2);
            const el = document.getElementById(m.el); if (el) el.textContent = display + ' (live)';
            if (m.interp) {
                const n = parseFloat(v); let text = '';
                if (m.id === 'mvrv') text = n > 1 ? 'Acima de 1.0' : 'Abaixo de 1.0';
                else if (m.id === 'mvrv_short') text = n < 1 ? 'STH em perda' : 'STH em lucro';
                else if (m.id === 'sopr') text = n < 1 ? 'Weakness' : 'Strength';
                else if (m.id === 'sopr_adjusted') text = n < 1 ? 'Ajustado fraco' : 'Ajustado neutro';
                const ie = document.getElementById(m.interp); if (ie && text) ie.textContent = text;
            }
            if (m.id === 'mvrv') globalData.mvrv = +v;
            if (m.id === 'sopr') globalData.sopr = +v;
        } catch (_) {}
    }));
}

// ----------------------------------------------------------------
// BLOCKCHAIN.INFO — Hashrate
// ----------------------------------------------------------------
export async function fetchHashrate() {
    try {
        const r = await fetchWithTimeout('https://blockchain.info/q/hashrate', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r || !r.ok) return;
        const hr = parseFloat(await r.text()) / 1e18;
        if (!isNaN(hr) && hr > 0) { const el = document.getElementById('btc-hashrate'); if (el) el.textContent = hr.toFixed(2) + ' EH/s (live)'; }
    } catch (_) {}
}

// ----------------------------------------------------------------
// ETHERSCAN — Gas Price
// ----------------------------------------------------------------
export async function fetchGasPrice() {
    try {
        const r = await fetchWithTimeout('https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=' + ETHERSCAN_KEY);
        if (!r || !r.ok) return;
        const d = await r.json();
        if (d.status === '1') { const el = document.getElementById('eth-gas'); if (el) el.textContent = (parseFloat(d.result.ProposeGasPrice) / 10).toFixed(2) + ' Gwei (live)'; }
    } catch (_) {}
}

// ----------------------------------------------------------------
// TETHER PREMIUM — USDT/BRL vs USDC/BRL
// ----------------------------------------------------------------
export async function fetchTetherPremium() {
    try {
        const [r1, r2] = await Promise.all([
            fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=USDTBRL'),
            fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=USDCBRL')
        ]);
        if (!r1?.ok || !r2?.ok) return;
        const usdt = parseFloat((await r1.json()).price);
        const usdc = parseFloat((await r2.json()).price);
        if (usdc <= 0) return;
        const premium = ((usdt - usdc) / usdc) * 100;
        const el = document.getElementById('tether-premium');
        if (el) el.textContent = (premium >= 0 ? '+' : '') + premium.toFixed(2) + '% (live)';
    } catch (_) {}
}

// ----------------------------------------------------------------
// SLOW LOOP
// ----------------------------------------------------------------
export async function slowLoop() {
    await Promise.allSettled([
        fetchPrices(), fetchFearGreed(), fetchDeFiData(),
        fetchBinanceDerivatives(), fetchBRK(),
        fetchHashrate(), fetchGasPrice(), fetchTetherPremium()
    ]);
}
