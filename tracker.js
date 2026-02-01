// Metal-Crypto Tracker - Simplified Working Version
// Features: Kraken/GoldPriceZ toggle, OHLC line charts, Custom assets

const CONFIG = {
  goldPriceZ: {
    apiKey: 'ac27005451ca13e98f52aa302d90090bac270054',
    endpoint: 'https://goldpricez.com/api/rates/currency/usd/measure/gram/metal/all'
  },
  kraken: {
    ohlc: 'https://api.kraken.com/0/public/OHLC',
    pairs: {
      gold: 'XAUTUSD',
      silver: 'XAGUSD', 
      bitcoin: 'XXBTZUSD'
    }
  }
};

let state = {
  dataSource: 'kraken',
  timeframe: '1D',
  viewMode: 'individual'
};

let charts = {};
let priceData = {
  gold: { current: 0, data: {} },
  silver: { current: 0, data: {} },
  bitcoin: { current: 0, data: {} }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  setupEventListeners();
  fetchAllPrices();
});

// Event listeners
function setupEventListeners() {
  document.getElementById('individual-btn').addEventListener('click', () => switchView('individual'));
  document.getElementById('combined-btn').addEventListener('click', () => switchView('combined'));
  
  document.getElementById('1h-btn').addEventListener('click', () => switchTimeframe('1H'));
  document.getElementById('1d-btn').addEventListener('click', () => switchTimeframe('1D'));
  document.getElementById('1w-btn').addEventListener('click', () => switchTimeframe('1W'));
  
  document.getElementById('kraken-btn').addEventListener('click', () => switchDataSource('kraken'));
  document.getElementById('goldpricez-btn').addEventListener('click', () => switchDataSource('goldpricez'));
  
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
}

function switchDataSource(source) {
  state.dataSource = source;
  document.querySelectorAll('.source-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`${source}-btn`).classList.add('active');
  fetchAllPrices();
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
    grid.classList.remove('collapsed');
    combined.style.display = 'none';
    document.getElementById('individual-btn').classList.add('active');
    document.getElementById('combined-btn').classList.remove('active');
  } else {
    grid.classList.add('collapsed');
    combined.style.display = 'block';
    document.getElementById('individual-btn').classList.remove('active');
    document.getElementById('combined-btn').classList.add('active');
    updateCombinedChart();
  }
}

// Fetch all prices
async function fetchAllPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  
  try {
    if (state.dataSource === 'kraken') {
      await fetchKrakenData();
    } else {
      await fetchGoldPriceZData();
    }
    updateAllCharts();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh';
  }
}

// Fetch from Kraken
async function fetchKrakenData() {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  for (const [asset, pair] of Object.entries(CONFIG.kraken.pairs)) {
    console.log(`Fetching ${asset}...`);
    
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
        const candles = data.result[pairKey];
        
        if (!priceData[asset].data[tf]) priceData[asset].data[tf] = [];
        
        priceData[asset].data[tf] = candles.map(c => ({
          x: c[0] * 1000,
          y: parseFloat(c[4]), // Close price
          o: parseFloat(c[1]),
          h: parseFloat(c[2]),
          l: parseFloat(c[3]),
          c: parseFloat(c[4])
        }));
        
        if (tf === state.timeframe && candles.length > 0) {
          priceData[asset].current = parseFloat(candles[candles.length - 1][4]);
          updatePriceDisplay(asset, priceData[asset].current);
        }
      } catch (error) {
        console.error(`Error fetching ${asset} ${tf}:`, error);
      }
    }
  }
}

// Fetch from GoldPriceZ
async function fetchGoldPriceZData() {
  try {
    const response = await fetch(CONFIG.goldPriceZ.endpoint, {
      headers: { 'X-API-KEY': CONFIG.goldPriceZ.apiKey }
    });
    const data = await response.json();
    const GRAM_TO_OZ = 31.1035;
    
    priceData.gold.current = parseFloat(data.gram_in_usd) * GRAM_TO_OZ;
    priceData.silver.current = parseFloat(data.silver_gram_in_usd) * GRAM_TO_OZ;
    
    updatePriceDisplay('gold', priceData.gold.current);
    updatePriceDisplay('silver', priceData.silver.current);
    
    // Generate mock data for charts
    for (const tf of ['1H', '1D', '1W']) {
      priceData.gold.data[tf] = generateMockData(priceData.gold.current, tf);
      priceData.silver.data[tf] = generateMockData(priceData.silver.current, tf);
    }
    
    // Fetch Bitcoin from Kraken
    await fetchKrakenAsset('bitcoin', CONFIG.kraken.pairs.bitcoin);
    
  } catch (error) {
    console.error('GoldPriceZ error:', error);
  }
}

