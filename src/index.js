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
        const { title, sheetId, label, stats, overlay, overlays, barColor, chartType, blockId, xAxisLabel, yAxisLabel, axisPrependSymbol, axisSymbolSelection, trendlineLabel, xAxisData, yAxisData, sortOrder, editorsPickText, editorsPickImage, budgetBuyText, budgetBuyImage } = attributes;
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
        // data = { labels: string[], stats: string[], overlays: [{header, values, range}] }
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
        const createBadgePlugin = (preloadedImages, overlaysData) => ({
            id: 'badgePlugin',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                const meta = chart.getDatasetMeta(0);
                const dataset = chart.data.datasets[0];

                ctx.save();

                // Get badge configurations
                const editorsPickText = attributes.editorsPickText;
                const editorsPickImage = attributes.editorsPickImage;
                const budgetBuyText = attributes.budgetBuyText;
                const budgetBuyImage = attributes.budgetBuyImage;

                if (chart.config.type === 'bar') {
                    // For bar charts - display badges at the end of matching bars
                    chart.data.labels.forEach((label, index) => {
                        let badgeImageUrl = null;

                        // Check for matches
                        if (editorsPickText && label === editorsPickText && editorsPickImage) {
                            badgeImageUrl = editorsPickImage;
                        } else if (budgetBuyText && label === budgetBuyText && budgetBuyImage) {
                            badgeImageUrl = budgetBuyImage;
                        }

                        if (badgeImageUrl && preloadedImages[badgeImageUrl] && meta.data[index]) {
                            const bar = meta.data[index];
                            const img = preloadedImages[badgeImageUrl];

                            // Position badge at the end of the bar
                            const x = bar.x + 15; // 15px to the right of bar end
                            const y = bar.y - 10; // Slightly above center
                            const size = 20; // Badge size

                            ctx.drawImage(img, x, y, size, size);
                        }
                    });
                } else if (chart.config.type === 'scatter') {
                    // For scatter charts - display badges next to matching dots
                    dataset.data.forEach((point, index) => {
                        let badgeImageUrl = null;

                        // For scatter charts, get product name from the passed overlaysData
                        let productName = '';

                        // Use the overlaysData parameter which contains the correct normalized data
                        if (overlaysData && overlaysData.length > 0 && overlaysData[index]) {
                            // Extract product name from the overlay string (e.g., "Product: Six Moon Designs Wy'East")
                            const overlayParts = overlaysData[index].split(' • ');
                            const rawProductName = overlayParts[0] || '';
                            // Remove "Product: " prefix if it exists
                            productName = rawProductName.replace(/^Product:\s*/, '');
                        }

                        // Check for matches (case-insensitive and trimmed)
                        const normalizedProductName = productName.trim().toLowerCase();
                        const normalizedEditorsPickText = (editorsPickText || '').trim().toLowerCase();
                        const normalizedBudgetBuyText = (budgetBuyText || '').trim().toLowerCase();

                        if (editorsPickText && normalizedProductName === normalizedEditorsPickText && editorsPickImage) {
                            badgeImageUrl = editorsPickImage;
                        } else if (budgetBuyText && normalizedProductName === normalizedBudgetBuyText && budgetBuyImage) {
                            badgeImageUrl = budgetBuyImage;
                        }

                        if (badgeImageUrl && preloadedImages[badgeImageUrl] && meta.data[index]) {
                            const dot = meta.data[index];
                            const img = preloadedImages[badgeImageUrl];

                            // Position badge next to the dot
                            const x = dot.x + 10; // 10px to the right of dot
                            const y = dot.y - 10; // 10px above dot center
                            const size = 16; // Badge size for scatter

                            ctx.drawImage(img, x, y, size, size);
                        }
                    });
                }

                ctx.restore();
            }
        });

        // helper for chartType config settings
        function getChartConfig(type, { labels, values, overlays, colors, barColor, preloadedImages = {} }) {
            if (type === 'scatter') {
                // 1) Parse labels like "$160" → 160 (handles "$", commas, or plain numbers)
                const toNum = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
                const xs = labels.map(toNum);
                const ys = values.map((v) => Number(v));

                // 2) Points with original label for tooltip
                const points = xs.map((x, i) => ({ x, y: ys[i], origLabel: labels[i] ?? '' }));

                // detect if prices are all non-negative
                const nonNegativeX = xs.every(n => n >= 0);

                // Calculate dynamic ranges for better tick display
                const xMin = Math.min(...xs);
                const xMax = Math.max(...xs);
                const yMin = Math.min(...ys);
                const yMax = Math.max(...ys);

                // Calculate appropriate step size for ticks
                const getStepSize = (min, max) => {
                    const range = max - min;
                    if (range <= 1) return 0.1;
                    if (range <= 2) return 0.2;
                    if (range <= 5) return 0.5;
                    if (range <= 10) return 1;
                    return Math.ceil(range / 6);
                };

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
                                beginAtZero: false, // let it auto-scale based on data
                                min: xMin - (xMax - xMin) * 0.05, // 5% padding below min
                                max: xMax + (xMax - xMin) * 0.05, // 5% padding above max
                                ticks: {
                                    stepSize: getStepSize(xMin, xMax),
                                    callback: (v) => {
                                        // Format to appropriate decimal places
                                        const formatted = Number(v).toFixed(1);
                                        if (axisPrependSymbol && axisSymbolSelection == 'x') {
                                            return axisPrependSymbol + formatted;
                                        } else {
                                            return formatted;
                                        }
                                    },
                                },
                                grid: { display: false },
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
                                        const i = ctx[0].dataIndex;
                                        if (overlays[i]) {
                                            // Extract first overlay item as title (before first bullet)
                                            const overlayParts = overlays[i].split(' • ');
                                            return overlayParts[0] || '';
                                        }
                                        return '';
                                    },
                                    label: (ctx) => {
                                        const hasDollar = labels.some(l => String(l).includes('$'));
                                        const xValue = hasDollar ? `$${ctx.parsed.x}` : ctx.parsed.x;

                                        // Show axis values with their labels
                                        const lines = [];
                                        if (attributes.xAxisLabel) {
                                            lines.push(`${attributes.xAxisLabel}: ${xValue}`);
                                        }
                                        if (attributes.yAxisLabel) {
                                            lines.push(`${attributes.yAxisLabel}: ${ctx.parsed.y}`);
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
                    plugins: [createBadgePlugin(preloadedImages, overlays)],
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
                                    if (overlays[i]) {
                                        // each item should be on it's own line
                                        const overlayParts = overlays[i].split(' • ');
                                        return overlayParts;
                                    }
                                    return '';
                                },
                            },
                        } : {},
                    },
                },
                plugins: [circleLabelsPlugin, createBadgePlugin(preloadedImages, overlays)],
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

            let { labels, values, overlays } = normalizeForChart(previewData);



            // Apply sorting for bar charts only
            if (attributes.chartType === 'bar') {
                const sorted = sortChartData(labels, values, overlays, attributes.sortOrder);
                labels = sorted.labels;
                values = sorted.values;
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

                if (attributes.editorsPickImage) {
                    imagesToLoad.push(attributes.editorsPickImage);
                }
                if (attributes.budgetBuyImage) {
                    imagesToLoad.push(attributes.budgetBuyImage);
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
                    overlays,
                    colors,
                    barColor: attributes.barColor || '#3b82f6',
                    preloadedImages
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

        }, [previewData, attributes.barColor, attributes.chartType, attributes.xAxisLabel, attributes.yAxisLabel, attributes.trendlineLabel, attributes.sortOrder, attributes.axisPrependSymbol, attributes.axisSymbolSelection, attributes.editorsPickText, attributes.editorsPickImage, attributes.budgetBuyText, attributes.budgetBuyImage]);

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

                                    // Editors Pick Badge Section
                                    createElement(
                                        'div',
                                        { style: { marginTop: '2rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' } },
                                        createElement('h4', { style: { margin: '0 0 1rem 0', fontSize: '14px', fontWeight: '600' } }, 'Editor\'s Pick Badge'),
                                        createElement(TextControl, {
                                            label: 'Product Name to Match',
                                            value: editorsPickText || '',
                                            onChange: (value) => setAttributes({ editorsPickText: value }),
                                            help: 'Enter the exact product name to show the Editor\'s Pick badge'
                                        }),
                                        createElement(
                                            'div',
                                            { style: { marginTop: '1rem' } },
                                            createElement('label', { style: { display: 'block', marginBottom: '0.5rem', fontSize: '13px', fontWeight: '500' } }, 'Badge Image'),
                                            createElement(MediaUploadCheck, null,
                                                createElement(MediaUpload, {
                                                    onSelect: (media) => setAttributes({ editorsPickImage: media.url }),
                                                    allowedTypes: ['image'],
                                                    value: editorsPickImage,
                                                    render: ({ open }) => createElement(
                                                        'div',
                                                        null,
                                                        editorsPickImage ? createElement(
                                                            'div',
                                                            null,
                                                            createElement('img', {
                                                                src: editorsPickImage,
                                                                style: { maxWidth: '100px', height: 'auto', marginBottom: '0.5rem' }
                                                            }),
                                                            createElement(Button, {
                                                                onClick: open,
                                                                variant: 'secondary',
                                                                style: { marginRight: '0.5rem' }
                                                            }, 'Change Image'),
                                                            createElement(Button, {
                                                                onClick: () => setAttributes({ editorsPickImage: '' }),
                                                                variant: 'link',
                                                                isDestructive: true
                                                            }, 'Remove')
                                                        ) : createElement(Button, {
                                                            onClick: open,
                                                            variant: 'secondary'
                                                        }, 'Upload Badge Image')
                                                    )
                                                })
                                            )
                                        )
                                    ),

                                    // Budget Buy Badge Section
                                    createElement(
                                        'div',
                                        { style: { marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '4px' } },
                                        createElement('h4', { style: { margin: '0 0 1rem 0', fontSize: '14px', fontWeight: '600' } }, 'Budget Buy Badge'),
                                        createElement(TextControl, {
                                            label: 'Product Name to Match',
                                            value: budgetBuyText || '',
                                            onChange: (value) => setAttributes({ budgetBuyText: value }),
                                            help: 'Enter the exact product name to show the Budget Buy badge'
                                        }),
                                        createElement(
                                            'div',
                                            { style: { marginTop: '1rem' } },
                                            createElement('label', { style: { display: 'block', marginBottom: '0.5rem', fontSize: '13px', fontWeight: '500' } }, 'Badge Image'),
                                            createElement(MediaUploadCheck, null,
                                                createElement(MediaUpload, {
                                                    onSelect: (media) => setAttributes({ budgetBuyImage: media.url }),
                                                    allowedTypes: ['image'],
                                                    value: budgetBuyImage,
                                                    render: ({ open }) => createElement(
                                                        'div',
                                                        null,
                                                        budgetBuyImage ? createElement(
                                                            'div',
                                                            null,
                                                            createElement('img', {
                                                                src: budgetBuyImage,
                                                                style: { maxWidth: '100px', height: 'auto', marginBottom: '0.5rem' }
                                                            }),
                                                            createElement(Button, {
                                                                onClick: open,
                                                                variant: 'secondary',
                                                                style: { marginRight: '0.5rem' }
                                                            }, 'Change Image'),
                                                            createElement(Button, {
                                                                onClick: () => setAttributes({ budgetBuyImage: '' }),
                                                                variant: 'link',
                                                                isDestructive: true
                                                            }, 'Remove')
                                                        ) : createElement(Button, {
                                                            onClick: open,
                                                            variant: 'secondary'
                                                        }, 'Upload Badge Image')
                                                    )
                                                })
                                            )
                                        )
                                    )
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
