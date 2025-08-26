import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TabPanel, TextControl, Button, Tooltip, ColorPicker } from '@wordpress/components';
import { createElement, useState, useRef, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import Chart from 'chart.js/auto';
import { color } from 'chart.js/helpers';

registerBlockType('sheets/chart-block', {
    title: 'Sheets Chart Block',
    icon: 'chart-bar',
    category: 'widgets',

    attributes: {
        sheetId: { type: 'string', default: '' },
        label: { type: 'string', default: 'A2:A13' },
        stats: { type: 'string', default: 'O2:O13' },
        overlay: { type: 'string', default: 'B2:B13' },
        barColor:{ type: 'string', default: '#3b82f6' }
    },

    edit: ({ attributes, setAttributes }) => {
        const { sheetId, label, stats, overlay, barColor } = attributes;
        const blockProps = useBlockProps();
        const [status, setStatus] = useState('');
        const [previewData, setPreviewData] = useState(null);
        const canvasRef = useRef(null);
        const chartRef = useRef(null);

        // helper function to normalize data for chart
        const normalizeForChart = (data) => {
            if (!data) return { labels: [], values: [], overlays: [] };

            const [labelsRaw, valuesRaw, overlaysRaw] = Object.values(data);

            const labels = (labelsRaw || []).map(r => String(r?.[0] ?? ''));
            const values = (valuesRaw || []).map(r => {
                const raw = String(r?.[0] ?? '');
                const num = parseFloat(raw.replace(/[^\d.-]/g, ''));
                return Number.isFinite(num) ? num : 0;
            });
            const overlays = (overlaysRaw || []).map(r => String(r?.[0] ?? ''));

            return { labels, values, overlays };
        };

        // helper function to create plugin for custom chart labels 
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
                await apiFetch({
                path: '/sheets-chart/v1/fetch-data',
                method: 'POST',
                data: { sheetId, label, stats, overlay },
                });
                setStatus('Data fetched successfully.');
            } catch (err) {
                console.error(err);
                setStatus(`Error: ${err?.message || 'Request failed'}`);
            }
        };

        const loadPreview = async () => {
            if (!sheetId) return;
            try {
            const data = await apiFetch({
                path: `/sheets-chart/v1/cached?sheetId=${encodeURIComponent(sheetId)}`,
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

        const { labels, values, overlays } = normalizeForChart(previewData);

        // apply opacity to colors for bar rankings
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);

        const colors = values.map(v => {
            // normalize value → between 0.5 (lowest opacity) and 1 (fully opaque)
            const t = (v - minVal) / (maxVal - minVal); 
            const alpha = 0.5 + t * 0.5; // range 0.5 → 1
            return addAlphaToHex(attributes.barColor || '#3b82f6', alpha);
        });

        if (!chartRef.current) {
            // first render: create chart
            const ctx = canvasRef.current.getContext('2d');
            chartRef.current = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                label: 'Rating',
                data: values,
                backgroundColor: colors,
                borderColor:   attributes.barColor,
                borderRadius: 20,
                borderWidth: 1
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { display: false },
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#000', font: { size: 14 }},
                    },
                },
                elements: {
                    categoryPercentage: 1.5
                },
                plugins: {
                tooltip: overlays.length ? {
                    callbacks: {
                    afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
                    }
                } : {},
                legend: {
                    display: false
                },
                }
            },
            plugins: [circleLabelsPlugin],
            });
        } else {
            // updates: mutate and update
            const chart = chartRef.current;
            chart.data.labels = labels;
            chart.data.datasets[0].data = values;
            chart.data.datasets[0].backgroundColor = attributes.barColor || '#3b82f6';
            chart.data.datasets[0].borderColor     = attributes.barColor || '#3b82f6';
            chart.options.plugins.tooltip = overlays.length ? {
            callbacks: {
                afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
            }
            } : {};
            chart.update();
        }
        }, [previewData, attributes.barColor]);  // redraw when data OR color changes

        // loads the preview up  
        useEffect(() => {
            loadPreview();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sheetId, label, stats, overlay]);

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
                { name: 'data',  title: 'Data',  className: 'sheets-chart-tab' },
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
                )
                );
            }

            // --- DATA TAB ---
            return createElement(
                'div',
                { style: { marginTop: '1rem' } },
                createElement(TextControl, {
                label: 'Google Sheet ID',
                value: sheetId,
                onChange: (value) => setAttributes({ sheetId: value }),
                help: 'Paste the ID from the Google Sheet URL'
                }),
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
                onChange: (value) => setAttributes({ stats: value }), // correct target
                help: 'Enter the range of stats you want to display, e.g., O2:O13'
                }),
                createElement(TextControl, {
                label: 'Overlay Range',
                value: overlay,
                placeholder: 'B2:B13',
                onChange: (value) => setAttributes({ overlay: value }), // correct target
                help: 'Enter the overlay data range, e.g., B2:B13'
                }),

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
                    createElement(Button, { variant: 'secondary', onClick: fetchData }, 'Refresh Data')
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
            { style: { marginTop: '0.5rem', height: '420px', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px' } },
            createElement('canvas', { ref: canvasRef, style: { width: '100%', height: '100%' } })
        )
        )
    )
    );


    },
    save: ({ attributes }) => {
        const { sheetId, label, stats, overlay } = attributes;

    return createElement(
        'div',
        {
            className: 'sheets-chart-block',
            'data-sheet-id': sheetId,
            'data-label': label,
            'data-stats': stats,
            'data-overlay': overlay
        },
        `Sheet ID: ${sheetId}, Label Range: ${label}`
    );
    }
});
