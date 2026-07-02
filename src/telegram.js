// ================================================================
// TELEGRAM.JS — Envio de alertas via Telegram Bot API
// Separado de api.js para eliminar dependência circular com engine.js
// ================================================================
import { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, CAPITAL, ALERT_COOLDOWN } from './config.js';
import { telegramStatus, alertLog, lastAlertTime, currentRegime, globalData } from './state.js';
import { calculateKellySizing } from './engine.js';

export async function sendTelegramAlert(message) {
    try {
        const r = await fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
        });
        if (r.ok) { telegramStatus = 'online'; return true; }
        console.warn('Falha alerta:', await r.text());
        telegramStatus = 'offline'; return false;
    } catch (e) { console.warn('Erro alerta:', e); telegramStatus = 'offline'; return false; }
}

export async function sendStructuredAlert(signalType, score, price, stop, targets, rationale, components, regime) {
    const kellyPct = calculateKellySizing(regime);
    const riskAmt = CAPITAL * kellyPct;
    const riskPerUnit = Math.abs(price - stop);
    const size = riskPerUnit > 0 ? riskAmt / riskPerUnit : 0;
    const arrow = signalType === 'long' ? '🟢' : '🔴';
    let msg = arrow + ' <b>SINAL ' + signalType.toUpperCase() + ' - BTCUSDT</b>\n';
    msg += 'Confianca: ' + Math.round(score) + '%\nPreco: $' + price.toFixed(2) + '\nStop: $' + stop.toFixed(2) + '\n';
    msg += 'Tamanho: ' + size.toFixed(4) + ' BTC (' + (kellyPct * 100).toFixed(2) + '% capital)\nAlvos:\n';
    targets.forEach(t => { msg += '  ' + t.label + ': $' + t.price.toFixed(2) + ' (' + (t.size * 100).toFixed(0) + '% pos, R:R ' + t.rr.toFixed(1) + ')\n'; });
    msg += 'Score: ' + Math.round(score) + '/100\nRegime: ' + regime + '\n';
    if (components) msg += 'Comp: T=' + components.trend + ' M=' + components.momentum + ' E=' + components.structure + ' OC=' + components.onchain + ' V=' + components.volume + ' OI=' + components.oi + '\n';
    msg += 'Fundamentos: ' + rationale + '\n⏰ ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const ok = await sendTelegramAlert(msg);
    if (ok) { alertLog.push({ timestamp: Date.now(), type: signalType, score, price, rationale, components, win: null, pnl: null, regime }); try { localStorage.setItem('alertLog', JSON.stringify(alertLog.slice(-100))); } catch (_) {} }
    return ok;
}

export async function sendTestAlert(scoreText, priceText) {
    return await sendTelegramAlert(
        '🔔 <b>TESTE DE CONEXAO</b>\n✅ Conectado\n📊 Score: ' + scoreText + '\n💰 BTC: ' + priceText + '\n⏰ ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    );
}
