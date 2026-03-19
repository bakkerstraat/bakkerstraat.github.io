// Minimal Tracker - ONLY Gold + Bitcoin from Kraken

const CONFIG = {
  kraken: {
    ohlc: 'https://api.kraken.com/0/public/OHLC',
    pairs: {
      gold: 'XAUTUSD',
      bitcoin: 'XXBTZUSD'
    }
  }
};

let state = {
  timeframe: '1D',
  viewMode: 'individual'
};

let charts = {};
let priceData = {
  gold: { current: 0, data: {} },
  bitcoin: { current: 0, data: {} }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  console.log('Initializing tracker...');
  initializeCharts();
  setupEventListeners();
  fetchAllPrices();
});

function setupEventListeners() {
  document.getElementById('individual-btn').addEventListener('click', () => switchView('individual'));
  document.getElementById('combined-btn').addEventListener('click', () => switchView('combined'));
  document.getElementById('1h-btn').addEventListener('click', () => switchTimeframe('1H'));
  document.getElementById('1d-btn').addEventListener('click', () => switchTimeframe('1D'));
  document.getElementById('1w-btn').addEventListener('click', () => switchTimeframe('1W'));
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
}

function switchTimeframe(tf) {
  state.timeframe = tf;
  document.querySelectorAll('.timeframe-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`${tf.toLowerCase()}-btn`).classList.add('active');
  updateAllCharts();
}

function switchView(view) {
  state.viewMode = view;
  const grid = document.getElementById('chart-grid');
  const combined = document.getElementById('combined-view');
  
  if (view === 'individual') {
    grid.style.display = 'grid';
    combined.style.display = 'none';
    document.getElementById('individual-btn').classList.add('active');
    document.getElementById('combined-btn').classList.remove('active');
  } else {
    grid.style.display = 'none';
    combined.style.display = 'block';
    document.getElementById('individual-btn').classList.remove('active');
    document.getElementById('combined-btn').classList.add('active');
    updateCombinedChart();
  }
}

async function fetchAllPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  
  console.log('Fetching prices...');
  
  try {
    await fetchKrakenData();
    updateAllCharts();
    console.log('Prices loaded successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

async function fetchKrakenData() {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  for (const [asset, pair] of Object.entries(CONFIG.kraken.pairs)) {
    console.log(`Fetching ${asset} (${pair})...`);
    
    for (const [tf, interval] of Object.entries(intervals)) {
      try {
        const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error && data.error.length > 0) {
          console.error(`Kraken error for ${asset}:`, data.error);
          continue;
        }
        
        const pairKey = Object.keys(data.result).find(k => k !== 'last');
        if (!pairKey) {
          console.warn(`No data for ${asset}`);
          continue;
        }
        
        const candles = data.result[pairKey];
        
        if (!priceData[asset].data[tf]) {
          priceData[asset].data[tf] = [];
        }
        
        priceData[asset].data[tf] = candles.map(c => ({
          x: c[0] * 1000,
          o: parseFloat(c[1]),
          h: parseFloat(c[2]),
          l: parseFloat(c[3]),
          c: parseFloat(c[4]),
          y: parseFloat(c[4])
        }));
        
        if (tf === state.timeframe && candles.length > 0) {
          priceData[asset].current = parseFloat(candles[candles.length - 1][4]);
          updatePriceDisplay(asset, priceData[asset].current);
        }
        
        console.log(`✓ ${asset} ${tf}: ${candles.length} candles`);
      } catch (error) {
        console.error(`Error fetching ${asset} ${tf}:`, error);
      }
    }
  }
}

function updatePriceDisplay(asset, price) {
  const el = document.getElementById(`${asset}-price`);
  if (el) {
    el.textContent = `$${price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    })}`;
  }
}

function initializeCharts() {
  console.log('Initializing charts...');
  
  // Candlestick plugin
  const candlestickPlugin = {
    id: 'candlestick',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const dataset = chart.data.datasets[0];
      const meta = chart.getDatasetMeta(0);
      
      meta.data.forEach((bar, index) => {
        const candle = dataset.data[index];
        if (!candle || !candle.o) return;
        
        const x = bar.x;
        const yOpen = chart.scales.y.getPixelForValue(candle.o);
        const yClose = chart.scales.y.getPixelForValue(candle.c);
        const yHigh = chart.scales.y.getPixelForValue(candle.h);
        const yLow = chart.scales.y.getPixelForValue(candle.l);
        
        const isUp = candle.c >= candle.o;
        const color = isUp ? '#00ff00' : '#ff0000';
        
        // Wick
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();
        
        // Body
        const bodyHeight = Math.abs(yClose - yOpen);
        const bodyY = Math.min(yOpen, yClose);
        const bodyWidth = bar.width * 0.8;
        
        ctx.fillStyle = isUp ? 'rgba(0,255,0,0.8)' : 'rgba(255,50,50,0.8)';
        ctx.fillRect(x - bodyWidth / 2, bodyY, bodyWidth, bodyHeight || 1);
        ctx.strokeStyle = color;
        ctx.strokeRect(x - bodyWidth / 2, bodyY, bodyWidth, bodyHeight || 1);
      });
    }
  };
  
  const chartConfig = (label) => ({
    type: 'bar',
    plugins: [candlestickPlugin],
    data: {
      datasets: [{
        label: label,
        data: [],
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        barPercentage: 0.8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: { xAxisKey: 'x', yAxisKey: 'c' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = ctx.raw;
              if (!d || !d.o) return '';
              return [
                `Open: $${d.o.toFixed(2)}`,
                `High: $${d.h.toFixed(2)}`,
                `Low: $${d.l.toFixed(2)}`,
                `Close: $${d.c.toFixed(2)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#888' }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { 
            color: '#888',
            callback: (v) => '$' + v.toFixed(0)
          }
        }
      }
    }
  });
  
  charts.gold = new Chart(document.getElementById('gold-chart'), chartConfig('Gold'));
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), chartConfig('Bitcoin'));
  
  // Combined chart
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Gold', data: [], borderColor: '#FFD700', borderWidth: 2, tension: 0.4, yAxisID: 'y-gold', pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Bitcoin', data: [], borderColor: '#F7931A', borderWidth: 2, tension: 0.4, yAxisID: 'y-bitcoin', pointRadius: 0, pointHoverRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { color: '#e0e0e0' } } },
      scales: {
        x: { type: 'time', time: { unit: 'day' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
        'y-gold': { type: 'linear', position: 'left', grid: { color: 'rgba(255,215,0,0.1)' }, ticks: { color: '#FFD700', callback: (v) => '$' + v.toFixed(0) } },
        'y-bitcoin': { type: 'linear', position: 'right', grid: { display: false }, ticks: { color: '#F7931A', callback: (v) => '$' + v.toFixed(0) } }
      }
    }
  });
  
  console.log('Charts initialized');
}

function updateAllCharts() {
  const unit = state.timeframe === '1H' ? 'hour' : state.timeframe === '1D' ? 'day' : 'week';
  
  ['gold', 'bitcoin'].forEach(asset => {
    const chart = charts[asset];
    if (chart) {
      chart.options.scales.x.time.unit = unit;
      chart.data.datasets[0].data = priceData[asset].data[state.timeframe] || [];
      chart.update('none');
    }
  });
  
  if (charts.combined) {
    charts.combined.options.scales.x.time.unit = unit;
  }
}

function updateCombinedChart() {
  charts.combined.data.datasets[0].data = priceData.gold.data[state.timeframe] || [];
  charts.combined.data.datasets[1].data = priceData.bitcoin.data[state.timeframe] || [];
  charts.combined.update();
}
