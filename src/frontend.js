document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.sheets-chart-block').forEach(block => {
        const sheetId = block.dataset.sheetId;
        const label = block.dataset.label;
        const stats = block.dataset.stats;
        const overlay = block.dataset.overlay;

        // Output to console
        console.log('Sheet ID:', sheetId);
        console.log('Label Range:', label);
        console.log('Stats Range:', stats);
        console.log('Overlay Range:', overlay);

        // Or render in the DOM (optional)
        block.innerHTML = `<p><strong>Sheet ID:</strong> ${sheetId}</p>
            <p><strong>Label Range:</strong> ${label}</p>
            <p><strong>Label Range:</strong> ${stats}</p>
            <p><strong>Label Range:</strong> ${overlay}</p>`;
    });
});
