// src/frontend.js
import Chart from 'chart.js/auto';

// --- helpers (same as editor) -------------------------
        const normalizeForChart = (data) => {
        if (!data) return { labels: [], values: [], overlays: [] };

        const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];

        // parse numeric stats, stripping symbols like $ or %
        const values = (Array.isArray(data.stats) ? data.stats : []).map((raw) => {
            const num = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
            return Number.isFinite(num) ? num : 0;
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

// --- fetch cached data from your REST route ------------
async function getCachedData(sheetId) {
  const url = `/wp-json/sheets-chart/v1/cached?sheetId=${encodeURIComponent(sheetId)}`;

  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return res.json();
}

// --- render one block ---------------------------------
async function renderBlock(blockEl) {
  const sheetId  = blockEl.dataset.sheetId || '';
  const label    = blockEl.dataset.label || '';
  const stats    = blockEl.dataset.stats || '';
  const overlay  = blockEl.dataset.overlay || '';
  const barColor = blockEl.dataset.barColor || '#3b82f6';

  const canvas = blockEl.querySelector('canvas.sheets-chart-canvas');
  if (!canvas) return;

  try {
    const data = await getCachedData(sheetId);
    const { labels, values, overlays } = normalizeForChart(data);

    // color ramp by value
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const colors = values.map(v => {
      const t = (v - minVal) / (maxVal - minVal || 1); // avoid /0
      const alpha = 0.5 + t * 0.5; // 0.5 → 1
      return addAlphaToHex(barColor, alpha);
    });

    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Rating',
          data: values,
          backgroundColor: colors,
          borderColor: barColor,
          borderRadius: 20,
          borderWidth: 1
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
        elements: { categoryPercentage: 1.5 },
        plugins: {
          tooltip: overlays.length ? {
            callbacks: {
              afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
            }
          } : {},
          legend: { display: false },
        }
      },
      plugins: [circleLabelsPlugin],
    });

    // keep a reference in case you need teardown later
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
