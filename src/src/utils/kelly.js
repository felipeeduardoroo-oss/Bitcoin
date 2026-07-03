import { CAPITAL } from '../config.js';
import { alertLog } from '../state.js';

export function calculateKellySizing(regime) {
  const base = regime === 'RANGE' ? 0.005 : 0.02;
  const max = regime === 'RANGE' ? 0.01 : 0.05;
  const rt = alertLog.filter(t => t.win !== null && t.regime === regime).slice(-50);
  if (rt.length < 10) return base;
  const w = rt.filter(t => t.win).length, wr = w / rt.length;
  const aw = rt.filter(t => t.win).reduce((s, t) => s + (t.pnl || 0), 0) / Math.max(1, w);
  const al = Math.abs(rt.filter(t => !t.win).reduce((s, t) => s + (t.pnl || 0), 0)) / Math.max(1, rt.length - w);
  const k = aw > 0 ? (wr * aw - (1 - wr) * al) / aw : 0;
  return Math.min(Math.max(0, k) * 0.25, 0.005, max);
}