async function fetchKrakenAsset(asset, pair) {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  for (const [tf, interval] of Object.entries(intervals)) {
    try {
      const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
      const response = await fetch(url);
      const data = await response.json();
      
      const pairKey = Object.keys(data.result).find(k => k !== 'last');
      const candles = data.result[pairKey];
      
      priceData[asset].data[tf] = candles.map(c => ({
        x: c[0] * 1000,
        y: parseFloat(c[4])
      }));
      
      if (tf === state.timeframe) {
        priceData[asset].current = parseFloat(candles[candles.length - 1][4]);
        updatePriceDisplay(asset, priceData[asset].current);
      }
    } catch (error) {
      console.error(`Error fetching ${asset}:`, error);
    }
  }
}

function generateMockData(basePrice, tf) {
  const count = tf === '1H' ? 24 : tf === '1D' ? 30 : 52;
  const interval = tf === '1H' ? 3600000 : tf === '1D' ? 86400000 : 604800000;
  const data = [];
  const now = Date.now();
  
  for (let i = count; i >= 0; i--) {
    const variance = basePrice * 0.02;
    data.push({
      x: now - (i * interval),
      y: basePrice + (Math.random() - 0.5) * variance
    });
  }
  
  return data;
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

// Initialize charts
function initializeCharts() {
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const point = priceData[ctx.dataset.label.toLowerCase()].data[state.timeframe][ctx.dataIndex];
            if (point && point.o) {
              return [
                `Open: $${point.o.toFixed(2)}`,
                `High: $${point.h.toFixed(2)}`,
                `Low: $${point.l.toFixed(2)}`,
                `Close: $${point.c.toFixed(2)}`
              ];
            }
            return `Price: $${ctx.parsed.y.toFixed(2)}`;
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
  };
  
  charts.gold = new Chart(document.getElementById('gold-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Gold',
        data: [],
        borderColor: '#FFD700',
        backgroundColor: 'rgba(255,215,0,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: commonOpts
  });
  
  charts.silver = new Chart(document.getElementById('silver-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Silver',
        data: [],
        borderColor: '#C0C0C0',
        backgroundColor: 'rgba(192,192,192,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: commonOpts
  });
  
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Bitcoin',
        data: [],
        borderColor: '#F7931A',
        backgroundColor: 'rgba(247,147,26,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: commonOpts
  });
  
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Gold', data: [], borderColor: '#FFD700', borderWidth: 2, tension: 0.4 },
        { label: 'Silver', data: [], borderColor: '#C0C0C0', borderWidth: 2, tension: 0.4 },
        { label: 'Bitcoin', data: [], borderColor: '#F7931A', borderWidth: 2, tension: 0.4 }
      ]
    },
    options: {
      ...commonOpts,
      plugins: {
        ...commonOpts.plugins,
        legend: { display: true, position: 'top' }
      }
    }
  });
}

function updateAllCharts() {
  const unit = state.timeframe === '1H' ? 'hour' : state.timeframe === '1D' ? 'day' : 'week';
  
  Object.values(charts).forEach(chart => {
    if (chart && chart.options.scales.x) {
      chart.options.scales.x.time.unit = unit;
    }
  });
  
  charts.gold.data.datasets[0].data = priceData.gold.data[state.timeframe] || [];
  charts.silver.data.datasets[0].data = priceData.silver.data[state.timeframe] || [];
  charts.bitcoin.data.datasets[0].data = priceData.bitcoin.data[state.timeframe] || [];
  
  charts.gold.update();
  charts.silver.update();
  charts.bitcoin.update();
}

function updateCombinedChart() {
  charts.combined.data.datasets[0].data = priceData.gold.data[state.timeframe] || [];
  charts.combined.data.datasets[1].data = priceData.silver.data[state.timeframe] || [];
  charts.combined.data.datasets[2].data = priceData.bitcoin.data[state.timeframe] || [];
  charts.combined.update();
}
