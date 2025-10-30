import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TabPanel, TextControl, Button, Tooltip, ColorPicker, RadioControl } from '@wordpress/components';
import { MediaUpload, MediaUploadCheck } from '@wordpress/block-editor';
import { createElement, useState, useRef, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import Chart from 'chart.js/auto';
import metadata from './block.json';
import { toFont } from 'chart.js/helpers';
import trendlinePlugin from 'chartjs-plugin-trendline';
Chart.register(trendlinePlugin);

registerBlockType(metadata, {

    edit: ({ attributes, setAttributes }) => {
        const { title, sheetId, label, stats, overlay, overlays, barColor, chartType, blockId, xAxisLabel, yAxisLabel, axisPrependSymbol, axisSymbolSelection, trendlineLabel, xAxisData, yAxisData, sortOrder } = attributes;
        const blockProps = useBlockProps();
        const [status, setStatus] = useState('');
        const [previewData, setPreviewData] = useState(null);
        const canvasRef = useRef(null);
        const chartRef = useRef(null);

        // set the blockId once persists after 
        useEffect(() => {
            if (!blockId) {
                const id =
                    (window.crypto?.randomUUID?.() ??
                        (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)))
                        .toLowerCase();

                setAttributes({ blockId: id });
            }
        }, [blockId, setAttributes]);

        // helper function to normalize data for chart
        // data = { labels: string[], stats: string[], badges: string[], overlays: [{header, values, range}] }
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

        // helper function to create plugin for custom chart labels 
        const circleLabelsPlugin = {

            id: 'circleLabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                const meta = chart.getDatasetMeta(0);
                const dataset = chart.data.datasets[0];
                const f = toFont({ family: Chart.defaults.font.family, size: 10, weight: '700' });
                ctx.font = f.string;
                ctx.save();
                meta.data.forEach((bar, index) => {
                    const value = dataset.data[index];
                    const x = bar.x - 10;
                    const y = bar.y;

                    // Draw circle
                    ctx.beginPath();
                    ctx.arc(x, y, 10, 0, 2 * Math.PI);
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = dataset.backgroundColor;
                    ctx.stroke();

                    // Draw value text
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
        const createBadgePlugin = (preloadedImages, badgesData) => ({
            id: 'badgePlugin',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                const meta = chart.getDatasetMeta(0);
                const dataset = chart.data.datasets[0];

                ctx.save();

                // Get badge configurations from global settings
                const globalSettings = window.gstcSettings?.badgeSettings || {};
                const editorsPickImage = globalSettings.editor_pick_badge_image;
                const budgetBuyImage = globalSettings.budget_badge_image;



                if (chart.config.type === 'bar') {
                    // For bar charts - display badges at the end of bars based on badge column data
                    chart.data.labels.forEach((label, index) => {
                        let badgeImageUrl = null;
                        const badgeValue = badgesData && badgesData[index] ? badgesData[index].trim() : '';

                        // Check badge column value and assign appropriate image
                        if (badgeValue && badgeValue.toLowerCase().includes('editor') && editorsPickImage) {
                            badgeImageUrl = editorsPickImage;
                        } else if (badgeValue && badgeValue.toLowerCase().includes('budget') && budgetBuyImage) {
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
                        if (badgeValue && badgeValue.toLowerCase().includes('editor') && editorsPickImage) {
                            badgeImageUrl = editorsPickImage;
                        } else if (badgeValue && badgeValue.toLowerCase().includes('budget') && budgetBuyImage) {
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

        // helper for chartType config settings
        function getChartConfig(type, { labels, values, badges, overlays, colors, barColor, preloadedImages = {}, originalStats = [] }) {
            if (type === 'scatter') {
                // 1) Parse labels like "$160" → 160 (handles "$", commas, or plain numbers)
                const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
                const xs = labels.map(toNum);
                const ys = values.map((v) => Number(v));

                // 2) Points with original label for tooltip
                const points = xs.map((x, i) => ({ x, y: ys[i], origLabel: labels[i] ?? '', origPrice: originalStats[i] ?? '' }));

                // Calculate dynamic ranges for better tick display
                const xMin = Math.min(...xs);
                const xMax = Math.max(...xs);

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
                                lineStyle: 'solid',
                                width: 3,
                                projection: true,
                                label: {
                                    text: attributes.trendlineLabel || 'Trendline',
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
                                            if (axisPrependSymbol && axisSymbolSelection == 'x') {
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
                                    display: !!attributes.xAxisLabel,
                                    text: attributes.xAxisLabel || '',
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
                                    display: !!attributes.yAxisLabel,
                                    text: attributes.yAxisLabel || '',
                                    font: { size: 14 },
                                },
                            },
                        },
                        plugins: {
                            legend: { display: false },
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

                                        if (attributes.xAxisLabel) {
                                            const hasDollar = labels.some(l => String(l).includes('$'));
                                            const xValue = hasDollar ? `$${ctx.parsed.x}` : ctx.parsed.x;
                                            lines.push(`${attributes.xAxisLabel}: ${xValue}`);
                                        }
                                        if (attributes.yAxisLabel) {
                                            const p = ctx.raw;
                                            lines.push(`${attributes.yAxisLabel}: ${p.origPrice || ctx.parsed.y}`);
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
                                                const globalSettings = window.gstcSettings?.badgeSettings || {};
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
                                            const globalSettings = window.gstcSettings?.badgeSettings || {};
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
                    plugins: [createBadgePlugin(preloadedImages, badges)],
                };
            }


            // default: bar
            return {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Rating',
                        data: values,
                        backgroundColor: colors,
                        borderRadius: 20,
                        borderWidth: 0,
                    }],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { display: false, drawBorder: false }, ticks: { display: false } },
                        y: { grid: { display: false, drawBorder: false }, ticks: { color: '#000', font: { size: 14 } }, drawBorder: false },
                    },
                    elements: { categoryPercentage: 1.5 },
                    plugins: {
                        legend: { display: false },
                        title: {
                            display: !!title,
                            text: title,
                            font: {
                                size: 20,
                                family: 'Montserrat'
                            },
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
                                        const globalSettings = window.gstcSettings?.badgeSettings || {};
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
                            },
                        } : {
                            callbacks: {
                                afterLabel: (ctx) => {
                                    const i = ctx.dataIndex;
                                    // Add badge information even when no overlays
                                    if (badges && badges[i] && badges[i].trim() !== '') {
                                        const globalSettings = window.gstcSettings?.badgeSettings || {};
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
                plugins: [circleLabelsPlugin, createBadgePlugin(preloadedImages, badges)],
            };
        }


        // helper function to generate opacity for each bar 
        function addAlphaToHex(baseColor, alpha) {
            // strip leading "#" if present
            const hex = baseColor.replace('#', '');

            const fullHex = hex.length === 3
                ? hex.split('').map(x => x + x).join('')
                : hex;

            const alphaHex = Math.round(alpha * 255)
                .toString(16)
                .padStart(2, '0');

            return `#${fullHex}${alphaHex}`;
        }

        const fetchData = async () => {

            setStatus('Fetching...');
            try {
                // Use different data ranges based on chart type
                const dataToSend = chartType === 'scatter'
                    ? { sheetId, blockId, label: xAxisData, stats: yAxisData, overlays }
                    : { sheetId, blockId, label, stats, overlays };

                await apiFetch({
                    path: '/sheets-chart/v1/fetch-data',
                    method: 'POST',
                    data: dataToSend,
                });
                setStatus('Data fetched successfully.');
            } catch (err) {
                console.error(err);
                setStatus(`Error: ${err?.message || 'Request failed'}`);
            }
        };

        const refreshData = async () => {

            setStatus('Refreshing...');
            try {
                // Use different data ranges based on chart type
                const dataToSend = chartType === 'scatter'
                    ? { sheetId, blockId, label: xAxisData, stats: yAxisData, overlays }
                    : { sheetId, blockId, label, stats, overlays };

                await apiFetch({
                    path: '/sheets-chart/v1/refresh-fetch-data',
                    method: 'POST',
                    data: dataToSend,
                });
                setStatus('Data refreshed successfully.');
                // Reload the preview to get the fresh data
                await loadPreview();
            } catch (err) {
                console.error(err);
                setStatus(`Error: ${err?.message || 'Request failed'}`);
            }

        }

        const loadPreview = async () => {

            if (!sheetId || !blockId) return;

            try {
                const data = await apiFetch({
                    path: `/sheets-chart/v1/cached?blockId=${encodeURIComponent(blockId)}`,
                    method: 'GET',
                });

                setPreviewData(data);
                setStatus('');

            } catch (e) {
                setPreviewData(null);
                setStatus('No cached data yet. Click “Fetch Data”.');
            }
        };

        // creates the chart with data, updates on data change or color changes 
        useEffect(() => {
            if (!previewData || !canvasRef.current) return;

            let { labels, values, badges, overlays, originalStats } = normalizeForChart(previewData);



            // Apply sorting for bar charts only
            if (attributes.chartType === 'bar') {
                const sorted = sortChartData(labels, values, badges, overlays, attributes.sortOrder);
                labels = sorted.labels;
                values = sorted.values;
                badges = sorted.badges;
                overlays = sorted.overlays;
            }

            // opacity scaling for colors
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values);
            const denom = Math.max(1, maxVal - minVal); // avoid divide-by-zero
            const colors = values.map(v => {
                const t = (v - minVal) / denom;         // 0..1
                const alpha = 0.5 + t * 0.5;            // 0.5..1
                return addAlphaToHex(attributes.barColor || '#3b82f6', alpha);
            });

            // rebuild chart when type OR data OR color changes
            if (chartRef.current) {
                chartRef.current.destroy();
                chartRef.current = null;
            }

            // Preload badge images
            const preloadImages = async () => {
                const imagesToLoad = [];
                const preloadedImages = {};

                const globalSettings = window.gstcSettings?.badgeSettings || {};
                if (globalSettings.editor_pick_badge_image) {
                    imagesToLoad.push(globalSettings.editor_pick_badge_image);
                }
                if (globalSettings.budget_badge_image) {
                    imagesToLoad.push(globalSettings.budget_badge_image);
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

            const createChart = async () => {
                const preloadedImages = await preloadImages();

                const ctx = canvasRef.current.getContext('2d');
                const cfg = getChartConfig(attributes.chartType, {
                    labels,
                    values,
                    badges,
                    overlays,
                    colors,
                    barColor: attributes.barColor || '#3b82f6',
                    preloadedImages,
                    originalStats
                });

                // set font 
                async function useMontserrat(blockEl) {
                    // ensure the font is ready (modern browsers)
                    try { await (document.fonts?.load('12px "Montserrat"') || Promise.resolve()); } catch { }

                    const color = getComputedStyle(blockEl).color || '#111';

                    Chart.defaults.font.family = '"Montserrat", system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, sans-serif';
                    Chart.defaults.font.size = 14;   // tweak to taste
                    Chart.defaults.font.weight = '400';
                    Chart.defaults.color = color;
                }

                chartRef.current = new Chart(ctx, cfg);
            };

            createChart();

            return () => {
                chartRef.current?.destroy();
                chartRef.current = null;
            };

        }, [previewData, attributes.barColor, attributes.chartType, attributes.xAxisLabel, attributes.yAxisLabel, attributes.trendlineLabel, attributes.sortOrder, attributes.axisPrependSymbol, attributes.axisSymbolSelection]);

        // loads the preview up  
        useEffect(() => {
            loadPreview();
        }, [sheetId, label, stats, overlay, blockId, xAxisData, yAxisData]);

        // repeater style fields for overlay controls 

        // check if overlays exists/is an array/is not empty
        const overlaysArr =
            (attributes.overlays && attributes.overlays.length)
                ? attributes.overlays
                : (attributes.overlay ? [attributes.overlay] : []);

        // update overlay attribute search for value in overlaysArr and replace + clear legacy value if it exists 
        const updateOverlay = (i, value) =>
            setAttributes({
                overlays: overlaysArr.map((r, idx) => (idx === i ? value : r)),
                overlay: '' // clear legacy value
            });

        // add item to overlay attribute
        const addOverlay = () => setAttributes({ overlays: [...overlaysArr, ''] });

        // remove item from overlay attribute
        const removeOverlay = (i) => setAttributes({ overlays: overlaysArr.filter((_, idx) => idx !== i) });

        return createElement(
            'div',
            blockProps,
            // Layout: controls (tabs) + persistent preview
            createElement(
                'div',
                { style: { display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' } },

                // LEFT: Tabs (Data, Style)
                createElement(
                    'div',
                    { style: { flex: '1 1 420px', minWidth: '320px' } },
                    createElement(
                        TabPanel,
                        {
                            className: 'sheets-chart-tabs',
                            activeClass: 'is-active',
                            tabs: [
                                { name: 'data', title: 'Data', className: 'sheets-chart-tab' },
                                { name: 'style', title: 'Style', className: 'sheets-chart-tab' },
                            ],
                        },
                        (tab) => {
                            if (tab.name === 'style') {
                                // --- STYLE TAB ---
                                return createElement(
                                    'div',
                                    { style: { marginTop: '1rem' } },
                                    createElement(
                                        'div',
                                        { style: { marginTop: '0.5rem' } },
                                        createElement('label', { style: { display: 'block', marginBottom: '0.5rem' } }, 'Bar Color'),
                                        createElement(ColorPicker, {
                                            color: attributes.barColor,
                                            enableAlpha: false,
                                            onChange: (value) => {
                                                const color = value?.hex ?? value;
                                                setAttributes({ barColor: color });
                                            }
                                        })
                                    ),


                                );
                            }

                            // --- DATA TAB ---
                            return createElement(
                                'div',
                                { style: { marginTop: '1rem' } },
                                createElement(TextControl, {
                                    label: 'Title',
                                    value: title,
                                    onChange: (value) => setAttributes({ title: value }),
                                    help: 'Add a chart title'
                                }),
                                createElement(RadioControl, {
                                    label: 'Chart Type',
                                    selected: chartType,
                                    options: [
                                        { label: 'Bar', value: 'bar' },
                                        { label: 'Scatter', value: 'scatter' },
                                    ],
                                    onChange: (selected) => setAttributes({ chartType: selected }),
                                    help: 'Select the chart type to use.'
                                }),
                                createElement(TextControl, {
                                    label: 'Google Sheet ID',
                                    value: sheetId,
                                    onChange: (value) => setAttributes({ sheetId: value }),
                                    help: 'Paste the ID from the Google Sheet URL'
                                }),

                                // Conditional data inputs for bar charts
                                chartType === 'bar' && createElement(
                                    'div',
                                    { style: { marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' } },
                                    createElement('h4', { style: { margin: '0 0 0.5rem 0', fontSize: '14px', fontWeight: '600' } }, 'Bar Chart Data'),
                                    createElement(TextControl, {
                                        label: 'Label Range',
                                        value: label,
                                        placeholder: 'A2:A13',
                                        onChange: (value) => setAttributes({ label: value }),
                                        help: 'Enter the range of labels you want to display, e.g., A2:A13'
                                    }),
                                    createElement(TextControl, {
                                        label: 'Stat Range',
                                        value: stats,
                                        placeholder: 'O2:O13',
                                        onChange: (value) => setAttributes({ stats: value }),
                                        help: 'Enter the range of stats you want to display, e.g., O2:O13'
                                    }),
                                    createElement(RadioControl, {
                                        label: 'Sort Order',
                                        selected: sortOrder || 'default',
                                        options: [
                                            { label: 'Default / Sheet Order', value: 'default' },
                                            { label: 'Alphabetical (A→Z)', value: 'alphabetical-asc' },
                                            { label: 'Alphabetical (Z→A)', value: 'alphabetical-desc' },
                                            { label: 'Stat Value (High→Low)', value: 'value-high-low' },
                                            { label: 'Stat Value (Low→High)', value: 'value-low-high' },
                                        ],
                                        onChange: (selected) => setAttributes({ sortOrder: selected }),
                                        help: 'Choose how to sort the bars in the chart.'
                                    })
                                ),

                                // Conditional data inputs for scatter charts
                                chartType === 'scatter' && createElement(
                                    'div',
                                    { style: { marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' } },
                                    createElement('h4', { style: { margin: '0 0 0.5rem 0', fontSize: '14px', fontWeight: '600' } }, 'Scatter Plot Data'),
                                    createElement(TextControl, {
                                        label: 'X-Axis Data Range',
                                        value: xAxisData || '',
                                        placeholder: 'A2:A13',
                                        onChange: (value) => setAttributes({ xAxisData: value }),
                                        help: 'Enter the range for X-axis data, e.g., A2:A13'
                                    }),
                                    createElement(TextControl, {
                                        label: 'Y-Axis Data Range',
                                        value: yAxisData || '',
                                        placeholder: 'B2:B13',
                                        onChange: (value) => setAttributes({ yAxisData: value }),
                                        help: 'Enter the range for Y-axis data, e.g., B2:B13'
                                    }),
                                    createElement(TextControl, {
                                        label: 'Axis Prepend Symbol',
                                        value: axisPrependSymbol || '',
                                        placeholder: 'Add a symbol to prepend on an Axis e.g., $',
                                        onChange: (value) => setAttributes({ axisPrependSymbol: value }),
                                        help: 'Add a symbol to prepend on an Axis e.g., $'
                                    }),
                                    createElement(RadioControl, {
                                        label: 'Axis Symbol Selection',
                                        selected: axisSymbolSelection || 'default',
                                        options: [
                                            { label: 'X', value: 'x' },
                                            { label: 'Y', value: 'y' }
                                        ],
                                        onChange: (selected) => setAttributes({ axisSymbolSelection: selected }),
                                        help: 'Select which axis the symbol should be displayed on'
                                    })
                                ),

                                // Conditional axis label inputs for scatter plots
                                chartType === 'scatter' && createElement(
                                    'div',
                                    { style: { marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' } },
                                    createElement('h4', { style: { margin: '0 0 0.5rem 0', fontSize: '14px', fontWeight: '600' } }, 'Scatter Plot Axis Labels'),
                                    createElement(TextControl, {
                                        label: 'X-Axis Label',
                                        value: xAxisLabel || '',
                                        placeholder: 'e.g., Time, Index, Category',
                                        onChange: (value) => setAttributes({ xAxisLabel: value }),
                                        help: 'Label for the horizontal (X) axis'
                                    }),
                                    createElement(TextControl, {
                                        label: 'Y-Axis Label',
                                        value: yAxisLabel || '',
                                        placeholder: 'e.g., Rating, Score, Value',
                                        onChange: (value) => setAttributes({ yAxisLabel: value }),
                                        help: 'Label for the vertical (Y) axis'
                                    }),
                                    createElement(TextControl, {
                                        label: 'Trendline Label',
                                        value: trendlineLabel || '',
                                        placeholder: 'e.g., Trend, Linear Trend, Best Fit',
                                        onChange: (value) => setAttributes({ trendlineLabel: value }),
                                        help: 'Label that appears when hovering over the trendline'
                                    })
                                ),

                                createElement('label', null, 'Overlay Ranges'),
                                overlaysArr.map((range, i) =>
                                    createElement('div', { key: i, style: { display: 'flex', gap: '8px', marginTop: '8px' } },
                                        createElement(TextControl, {
                                            label: `Overlay Range ${i + 1}`,
                                            value: range,
                                            placeholder: 'B2:B13',
                                            onChange: (v) => updateOverlay(i, v)
                                        }),
                                        createElement(Button, { variant: 'secondary', onClick: () => removeOverlay(i) }, 'Remove')
                                    )
                                ),
                                createElement(Button, { variant: 'primary', onClick: addOverlay, style: { marginTop: '8px' } }, 'Add overlay'),

                                // Buttons row
                                createElement(
                                    'div',
                                    { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
                                    createElement(
                                        Tooltip,
                                        { text: 'Click this to fetch and cache the Google Sheet data.' },
                                        createElement(Button, { variant: 'primary', onClick: fetchData }, 'Fetch Data')
                                    ),
                                    createElement(
                                        Tooltip,
                                        { text: 'If the sheet changed, click to refresh the cache.' },
                                        createElement(Button, { variant: 'secondary', onClick: refreshData }, 'Refresh Data')
                                    ),
                                ),

                                status && createElement('p', { style: { marginTop: '0.5rem', fontSize: '12px', color: '#555' } }, status)
                            );
                        }
                    )
                ),

                // RIGHT: Persistent Preview (always visible)
                createElement(
                    'div',
                    { style: { flex: '1 1 520px', minWidth: '360px' } },
                    createElement('h3', null, 'Preview'),
                    createElement(
                        'div',
                        { style: { marginTop: '0.5rem', height: '420px', borderRadius: '6px', padding: '8px', maxWidth: '800px' } },
                        createElement('canvas', { ref: canvasRef, style: { width: '100%', height: '100%' } })
                    )
                )
            )
        );


    },
    save: ({ attributes }) => {
        const { title, sheetId, label, stats, overlay, overlays = [], barColor, chartType, blockId, xAxisLabel, yAxisLabel, trendlineLabel, xAxisData, yAxisData, sortOrder, editorsPickText, editorsPickImage, budgetBuyText, budgetBuyImage, axisPrependSymbol, axisSymbolSelection } = attributes;
        const overlaysToSave = overlays.length ? overlays : (overlay ? [overlay] : []);

        return createElement(
            'div',
            {
                className: 'sheets-chart-block',
                'data-block-id': blockId,
                'data-chart-type': chartType,
                'data-sheet-title': title,
                'data-sheet-id': sheetId,
                'data-label': label,
                'data-stats': stats,
                'data-overlay': overlay,
                'data-overlays': JSON.stringify(overlaysToSave),
                'data-bar-color': barColor || '#3b82f6',
                'data-x-axis-label': xAxisLabel ?? '',
                'data-y-axis-label': yAxisLabel ?? '',
                'data-trendline-label': trendlineLabel ?? '',
                'data-x-axis-data': xAxisData ?? '',
                'data-y-axis-data': yAxisData ?? '',
                'data-sort-order': sortOrder ?? 'default',
                'data-editors-pick-text': editorsPickText ?? '',
                'data-editors-pick-image': editorsPickImage ?? '',
                'data-budget-buy-text': budgetBuyText ?? '',
                'data-budget-buy-image': budgetBuyImage ?? '',
                'data-axis-prepend-symbol': axisPrependSymbol ?? '',
                'data-axis-symbol-selection': axisSymbolSelection ?? ''
            },
            createElement('div', { className: 'sheets-chart-canvas-wrap', style: { height: '420px', maxWidth: '800px' } },
                createElement('canvas', { className: 'sheets-chart-canvas' })
            )
        );
    }
});
