// ================================================================
// CONFIG.JS — Constantes, tokens e thresholds configuráveis
// ================================================================
// AVISO: Em produção, injete TELEGRAM_TOKEN via variável de ambiente.
// Nunca commit tokens em repositórios públicos.
export const TELEGRAM_TOKEN = '8670184440:AAFBfhFFTMnUWsgIFyRh0huBYbL-Q_vhT5k';
export const TELEGRAM_CHAT_ID = '1137196768';
export const FRED_API_KEY = 'cbe3655dd2b0a46d0e5c43324a21ab64';
export const ETHERSCAN_KEY = 'NP3TFWDIPF1FFQ8DBBR9JUIUE9UFSUGSGU';

export const ALERT_COOLDOWN = 60000;       // 1 minuto entre alertas
export const CAPITAL = 10000;              // Capital base para Kelly sizing
export const MAX_SCORE_HISTORY = 500;      // Máximo de pontos no gráfico de score
export const EMA50_HISTORY_MAX = 200;      // Máximo de pontos no histórico EMA50

export const FAST_INTERVAL = 15000;        // Loop rápido: 15s (BTC indicadores + score)
export const SLOW_INTERVAL = 60000;        // Loop lento: 60s (CoinGecko, FRED, on-chain)
export const CANDLE_INTERVAL = 10000;      // Atualização candles resumo: 10s

export const MTF_INTERVALS = ['1m', '5m', '15m'];

export const SUMMARY_PAIRS = [
    { id: 'candle-btc', symbol: 'BTCUSDT', color: '#00d98e', prefix: 'btc' },
    { id: 'candle-eth', symbol: 'ETHUSDT', color: '#00b4d8', prefix: 'eth' },
    { id: 'candle-sol', symbol: 'SOLUSDT', color: '#ffd60a', prefix: 'sol' }
];

// Pesos do score por regime — usados por computeScore()
export const REGIME_WEIGHTS = {
    BULL:  { trend: 0.30, momentum: 0.25, structure: 0.10, onChain: 0.10, volume: 0.10, oi: 0.15 },
    BEAR:  { trend: 0.30, momentum: 0.25, structure: 0.10, onChain: 0.10, volume: 0.10, oi: 0.15 },
    RANGE: { trend: 0.10, momentum: 0.20, structure: 0.25, onChain: 0.20, volume: 0.10, oi: 0.15 }
};

// Pesos dos filtros do confirmSignalV13 — otimizáveis via simulated annealing
export const DEFAULT_FILTER_WEIGHTS = {
    price_action: 0.12, momentum: 0.12, macro_crypto: 0.10,
    liquidity_spread: 0.08, ml_probability: 0.08, mtf_alignment: 0.10,
    volume_liquidity: 0.12, funding_onchain: 0.14,
    divergence_penalty: 0.10, trend_strength: 0.14
};
