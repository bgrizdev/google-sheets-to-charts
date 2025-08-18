import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TextControl, Button, Tooltip } from '@wordpress/components';
import { createElement, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

registerBlockType('sheets/chart-block', {
    title: 'Sheets Chart Block',
    icon: 'chart-bar',
    category: 'widgets',

    attributes: {
        sheetId: { type: 'string', default: '' },
        label: { type: 'string', default: 'A2:A13' },
        stats: { type: 'string', default: 'O2:O13' },
        overlay: { type: 'string', default: 'B2:B13' }
    },

    edit: ({ attributes, setAttributes }) => {
        const { sheetId, label, stats, overlay } = attributes;
        const blockProps = useBlockProps();
        const [status, setStatus] = useState('');

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

        return createElement(
            'div',
            blockProps,
            createElement(TextControl, {
                label: 'Google Sheet ID',
                value: sheetId,
                placeholder: '',
                onChange: (value) => {
                    console.log('Sheet ID changed to:', value);
                    setAttributes({ sheetId: value });
                },
                help: 'Paste the ID from the Google Sheet URL'
            }),
            createElement(TextControl, {
                label: 'Label Range',
                value: label,
                placeholder: 'A2:A13',
                onChange: (value) => setAttributes({ label: value }),
                help: 'Enter the range of labels you want to display, Product titles would be A2:A13'
            }),
            createElement(TextControl, {
                label: 'Stat Range',
                value: stats,
                placeholder: 'A2:A13',
                onChange: (value) => setAttributes({ label: value }),
                help: 'Enter the range of stats you want to display, Product titles would be O2:O13'
            }),
            createElement(TextControl, {
                label: 'Overlay Range',
                value: overlay,
                placeholder: 'A2:A13',
                onChange: (value) => setAttributes({ label: value }),
                help: 'Enter the range for the overlay data you want to display, Product prices would be B2:B13'
            }),
            createElement(
                Tooltip,
                { text: 'Click this to fetch and cache the Google Sheet data.' },
                createElement(Button, {
                    variant: 'primary',
                    onClick: fetchData,
                    style: { marginTop: '1rem' }
                }, 'Fetch Data')
            ),
            createElement(
                Tooltip,
                { text: 'If data in the sheet has changed, click this to refresh the data and re-cache it.' },
                createElement(Button, {
                    variant: 'primary',
                    onClick: fetchData,
                    style: { marginTop: '1rem' }
                }, 'Refresh Data')
            ),
            status && createElement('p', { style: { marginTop: '0.5rem', fontSize: '12px', color: '#555' } }, status)
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
