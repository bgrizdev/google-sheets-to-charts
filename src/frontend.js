// src/frontend.js
import Chart, { plugins } from 'chart.js/auto';
import { toFont } from 'chart.js/helpers';
import trendlinePlugin from 'chartjs-plugin-trendline';
Chart.register(trendlinePlugin);

// - helpers (same as editor) -------------------------
const normalizeForChart = (data) => {
  if (!data) return { labels: [], values: [], overlays: [], badges: [], originalStats: [] };
  const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];
  const badges = Array.isArray(data.badges) ? data.badges.map(String) : [];
  
  // Store original stats for tooltip display
  const originalStats = Array.isArray(data.stats) ? data.stats.map(String) : [];

  // parse numeric stats, extracting numbers but keeping original values
  const values = (Array.isArray(data.stats) ? data.stats : []).map((raw) => {
    const num = parseFloat(String(raw ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : 0;
  });

  // Build one tooltip line per row by joining "Header: Value" for each overlay
  const overlayDefs = Array.isArray(data.overlays) ? data.overlays : [];
  const rowCount = Math.max(
    labels.length,
    values.length,
    badges.length,
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

  return { labels, values, badges, overlays, originalStats };
};

// helper function to sort data for bar charts
const sortChartData = (labels, values, badges, overlays, sortOrder) => {
  if (!sortOrder || sortOrder === 'default') {
    return { labels, values, badges, overlays };
  }

  // Create array of indices with data for sorting
  const dataWithIndices = labels.map((label, i) => ({
    index: i,
    label,
    value: Number(values[i]),
    badge: badges[i],
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
      return { labels, values, badges, overlays };
  }

  // Extract sorted data
  const sortedLabels = dataWithIndices.map(item => item.label);
  const sortedValues = dataWithIndices.map(item => values[item.index]);
  const sortedBadges = dataWithIndices.map(item => badges[item.index]);
  const sortedOverlays = dataWithIndices.map(item => item.overlay);

  return { 
    labels: sortedLabels, 
    values: sortedValues, 
    badges: sortedBadges,
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

// helper function to create plugin for badge display
const createBadgePlugin = (preloadedImages, badgesData, editorsPickImage, budgetBuyImage) => ({
  id: 'badgePlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];



    ctx.save();

    if (chart.config.type === 'bar') {
      // For bar charts - display badges at the end of bars based on badge column data
      chart.data.labels.forEach((label, index) => {
        let badgeImageUrl = null;
        const badgeValue = badgesData && badgesData[index] ? badgesData[index].trim() : '';

        // Check badge column value and assign appropriate image
        if (badgeValue.toLowerCase().includes('editor') && editorsPickImage) {
          badgeImageUrl = editorsPickImage;
        } else if (badgeValue.toLowerCase().includes('budget') && budgetBuyImage) {
          badgeImageUrl = budgetBuyImage;
        }

        if (badgeImageUrl && preloadedImages[badgeImageUrl] && meta.data[index]) {
          const bar = meta.data[index];
          const img = preloadedImages[badgeImageUrl];

          // Position badge to the left of the bar
          const size = 20; // Badge size
          let x = bar.x - 45; // 45px to the left of bar end
          let y = bar.y - 10; // Slightly above center

          // Ensure badge stays within canvas bounds
          const canvasWidth = chart.width;
          const canvasHeight = chart.height;
          
          // Adjust x position if badge would go off left edge
          if (x < 0) {
            x = 5; // 5px margin from left edge
          }
          
          // Adjust y position if badge would go off top edge
          if (y < 0) {
            y = bar.y + 10; // Position below bar center instead
          }
          
          // Adjust y position if badge would go off bottom edge
          if (y + size > canvasHeight) {
            y = canvasHeight - size - 5; // 5px margin from bottom
          }

          ctx.drawImage(img, x, y, size, size);
        }
      });
    } else if (chart.config.type === 'scatter') {
      // For scatter charts - display badges next to dots based on badge column data
      dataset.data.forEach((point, index) => {
        let badgeImageUrl = null;
        const badgeValue = badgesData && badgesData[index] ? badgesData[index].trim() : '';

        // Check badge column value and assign appropriate image
        if (badgeValue.toLowerCase().includes('editor') && editorsPickImage) {
          badgeImageUrl = editorsPickImage;
        } else if (badgeValue.toLowerCase().includes('budget') && budgetBuyImage) {
          badgeImageUrl = budgetBuyImage;
        }

        if (badgeImageUrl && preloadedImages[badgeImageUrl] && meta.data[index]) {
          const dot = meta.data[index];
          const img = preloadedImages[badgeImageUrl];

          // Position badge next to the dot with bounds checking
          const size = 16; // Badge size for scatter
          let x = dot.x + 10; // 10px to the right of dot
          let y = dot.y - 10; // 10px above dot center

          // Ensure badge stays within canvas bounds
          const canvasWidth = chart.width;
          const canvasHeight = chart.height;
          
          // Adjust x position if badge would go off right edge
          if (x + size > canvasWidth) {
            x = dot.x - size - 10; // Position to the left of dot instead
          }
          
          // Adjust y position if badge would go off top edge
          if (y < 0) {
            y = dot.y + 10; // Position below dot instead
          }
          
          // Adjust y position if badge would go off bottom edge
          if (y + size > canvasHeight) {
            y = canvasHeight - size - 5; // 5px margin from bottom
          }

          ctx.drawImage(img, x, y, size, size);
        }
      });
    }

    ctx.restore();
  }
});

// BAR CONFIG
function getBarConfig({ labels, values, badges, overlays, colors, barColor, title, preloadedImages = {}, editorsPickImage, budgetBuyImage }) {

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
              afterLabel: (ctx) => {
                      const i = ctx.dataIndex;
                      const lines = [];
                      
                      if (overlays[i]) {
                          // each item should be on it's own line
                          const overlayParts = overlays[i].split(' • ');
                          lines.push(...overlayParts);
                      }
                      
                      // Add badge information if present
                      if (badges && badges[i] && badges[i].trim() !== '') {
                          const globalSettings = window.gstcGlobalBadges || {};
                          const badgeValue = badges[i].toLowerCase();
                          let badgeText = badges[i]; // fallback to original value
                          
                          if (badgeValue.includes('editor') && globalSettings.editor_pick_badge_text) {
                              badgeText = globalSettings.editor_pick_badge_text;
                          } else if (badgeValue.includes('budget') && globalSettings.budget_badge_text) {
                              badgeText = globalSettings.budget_badge_text;
                          }
                          
                          lines.push(`**${badgeText}**`); 
                      }
                      
                      return lines;
              },
          }
        } : {
          callbacks: {
              afterLabel: (ctx) => {
                  const i = ctx.dataIndex;
                  // Add badge information even when no overlays
                  if (badges && badges[i] && badges[i].trim() !== '') {
                      const globalSettings = window.gstcGlobalBadges || {};
                      const badgeValue = badges[i].toLowerCase();
                      let badgeText = badges[i]; // fallback to original value
                      
                      if (badgeValue.includes('editor') && globalSettings.editor_pick_badge_text) {
                          badgeText = globalSettings.editor_pick_badge_text;
                      } else if (badgeValue.includes('budget') && globalSettings.budget_badge_text) {
                          badgeText = globalSettings.budget_badge_text;
                      }
                      
                      return [`**${badgeText}**`]; 
                  }
                  return '';
              },
          },
        },
      }
    },
    plugins: [circleLabelsPlugin, createBadgePlugin(preloadedImages, badges, editorsPickImage, budgetBuyImage)]
  };
}

