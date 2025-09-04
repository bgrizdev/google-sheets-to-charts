import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TabPanel, TextControl, Button, Tooltip, ColorPicker, RadioControl } from '@wordpress/components';
import { createElement, useState, useRef, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import Chart from 'chart.js/auto';
//import { color } from 'chart.js/helpers';

registerBlockType('sheets/chart-block', {
    title: 'Sheets Chart Block',
    icon: 'chart-bar',
    category: 'widgets',

    attributes: {
        sheetId: { type: 'string', default: '' },
        label: { type: 'string', default: 'A2:A13' },
        stats: { type: 'string', default: 'O2:O13' },
        overlay: { type: 'string', default: 'B2:B13' },
        overlays:{ type: 'array',  default: ['B2:B13'] },
        barColor:{ type: 'string', default: '#3b82f6' },
        chartType:{ type: 'string', default: 'bar' },
    },

    edit: ({ attributes, setAttributes }) => {
        const { sheetId, label, stats, overlay, overlays, barColor, chartType } = attributes;
        const blockProps = useBlockProps();
        const [status, setStatus] = useState('');
        const [previewData, setPreviewData] = useState(null);
        const canvasRef = useRef(null);
        const chartRef = useRef(null);

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

        // helper for chartType config settings
        function getChartConfig(type, { labels, values, overlays, colors, barColor }) {
            if (type === 'scatter') {
                // Scatter expects [{x, y}] points and linear scales
                const points = values.map((y, i) => ({ x: i, y }));
                return {
                type: 'scatter',
                data: {
                    // labels are optional for scatter; we’ll show them in tooltip
                    datasets: [{
                    label: 'Rating',
                    data: points,
                    backgroundColor: colors,
                    borderColor: barColor,
                    pointRadius: 5,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                    x: {
                        type: 'linear',
                        ticks: {
                        // show original labels for indices
                        callback: (value) => labels[value] ?? value,
                        },
                        grid: { display: false },
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#000', font: { size: 14 } },
                    },
                    },
                    plugins: {
                    legend: { display: false },
                    tooltip: overlays.length ? {
                        callbacks: {
                        label: (ctx) => {
                            const i = ctx.dataIndex;
                            const name = labels[i] ?? `#${i + 1}`;
                            const val  = ctx.parsed?.y ?? '';
                            const extra = overlays[i] ? ` ${overlays[i]}` : '';
                            return `${name}: ${val}${extra}`;
                        },
                        },
                    } : {},
                    },
                },
                plugins: [], // no circleLabelsPlugin on scatter
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
                    borderColor: barColor,
                    borderRadius: 20,
                    borderWidth: 1,
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
                    legend: { display: false },
                    tooltip: overlays.length ? {
                    callbacks: {
                        afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
                    },
                    } : {},
                },
                },
                plugins: [circleLabelsPlugin],
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

            console.log(overlays);

            setStatus('Fetching...');
            try {
                await apiFetch({
                path: '/sheets-chart/v1/fetch-data',
                method: 'POST',
                data: { sheetId, label, stats, overlays },
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

        // opacity scaling for colors
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);
        const denom  = Math.max(1, maxVal - minVal); // avoid divide-by-zero
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

        const ctx = canvasRef.current.getContext('2d');
        const cfg = getChartConfig(attributes.chartType, {
            labels,
            values,
            overlays,
            colors,
            barColor: attributes.barColor || '#3b82f6',
        });

        chartRef.current = new Chart(ctx, cfg);

          return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };

        // OLD BELOW
        //if (!chartRef.current) {
        //    // first render: create chart
        //    const ctx = canvasRef.current.getContext('2d');
        //    chartRef.current = new Chart(ctx, {
        //    type: 'bar',
        //    data: {
        //        labels,
        //        datasets: [{
        //        label: 'Rating',
        //        data: values,
        //        backgroundColor: colors,
        //        borderColor:   attributes.barColor,
        //        borderRadius: 20,
        //        borderWidth: 1
        //        }],
        //    },
        //    options: {
        //        indexAxis: 'y',
        //        responsive: true,
        //        maintainAspectRatio: false,
        //        scales: {
        //            x: {
        //                grid: { display: false },
        //                ticks: { display: false },
        //            },
        //            y: {
        //                grid: { display: false },
        //                ticks: { color: '#000', font: { size: 14 }},
        //            },
        //        },
        //        elements: {
        //            categoryPercentage: 1.5
        //        },
        //        plugins: {
        //        tooltip: overlays.length ? {
        //            callbacks: {
        //            afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
        //            }
        //        } : {},
        //        legend: {
        //            display: false
        //        },
        //        }
        //    },
        //    plugins: [circleLabelsPlugin],
        //    });
        //} else {
        //    // updates: mutate and update
        //    const chart = chartRef.current;
        //    chart.data.labels = labels;
        //    chart.data.datasets[0].data = values;
        //    chart.data.datasets[0].backgroundColor = attributes.barColor || '#3b82f6';
        //    chart.data.datasets[0].borderColor     = attributes.barColor || '#3b82f6';
        //    chart.options.plugins.tooltip = overlays.length ? {
        //    callbacks: {
        //        afterLabel: (ctx) => overlays[ctx.dataIndex] ? ` ${overlays[ctx.dataIndex]}` : '',
        //    }
        //    } : {};
        //    chart.update();
        //}
        }, [previewData, attributes.barColor, attributes.chartType]); 

        // loads the preview up  
        useEffect(() => {
            loadPreview();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sheetId, label, stats, overlay]);

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
                onChange: (value) => setAttributes({ stats: value }),
                help: 'Enter the range of stats you want to display, e.g., O2:O13'
                }),
                createElement('label', null, 'Overlay Ranges'),
                overlaysArr.map((range, i) =>
                    createElement('div', { key:i, style:{ display:'flex', gap:'8px', marginTop:'8px' } },
                    createElement(TextControl, {
                        label: `Overlay Range ${i+1}`,
                        value: range,
                        placeholder: 'B2:B13',
                        onChange: (v) => updateOverlay(i, v)
                    }),
                    createElement(Button, { variant:'secondary', onClick: () => removeOverlay(i) }, 'Remove')
                    )
                ),
                createElement(Button, { variant:'primary', onClick: addOverlay, style:{ marginTop:'8px' } }, 'Add overlay'),
                createElement(RadioControl, {
                    label: 'Chart Type',
                    selected: chartType,
                    options: [
                        { label: 'Bar', value: 'bar' },
                        { label: 'Scatter', value: 'scatter' },
                    ],
                    onChange: (selected) => setAttributes({ chartType: selected }), 
                    help: 'Select the bar type to use.'
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
    const { sheetId, label, stats, overlay, overlays = [], barColor, chartType } = attributes;
    const overlaysToSave = overlays.length ? overlays : (overlay ? [overlay] : []);

    return createElement(
        'div',
        {
        className: 'sheets-chart-block',
        'data-sheet-id': sheetId,
        'data-label': label,
        'data-stats': stats,
        'data-overlay': overlay,
        'data-overlays': JSON.stringify(overlaysToSave),
        'data-bar-color': barColor || '#3b82f6'
        },
        createElement('div', { className: 'sheets-chart-canvas-wrap', style: { height: '420px' } },
        createElement('canvas', { className: 'sheets-chart-canvas' })
        )
    );
    }
});
