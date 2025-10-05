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

// helper function to sort data for bar charts
const sortChartData = (labels, values, overlays, sortOrder) => {
  if (!sortOrder || sortOrder === 'default') {
    return { labels, values, overlays };
  }

  // Create array of indices with data for sorting
  const dataWithIndices = labels.map((label, i) => ({
    index: i,
    label,
    value: Number(values[i]),
    overlay: overlays[i]
  }));

  // Sort based on sortOrder
  switch (sortOrder) {
    case 'alphabetical-asc':
      dataWithIndices.sort((a, b) => a.label.localeCompare(b.label));
      break;
    case 'alphabetical-desc':
      dataWithIndices.sort((a, b) => b.label.localeCompare(a.label));
      break;
    case 'value-high-low':
      dataWithIndices.sort((a, b) => b.value - a.value);
      break;
    case 'value-low-high':
      dataWithIndices.sort((a, b) => a.value - b.value);
      break;
    default:
      return { labels, values, overlays };
  }

  // Extract sorted data
  const sortedLabels = dataWithIndices.map(item => item.label);
  const sortedValues = dataWithIndices.map(item => values[item.index]);
  const sortedOverlays = dataWithIndices.map(item => item.overlay);

  return { 
    labels: sortedLabels, 
    values: sortedValues, 
    overlays: sortedOverlays 
  };
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
        borderWidth: 0,
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
        x: { grid: { display: false }, ticks: { display: false }, drawBorder: false },
        y: { grid: { display: false }, ticks: { color: '#000', font: { size: 14 } }, drawBorder: false },
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

function getScatterConfig({ labels, values, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel }) {
  // 1) Parse labels like "$160" → 160 (handles "$", commas, or plain numbers)
  const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
  const xs = labels.map(toNum);
  const ys = values.map((v) => Number(v));

  // 2) Points with original label for tooltip
  const points = xs.map((x, i) => ({ x, y: ys[i], origLabel: labels[i] ?? '' }));

  // detect if prices are all non-negative
  const nonNegativeX = xs.every(n => n >= 0);

  return {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Rating',
        data: points,
        backgroundColor: colors,
        borderColor: '#a9a9a9',
        pointRadius: 5,
        trendlineLinear: {
          style: '#a9a9a9',
          color: '#a9a9a9',
          borderColor: '#a9a9a9',
          backgroundColor: '#a9a9a9',
          lineStyle: 'solid',
          width: 3,
          projection: true,
          label: {
            text: trendlineLabel || 'Trendline',
            display: true,
            displayValue: false,
            offset: 15,
          }
        }
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          beginAtZero: nonNegativeX, // keeps prices from going negative
          grace: '5%',               // built-in padding
          ticks: {
            // keep the axis readable (about 6 ticks)
            maxTicksLimit: 6,
            callback: (v) => {
              // Try to preserve dollar sign formatting if original labels had them
              const hasDollar = labels.some(l => String(l).includes('$'));
              return hasDollar ? `$${v}` : `${v}`;
            },
          },
          grid: { display: false },
          drawBorder: false,
          title: {
            display: !!xAxisLabel,
            text: xAxisLabel || '',
            font: { size: 14 },
          },
        },
        y: {
          grace: '5%',               // built-in padding
          ticks: {
            maxTicksLimit: 6,
            font: { size: 14 },
          },
          grid: { display: false },
          drawBorder: false,
          title: {
            display: !!yAxisLabel,
            text: yAxisLabel || '',
            font: { size: 14 },
          },
        },
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
            title: (ctx) => {
              const i = ctx[0].dataIndex;
              if (overlays[i]) {
                // Extract first overlay item as title (before first bullet)
                const overlayParts = overlays[i].split(' • ');
                return overlayParts[0] || '';
              }
              return '';
            },
            label: (ctx) => {
              const p = ctx.raw;
              const hasDollar = labels.some(l => String(l).includes('$'));
              const xValue = hasDollar ? `$${ctx.parsed.x}` : ctx.parsed.x;
              
              // Show axis values with their labels
              const lines = [];
              if (xAxisLabel) {
                lines.push(`${xAxisLabel}: ${xValue}`);
              }
              if (yAxisLabel) {
                lines.push(`${yAxisLabel}: ${ctx.parsed.y}`);
              }
              
              return lines;
            },
            afterLabel: (ctx) => {
              const i = ctx.dataIndex;
              if (overlays[i]) {
                // Show remaining overlay items (skip first one used as title)
                const overlayParts = overlays[i].split(' • ');
                return overlayParts.slice(1); // Return remaining items as array
              }
              return '';
            },
          },
        } : {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return `${p.origLabel || `${ctx.parsed.x}`}: ${ctx.parsed.y}`;
            },
          },
        },
      },
    },
    plugins: [],
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
  const barColor = blockEl.dataset.barColor || '#3b82f6';
  const xAxisLabel = blockEl.dataset.xAxisLabel || '';
  const yAxisLabel = blockEl.dataset.yAxisLabel || '';
  const trendlineLabel = blockEl.dataset.trendlineLabel || '';
  const sortOrder = blockEl.dataset.sortOrder || 'default';

  const canvas = blockEl.querySelector('canvas.sheets-chart-canvas');
  if (!canvas) return;

  try {
    const data = await getCachedData(blockId);
    let { labels, values, overlays } = normalizeForChart(data);

    // Apply sorting for bar charts only
    if (chartType === 'bar') {
      const sorted = sortChartData(labels, values, overlays, sortOrder);
      labels = sorted.labels;
      values = sorted.values;
      overlays = sorted.overlays;
    }

    // color ramp by value
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const colors = values.map(v => {
      const t = (v - minVal) / (maxVal - minVal || 1); // avoid /0
      const alpha = 0.5 + t * 0.5; // 0.5 → 1
      return addAlphaToHex(barColor, alpha);
    });

    // set font
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
      ? getScatterConfig({ labels, values, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel })
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
