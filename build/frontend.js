document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('sheets-chart');
    if (!canvas) return;

    fetch('/wp-json/sheets-chart/v1/data')
        .then(res => res.json())
        .then(data => {
            const [headers, ...rows] = data;

            const labels = rows.map(row => row[0]); // Product Name
            const descriptions = rows.map(row => row[1]); // Description (string)
            const values = rows.map(row => parseFloat(row[2])); // Rating (number)

            new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Product Rating',
                        data: values,
                        backgroundColor: 'rgba(54, 162, 235, 0.5)'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 5
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                afterLabel: function(context) {
                                    return descriptions[context.dataIndex];
                                }
                            }
                        }
                    }
                }
            });
        });
});
