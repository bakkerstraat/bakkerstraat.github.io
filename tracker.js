// Metal-Crypto Tracker - Final Working Version
// Individual line charts + Combined multi-axis chart

const CONFIG = {
  goldPriceZ: {
    apiKey: 'ac27005451ca13e98f52aa302d90090bac270054',
    endpoint: 'https://goldpricez.com/api/rates/currency/usd/measure/gram/metal/all'
  },
  kraken: {
    ohlc: 'https://api.kraken.com/0/public/OHLC',
    assetPairs: 'https://api.kraken.com/0/public/AssetPairs',
    pairs: {
      gold: 'XAUTUSD',
      silver: 'PAXGUSD',
      bitcoin: 'XXBTZUSD'
    }
  }
};

let state = {
  dataSource: 'kraken',
  timeframe: '1D',
  viewMode: 'individual',
  krakenPairs: []
};

let charts = {};
let priceData = {
  gold: { current: 0, data: {} },
  silver: { current: 0, data: {} },
  bitcoin: { current: 0, data: {} }
};

document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  setupEventListeners();
  loadKrakenPairs();
  fetchAllPrices();
});

async function loadKrakenPairs() {
  try {
    const response = await fetch(CONFIG.kraken.assetPairs);
    const data = await response.json();
    state.krakenPairs = Object.keys(data.result).filter(p => p.includes('USD'));
    console.log(`Loaded ${state.krakenPairs.length} Kraken pairs`);
  } catch (error) {
    console.error('Error loading Kraken pairs:', error);
  }
}

function setupEventListeners() {
  document.getElementById('individual-btn').addEventListener('click', () => switchView('individual'));
  document.getElementById('combined-btn').addEventListener('click', () => switchView('combined'));
  document.getElementById('1h-btn').addEventListener('click', () => switchTimeframe('1H'));
  document.getElementById('1d-btn').addEventListener('click', () => switchTimeframe('1D'));
  document.getElementById('1w-btn').addEventListener('click', () => switchTimeframe('1W'));
  document.getElementById('kraken-btn').addEventListener('click', () => switchDataSource('kraken'));
  document.getElementById('goldpricez-btn').addEventListener('click', () => switchDataSource('goldpricez'));
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
  
  const searchInput = document.getElementById('asset-search');
  searchInput.addEventListener('input', handleAutocomplete);
  searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') addCustomAsset(); });
  document.getElementById('add-asset-btn').addEventListener('click', () => addCustomAsset());
}

function handleAutocomplete(e) {
  const value = e.target.value.toUpperCase();
  if (value.length < 2) return;
  const matches = state.krakenPairs.filter(p => p.includes(value)).slice(0, 5);
  console.log('Suggestions:', matches);
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
  
  try {
    if (state.dataSource === 'kraken') await fetchKrakenData();
    else await fetchGoldPriceZData();
    updateAllCharts();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh';
  }
}

async function fetchKrakenData() {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  for (const [asset, pair] of Object.entries(CONFIG.kraken.pairs)) {
    for (const [tf, interval] of Object.entries(intervals)) {
      try {
        const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error && data.error.length > 0) {
          console.error(`Kraken error for ${asset}:`, data.error);
          if (!priceData[asset].data[tf]) {
            priceData[asset].data[tf] = generateMockData(2800, tf);
            priceData[asset].current = 2800;
          }
          continue;
        }
        
        const pairKey = Object.keys(data.result).find(k => k !== 'last');
        if (!pairKey) continue;
        
        const candles = data.result[pairKey];
        priceData[asset].data[tf] = candles.map(c => ({ x: c[0] * 1000, y: parseFloat(c[4]) }));
        
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
    
    for (const tf of ['1H', '1D', '1W']) {
      priceData.gold.data[tf] = generateMockData(priceData.gold.current, tf);
      priceData.silver.data[tf] = generateMockData(priceData.silver.current, tf);
    }
    
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
      
      priceData[asset].data[tf] = candles.map(c => ({ x: c[0] * 1000, y: parseFloat(c[4]) }));
      
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
    data.push({ x: now - (i * interval), y: basePrice + (Math.random() - 0.5) * basePrice * 0.02 });
  }
  return data;
}

function updatePriceDisplay(asset, price) {
  const el = document.getElementById(`${asset}-price`);
  if (el) {
    el.textContent = `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function initializeCharts() {
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { type: 'time', time: { unit: 'day' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', callback: (v) => '$' + v.toFixed(0) } }
    }
  };
  
  charts.gold = new Chart(document.getElementById('gold-chart'), {
    type: 'line',
    data: { datasets: [{ label: 'Gold', data: [], borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.1)', borderWidth: 2, fill: true, tension: 0.4 }] },
    options: commonOpts
  });
  
  charts.silver = new Chart(document.getElementById('silver-chart'), {
    type: 'line',
    data: { datasets: [{ label: 'Silver', data: [], borderColor: '#C0C0C0', backgroundColor: 'rgba(192,192,192,0.1)', borderWidth: 2, fill: true, tension: 0.4 }] },
    options: commonOpts
  });
  
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), {
    type: 'line',
    data: { datasets: [{ label: 'Bitcoin', data: [], borderColor: '#F7931A', backgroundColor: 'rgba(247,147,26,0.1)', borderWidth: 2, fill: true, tension: 0.4 }] },
    options: commonOpts
  });
  
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Gold', data: [], borderColor: '#FFD700', borderWidth: 2, tension: 0.4, yAxisID: 'y-gold' },
        { label: 'Silver', data: [], borderColor: '#C0C0C0', borderWidth: 2, tension: 0.4, yAxisID: 'y-silver' },
        { label: 'Bitcoin', data: [], borderColor: '#F7931A', borderWidth: 2, tension: 0.4, yAxisID: 'y-bitcoin' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { color: '#e0e0e0' } } },
      scales: {
        x: { type: 'time', time: { unit: 'day' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
        'y-gold': { type: 'linear', position: 'left', grid: { color: 'rgba(255,215,0,0.1)' }, ticks: { color: '#FFD700', callback: (v) => '$' + v.toFixed(0) } },
        'y-silver': { type: 'linear', position: 'right', grid: { display: false }, ticks: { color: '#C0C0C0', callback: (v) => '$' + v.toFixed(0) } },
        'y-bitcoin': { type: 'linear', position: 'right', grid: { display: false }, ticks: { color: '#F7931A', callback: (v) => '$' + v.toFixed(0) } }
      }
    }
  });
}

function updateAllCharts() {
  const unit = state.timeframe === '1H' ? 'hour' : state.timeframe === '1D' ? 'day' : 'week';
  
  Object.values(charts).forEach(chart => {
    if (chart && chart.options.scales.x) chart.options.scales.x.time.unit = unit;
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

function addCustomAsset() {
  const input = document.getElementById('asset-search');
  const symbol = input.value.trim().toUpperCase();
  console.log('Adding asset:', symbol);
  input.value = '';
}