// SCATTER CONFIG

function getScatterConfig({ labels, values, badges, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel, preloadedImages = {}, editorsPickImage, budgetBuyImage, axisPrependSymbol, axisSymbolSelection, originalStats = [] }) {
  // 1) Parse labels like "$160" → 160 (handles "$", commas, or plain numbers)
  const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
  const xs = labels.map(toNum);
  const ys = values.map((v) => Number(v));

  // 2) Points with original label for tooltip
  const points = xs.map((x, i) => ({ x, y: ys[i], origLabel: labels[i] ?? '', origPrice: originalStats[i] ?? '' }));

  // detect if prices are all non-negative
  const nonNegativeX = xs.every(n => n >= 0);

  // Calculate dynamic ranges for better tick display
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  
  // Fixed x-axis as requested: 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0

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
          beginAtZero: false,
          min: 3.0,
          max: 5.0,
          ticks: {
            stepSize: 0.1, // Show tick marks every 0.1
            min: 3.0,
            max: 5.0,
            callback: (v) => {
              // Only show labels at 0.2 intervals: 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0
              const labelValues = [3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0];
              if (labelValues.includes(Number(v.toFixed(1)))) {
                const formatted = Number(v).toFixed(1);
                if(axisPrependSymbol && axisSymbolSelection == 'x'){
                  return axisPrependSymbol + formatted;
                } else {
                  return formatted;
                }
              }
              return ''; // Hide labels for other values
            },
          },
          grid: {
            display: true,
            color: (context) => {
              const value = Number(context.tick.value.toFixed(1));
              const labelValues = [3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.2, 4.4, 4.6, 4.8, 5.0];
              // Only show grid lines on unlabeled values (the "off values")
              return labelValues.includes(value) ? 'transparent' : '#e5e5e5';
            },
            lineWidth: 0.5
          },
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
            callback: (v) => {
              if (axisPrependSymbol && axisSymbolSelection == 'y') {
                return axisPrependSymbol + v;
              } else {
                return v;
              }
            },
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
              // Find all points at the same coordinates as the hovered point
              const hoveredPoint = ctx[0];
              const hoveredX = hoveredPoint.parsed.x;
              const hoveredY = hoveredPoint.parsed.y;
              
              // Find all overlapping points
              const overlappingTitles = [];
              points.forEach((point, index) => {
                if (Math.abs(point.x - hoveredX) < 0.001 && Math.abs(point.y - hoveredY) < 0.001) {
                  if (overlays[index]) {
                    const overlayParts = overlays[index].split(' • ');
                    const title = overlayParts[0] || '';
                    if (title && !overlappingTitles.includes(title)) {
                      overlappingTitles.push(title);
                    }
                  }
                }
              });
              
              return overlappingTitles;
            },
            label: (ctx) => {
              // Show axis values only once since overlapping points have same coordinates
              const lines = [];
              
              if (xAxisLabel) {
                const hasDollar = labels.some(l => String(l).includes('$'));
                const xValue = hasDollar ? `$${ctx.parsed.x}` : ctx.parsed.x;
                lines.push(`${xAxisLabel}: ${xValue}`);
              }
              if (yAxisLabel) {
                const p = ctx.raw;
                lines.push(`${yAxisLabel}: ${p.origPrice || ctx.parsed.y}`);
              }
              
              return lines;
            },
            afterLabel: (ctx) => {
              // Find all points at the same coordinates
              const hoveredX = ctx.parsed.x;
              const hoveredY = ctx.parsed.y;

              const allLines = [];
              const overlappingProducts = [];

              // First, collect all overlapping products
              points.forEach((point, index) => {
                if (Math.abs(point.x - hoveredX) < 0.001 && Math.abs(point.y - hoveredY) < 0.001) {
                  overlappingProducts.push(index);
                }
              });

              // Then, show each product's complete information
              overlappingProducts.forEach((index, productIndex) => {
                const productLines = [];

                if (overlays[index]) {
                  // Show remaining overlay items (skip first one used as title)
                  const overlayParts = overlays[index].split(' • ');
                  productLines.push(...overlayParts.slice(1));
                }

                // Add badge information if present for THIS specific product
                if (badges && badges[index] && badges[index].trim() !== '') {
                  const globalSettings = window.gstcGlobalBadges || {};
                  const badgeValue = badges[index].toLowerCase();
                  let badgeText = badges[index]; // fallback to original value

                  if (badgeValue.includes('editor') && globalSettings.editor_pick_badge_text) {
                    badgeText = globalSettings.editor_pick_badge_text;
                  } else if (badgeValue.includes('budget') && globalSettings.budget_badge_text) {
                    badgeText = globalSettings.budget_badge_text;
                  }

                  productLines.push(`**${badgeText}**`);
                }

                allLines.push(...productLines);

                // Add separator between products (but not after the last one)
                if (productIndex < overlappingProducts.length - 1) {
                  allLines.push('---'); // Visual separator
                }
              });

              return allLines;
            },
          },
        } : {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              return `${p.origLabel || `${ctx.parsed.x}`}: ${p.origPrice || ctx.parsed.y}`;
            },
            afterLabel: (ctx) => {
              const i = ctx.dataIndex;
              // Add badge information even when no overlays
              if (badges && badges[i] && badges[i].trim() !== '') {
                const globalSettings = window.gstcGlobalBadges || {};
                const badgeValue = badges[i].toLowerCase();
                let badgeText = badges[i]; // fallback to original value
                
                if (badgeValue.includes('editor') && globalSettings.editor_pick_badge_text) {
                    badgeText = globalSettings.editor_pick_badge_text;
                } else if (badgeValue.includes('budget') && globalSettings.budget_badge_text) {
                    badgeText = globalSettings.budget_badge_text;
                }
                
                return [`**${badgeText}**`]; 
              }
              return '';
            },
          },
        },
      },
    },
    plugins: [createBadgePlugin(preloadedImages, badges, editorsPickImage, budgetBuyImage)],
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
  // Get global badge settings (these should be available globally)
  const globalBadges = window.gstcGlobalBadges || {};
  const editorsPickImage = globalBadges.editor_pick_badge_image || '';
  const budgetBuyImage = globalBadges.budget_badge_image || '';
  

  const axisPrependSymbol = blockEl.dataset.axisPrependSymbol || '';
  const axisSymbolSelection = blockEl.dataset.axisSymbolSelection || '';

  const canvas = blockEl.querySelector('canvas.sheets-chart-canvas');
  if (!canvas) return;

  try {
    const data = await getCachedData(blockId);
    let { labels, values, badges, overlays, originalStats } = normalizeForChart(data);



    // Apply sorting for bar charts only
    if (chartType === 'bar') {
      const sorted = sortChartData(labels, values, badges, overlays, sortOrder);
      labels = sorted.labels;
      values = sorted.values;
      badges = sorted.badges;
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

    // Preload badge images
    const preloadImages = async () => {
      const imagesToLoad = [];
      const preloadedImages = {};
      
      if (editorsPickImage) {
        imagesToLoad.push(editorsPickImage);
      }
      if (budgetBuyImage) {
        imagesToLoad.push(budgetBuyImage);
      }
      
      const loadPromises = imagesToLoad.map(url => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            preloadedImages[url] = img;
            resolve();
          };
          img.onerror = () => resolve(); // Continue even if image fails to load
          img.src = url;
        });
      });
      
      await Promise.all(loadPromises);
      return preloadedImages;
    };

    const preloadedImages = await preloadImages();

    const ctx = canvas.getContext('2d');

    const config = (chartType === 'scatter')
      ? getScatterConfig({ labels, values, badges, overlays, colors, barColor, title, xAxisLabel, yAxisLabel, trendlineLabel, preloadedImages, editorsPickImage, budgetBuyImage, axisPrependSymbol, axisSymbolSelection, originalStats })
      : getBarConfig({ labels, values, badges, overlays, colors, barColor, title, preloadedImages, editorsPickImage, budgetBuyImage });

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
