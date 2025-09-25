// src/frontend.js
import Chart, { plugins } from 'chart.js/auto';
import { toFont } from 'chart.js/helpers';
import trendlinePlugin from 'chartjs-plugin-trendline';
Chart.register(trendlinePlugin);

// - helpers (same as editor) -------------------------
const normalizeForChart = (data) => {
  if (!data) return { labels: [], values: [], overlays: [] };
  const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];

  // parse numeric stats, stripping symbols like $ or %
  const values = (Array.isArray(data.stats) ? data.stats : []).map((raw) => {
    const num = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num.toFixed(1) : "0.0";
  });

  // Build one tooltip line per row by joining "Header: Value" for each overlay
  const overlayDefs = Array.isArray(data.overlays) ? data.overlays : [];
  const rowCount = Math.max(
    labels.length,
    values.length,
    ...overlayDefs.map(o => (o?.values?.length ?? 0))
  );

  const overlays = Array.from({ length: rowCount }, (_, i) => {
    const parts = [];
    for (const o of overlayDefs) {
      const v = o?.values?.[i];
      if (v !== undefined && v !== null && String(v) !== '') {
        const h = o?.header ? `${o.header}: ` : '';
        parts.push(`${h}${v}`);
      }
    }
    return parts.join(' • '); // what your tooltip reads via overlays[ctx.dataIndex]
  });

  return { labels, values, overlays };
};

function addAlphaToHex(baseColor, alpha) {
  const hex = baseColor.replace('#', '');
  const fullHex = hex.length === 3 ? hex.split('').map(x => x + x).join('') : hex;
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `#${fullHex}${alphaHex}`;
}

const circleLabelsPlugin = {
  id: 'circleLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];

    ctx.save();
    const f = toFont({ family: Chart.defaults.font.family, size: 10, weight: '700' });
    ctx.font = f.string;
    meta.data.forEach((bar, index) => {
      const value = dataset.data[index];
      const x = bar.x - 10;
      const y = bar.y;

      ctx.beginPath();
      ctx.arc(x, y, 10, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = dataset.backgroundColor?.[index] || dataset.backgroundColor;
      ctx.stroke();

      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(value, x, y);
    });
    ctx.restore();
  }
};

// BAR CONFIG
function getBarConfig({ labels, values, overlays, colors, barColor, title }) {

  const yValues = (Array.isArray(values) ? values : []).map((raw) => {
    const num = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num.toFixed(1) : "0.0";
  });

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Rating',
        data: yValues,
        backgroundColor: colors,
        borderColor: barColor,
        borderWidth: 1,
        borderRadius: 20,
        categoryPercentage: 0.9,
        barPercentage: 0.9
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: { grid: { display: false }, ticks: { color: '#000', font: { size: 14 } } },
      },
      plugins: {
        legend: { display: false },
        title: {
          display: !!title,
          text: title,
          font: { size: 20, family: 'Montserrat' }
        },
        tooltip: overlays.length ? {
          callbacks: {
            afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
          }
        } : {},
      }
    },
    plugins: [circleLabelsPlugin]
  };
}

// SCATTER CONFIG

