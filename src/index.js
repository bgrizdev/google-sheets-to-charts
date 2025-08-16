import { registerBlockType } from '@wordpress/blocks';
import { createElement } from '@wordpress/element';


registerBlockType('sheets/chart-block', {
    title: 'Sheets Chart Block',
    icon: 'chart-bar',
    category: 'widgets',
    edit: () => {
        return createElement('div', null, createElement('em', null, 'Chart will be rendered on the frontend.'));
    },
    save: () => {
        return createElement(
            'div',
            {
                style: {
                    overflowX: 'auto',
                    width: '100%',
                    maxWidth: '100%',
                }
            },
            createElement('canvas', {
                id: 'sheets-chart',
                width: 1200,
                height: 600
            })
        );
    }
});
