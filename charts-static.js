// ================================================================
// CHARTS-STATIC.JS — Gráficos Chart.js estáticos (ETF, Macro, etc.)
// ================================================================
export function initStaticCharts() {
    if (window.ChartError || typeof Chart === 'undefined') return;
    const cc = { text: 'rgb(236,240,241)', border: 'rgb(44,62,80)' };
    const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: cc.text } } }, scales: { y: { ticks: { color: cc.text }, grid: { color: cc.border } }, x: { ticks: { color: cc.text }, grid: { color: cc.border } } } };

    new Chart(document.getElementById('chart_etf_flows')?.getContext('2d'), {
        type: 'bar',
        data: { labels: ['22JUN','23JUN','24JUN','25JUN','26JUN','27JUN','28JUN'], datasets: [
            { label: 'BTC ETF', data: [-120,-85,-155,-92,-138,-165,-445], backgroundColor: 'rgba(233,69,96,0.6)', borderColor: 'rgb(233,69,96)', borderWidth: 2 },
            { label: 'ETH ETF', data: [-8,-12,-15,-10,-18,-20,-12.85], backgroundColor: 'rgba(0,180,216,0.4)', borderColor: 'rgb(0,180,216)', borderWidth: 2 }
        ] },
        options: { ...opts, plugins: { ...opts.plugins, title: { display: true, text: 'ETF Flows (referencia)', color: cc.text } } }
    });

    new Chart(document.getElementById('chart_macro_rates')?.getContext('2d'), {
        type: 'line',
        data: { labels: ['17JUN','19JUN','21JUN','23JUN','25JUN','27JUN','28JUN'], datasets: [
            { label: 'DXY', data: [100.8,100.95,101.15,101.28,101.32,101.35,101.37], borderColor: 'rgb(233,69,96)', borderWidth: 2, tension: 0.4, yAxisID: 'y' },
            { label: 'US10Y', data: [4.32,4.30,4.29,4.28,4.27,4.28,4.28], borderColor: 'rgb(255,214,10)', borderWidth: 2, tension: 0.4, yAxisID: 'y1' }
        ] },
        options: { ...opts, scales: { ...opts.scales, y1: { position: 'right', ticks: { color: cc.text }, grid: { drawOnChartArea: false } } } }
    });

    new Chart(document.getElementById('chart_scenarios')?.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Bounce Tatico','Markdown','Reversal'], datasets: [{ data: [35,45,20], backgroundColor: ['rgba(255,214,10,0.6)','rgba(233,69,96,0.6)','rgba(0,217,142,0.6)'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: cc.text } } } }
    });

    new Chart(document.getElementById('chart_allocation')?.getContext('2d'), {
        type: 'pie',
        data: { labels: ['BTC 25%','ETH 10%','Stable 65%'], datasets: [{ data: [25,10,65], backgroundColor: ['rgba(0,180,216,0.6)','rgba(255,214,10,0.6)','rgba(0,217,142,0.6)'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: cc.text } } } }
    });

    new Chart(document.getElementById('chart_whale_flow')?.getContext('2d'), {
        type: 'bar',
        data: { labels: ['BTC','ETH'], datasets: [
            { label: 'Acumulacao', data: [700,0], backgroundColor: 'rgba(0,217,142,0.7)', borderColor: 'rgb(0,217,142)', borderWidth: 2 },
            { label: 'Distribuicao', data: [0,27.4], backgroundColor: 'rgba(233,69,96,0.7)', borderColor: 'rgb(233,69,96)', borderWidth: 2 }
        ] },
        options: { ...opts, plugins: { ...opts.plugins, title: { display: true, text: 'Fluxo de Baleias (referencia)', color: cc.text } } }
    });
}