function getScatterConfig({ labels, yValues, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel }) {
  const points = yValues.map((y, i) => ({ x: i, y })); // x = index; label via tick callback

  return {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Rating',
        data: points,
        backgroundColor: colors,
        borderColor: barColor,
        borderWidth: 0,
        pointRadius: 5,
        // trendline plugin
        trendlineLinear: {
          color: 'rgba(111,207,192,0.7)',
          style: 'rgba(111,207,192,0.7)',
          lineStyle: 'solid',
          width: 3,
          projection: true,
          label: {
            text: trendlineLabel || "Trendline",
            display: true,
            displayValue: false,
            offset: 15,
          }
        }
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: { xAxisKey: 'x', yAxisKey: 'y' },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: !!xAxisLabel,
            text: xAxisLabel || '',
            font: { size: 14 }
          },
          grid: { display: false },
          ticks: {
            // map index → label
            callback: (value) => labels[value] ?? value
          }
        },
        y: {
          title: {
            display: !!yAxisLabel,
            text: yAxisLabel || '',
            font: { size: 14 }
          },
          grid: { display: false },
          ticks: { color: '#000', font: { size: 14 } }
        }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: !!title,
          text: title,
          font: { size: 20, family: 'Montserrat' }
        },
        tooltip: overlays.length ? {
          callbacks: {
            label: (ctx) => {
              const i = ctx.dataIndex;
              const name = labels[i] ?? `#${i + 1}`;
              const val = ctx.parsed?.y ?? '';
              const extra = overlays[i] ? ` ${overlays[i]}` : '';
              return `${name}: ${val}${extra}`;
            }
          }
        } : {}
      }
    },
    plugins: [], // no circleLabelsPlugin on scatter
  };
}


// --- fetch cached data from your REST route ------------
async function getCachedData(blockId) {

  const url = `/wp-json/sheets-chart/v1/cached?blockId=${encodeURIComponent(blockId)}`;

  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json();
}

// --- render one block ---------------------------------
async function renderBlock(blockEl) {
  const title = blockEl.dataset.sheetTitle || '';
  const blockId = blockEl.dataset.blockId || '';
  const chartType = blockEl.dataset.chartType || 'bar';
  //const sheetId  = blockEl.dataset.sheetId || '';
  //const label    = blockEl.dataset.label || '';
  //const stats    = blockEl.dataset.stats || '';
  //const overlay  = blockEl.dataset.overlay || '';
  const barColor = blockEl.dataset.barColor || '#3b82f6';
  const xAxisLabel = blockEl.dataset.xAxisLabel || '';
  const yAxisLabel = blockEl.dataset.yAxisLabel || '';
  const trendlineLabel = blockEl.dataset.trendlineLabel || '';

  const canvas = blockEl.querySelector('canvas.sheets-chart-canvas');
  if (!canvas) return;

  try {
    const data = await getCachedData(blockId);
    const { labels, values, overlays } = normalizeForChart(data);

    // return strings to retain .0 formatting
    const yValues = values.map((v) => Number(v));

    //const yValues = (Array.isArray(values) ? values : []).map((raw) => {
    //    const num = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
    //    return Number.isFinite(num) ? num.toFixed(1) : "0.0";
    //});

    // color ramp by value
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const colors = values.map(v => {
      const t = (v - minVal) / (maxVal - minVal || 1); // avoid /0
      const alpha = 0.5 + t * 0.5; // 0.5 → 1
      return addAlphaToHex(barColor, alpha);
    });

    // set font
    // helper function
    async function useMontserrat(blockEl) {
      // ensure the font is ready (modern browsers)
      try { await (document.fonts?.load('12px "Montserrat"') || Promise.resolve()); } catch { }

      const color = getComputedStyle(blockEl).color || '#111';

      Chart.defaults.font.family = '"Montserrat", system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, sans-serif';
      Chart.defaults.font.size = 14;
      Chart.defaults.font.weight = '400';
      Chart.defaults.color = color;
    }

    await useMontserrat(blockEl);

    const ctx = canvas.getContext('2d');

    const config = (chartType === 'scatter')
      ? getScatterConfig({ labels, yValues, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel })
      : getBarConfig({ labels, values, overlays, colors, barColor, title });

    const chart = new Chart(ctx, config);
    blockEl._sheetsChart = chart;

  } catch (e) {
    // optional: show a small message if no cache yet
    const wrap = blockEl.querySelector('.sheets-chart-canvas-wrap');
    if (wrap) {
      wrap.innerHTML = '<em style="font:14px/1.4 sans-serif">No cached data yet. Please fetch data in the editor.</em>';
    }
    console.error(e);
  }
}

// --- boot: find all saved blocks on the page ----------
function init() {
  document.querySelectorAll('.sheets-chart-block').forEach(renderBlock);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
