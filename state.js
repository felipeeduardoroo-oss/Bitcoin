// ================================================================
// STATE.JS — Estado global mutável compartilhado entre módulos
// ================================================================
import { DEFAULT_FILTER_WEIGHTS } from './config.js';

// Dados de mercado preenchidos pelos loops
export const globalData = {
    price: 60000, ema50: 65000, ema200: 62000,
    ema50Prev: 65000, rsi: 45, macd: 120, macdSignal: 100,
    roc: -2.5, atr: 1200, adx: 25,
    support: 58000, resistance: 70000,
    fvgZones: [{ low: 62000, high: 63500 }],
    mvrv: 1.2, sopr: 0.95, volumeRel: 1.0, oiDelta: 0.0,
    volume: 0, avgVolume: 0, fundingRate: 0, priceDeltaPct: 0
};

// Regime detectado
export let currentRegime = 'RANGE';

// Alertas e trades para feedback do Kelly / optimizer
export let alertLog = [];
export let tradeHistory = [];

// Históricos de preços para indicadores
export let candleHistory = [];
export let ema50History = [];
export let fundingHistory = [];
export let atrPercentHistory = [];

// Pesos otimizáveis (copiados do default, podem ser atualizados pelo optimizer)
export const filterWeights = { ...DEFAULT_FILTER_WEIGHTS };

// Controle de alertas
export let lastAlertTime = 0;
export let lastScore = 50;
export let previousScore = 50;
export let currentFundingRate = 0;
export let telegramStatus = 'online';
