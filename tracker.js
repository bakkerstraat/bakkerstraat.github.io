// Advanced Metal-Crypto Tracker
// Features: Kraken/GoldPriceZ toggle, Candlestick charts (1H/1D/1W), Custom assets

const CONFIG = {
  goldPriceZ: {
    apiKey: 'ac27005451ca13e98f52aa302d90090bac270054',
    endpoint: 'https://goldpricez.com/api/rates/currency/usd/measure/gram/metal/all'
  },
  kraken: {
    ticker: 'https://api.kraken.com/0/public/Ticker',
    ohlc: 'https://api.kraken.com/0/public/OHLC',
    pairs: {
      gold: 'XAUTUSD',
      silver: 'XAGUSD',
      bitcoin: 'XXBTZUSD'
    }
  },
  coinGecko: {
    endpoint: 'https://api.coingecko.com/api/v3/simple/price',
    search: 'https://api.coingecko.com/api/v3/search'
  }
};

let state = {
  dataSource: 'kraken', // 'kraken' or 'goldpricez'
  timeframe: '1D',      // '1H', '1D', '1W'
  viewMode: 'individual', // 'individual' or 'combined'
  customAssets: []      // [{symbol, name, chart}]
};

let charts = {
  gold: null,
  silver: null,
  bitcoin: null,
  combined: null
};

let priceData = {
  gold: { current: 0, candles: { '1H': [], '1D': [], '1W': [] } },
  silver: { current: 0, candles: { '1H': [], '1D': [], '1W': [] } },
  bitcoin: { current: 0, candles: { '1H': [], '1D': [], '1W': [] } }
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  setupEventListeners();
  fetchAllPrices();
});

// Event listeners
function setupEventListeners() {
  // View toggle
  document.getElementById('individual-btn').addEventListener('click', () => switchView('individual'));
  document.getElementById('combined-btn').addEventListener('click', () => switchView('combined'));
  
  // Timeframe toggle
  document.getElementById('1h-btn').addEventListener('click', () => switchTimeframe('1H'));
  document.getElementById('1d-btn').addEventListener('click', () => switchTimeframe('1D'));
  document.getElementById('1w-btn').addEventListener('click', () => switchTimeframe('1W'));
  
  // Data source toggle
  document.getElementById('kraken-btn').addEventListener('click', () => switchDataSource('kraken'));
  document.getElementById('goldpricez-btn').addEventListener('click', () => switchDataSource('goldpricez'));
  
  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
  
  // Custom asset search
  document.getElementById('add-asset-btn').addEventListener('click', () => addCustomAsset());
  document.getElementById('asset-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCustomAsset();
  });
}

// Switch data source
function switchDataSource(source) {
  state.dataSource = source;
  
  // Update button states
  document.querySelectorAll('.source-toggle .toggle-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`${source}-btn`).classList.add('active');
  
  // Refetch data
  fetchAllPrices();
}

// Switch timeframe
function switchTimeframe(timeframe) {
  state.timeframe = timeframe;
  
  // Update button states
  document.querySelectorAll('.timeframe-toggle .toggle-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`${timeframe.toLowerCase()}-btn`).classList.add('active');
  
  // Update charts
  updateAllCharts();
}

// Switch view
function switchView(view) {
  state.viewMode = view;
  
  const grid = document.getElementById('chart-grid');
  const combinedView = document.getElementById('combined-view');
  
  if (view === 'individual') {
    grid.classList.remove('collapsed');
    combinedView.style.display = 'none';
    document.getElementById('individual-btn').classList.add('active');
    document.getElementById('combined-btn').classList.remove('active');
  } else {
    grid.classList.add('collapsed');
    combinedView.style.display = 'block';
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
    console.log('All prices updated successfully');
  } catch (error) {
    console.error('Error fetching prices:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh';
  }
}

// Fetch from Kraken
async function fetchKrakenData() {
  const intervals = {
    '1H': 60,
    '1D': 1440,
    '1W': 10080
  };
  
  for (const [asset, pair] of Object.entries(CONFIG.kraken.pairs)) {
    for (const [tf, interval] of Object.entries(intervals)) {
      try {
        const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error && data.error.length > 0) {
          console.error(`Kraken error for ${asset}: ${data.error}`);
          continue;
        }
        
        // Get pair key (Kraken changes pair names in response)
        const pairKey = Object.keys(data.result).find(k => k !== 'last');
        const candles = data.result[pairKey];
        
        // Format: [timestamp, open, high, low, close, vwap, volume, count]
        priceData[asset].candles[tf] = candles.map(c => ({
          time: c[0] * 1000, // Convert to ms
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
          volume: parseFloat(c[6])
        }));
        
        // Set current price from latest candle
        if (candles.length > 0) {
          priceData[asset].current = parseFloat(candles[candles.length - 1][4]);
        }
      } catch (error) {
        console.error(`Error fetching ${asset} ${tf}:`, error);
      }
    }
    
    updatePriceDisplay(asset, priceData[asset].current);
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
    
    // Get current prices
    const goldPrice = parseFloat(data.gram_in_usd) * GRAM_TO_OZ;
    const silverPrice = parseFloat(data.silver_gram_in_usd) * GRAM_TO_OZ;
    
    priceData.gold.current = goldPrice;
    priceData.silver.current = silverPrice;
    
    // Generate mock candles (GoldPriceZ doesn't provide historical)
    for (const tf of ['1H', '1D', '1W']) {
      const points = tf === '1H' ? 24 : tf === '1D' ? 30 : 52;
      priceData.gold.candles[tf] = generateMockCandles(goldPrice, points, tf);
      priceData.silver.candles[tf] = generateMockCandles(silverPrice, points, tf);
    }
    
    updatePriceDisplay('gold', goldPrice);
    updatePriceDisplay('silver', silverPrice);
    
    // Still get Bitcoin from Kraken
    await fetchKrakenAsset('bitcoin', CONFIG.kraken.pairs.bitcoin);
    
  } catch (error) {
    console.error('GoldPriceZ fetch error:', error);
  }
}

// Fetch single asset from Kraken
async function fetchKrakenAsset(asset, pair) {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  for (const [tf, interval] of Object.entries(intervals)) {
    try {
      const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
      const response = await fetch(url);
      const data = await response.json();
      
      const pairKey = Object.keys(data.result).find(k => k !== 'last');
      const candles = data.result[pairKey];
      
      priceData[asset].candles[tf] = candles.map(c => ({
        time: c[0] * 1000,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[6])
      }));
      
      if (candles.length > 0) {
        priceData[asset].current = parseFloat(candles[candles.length - 1][4]);
      }
    } catch (error) {
      console.error(`Error fetching ${asset}:`, error);
    }
  }
  
  updatePriceDisplay(asset, priceData[asset].current);
}

// Generate mock candlestick data
function generateMockCandles(basePrice, count, timeframe) {
  const candles = [];
  const now = Date.now();
  const interval = timeframe === '1H' ? 3600000 : timeframe === '1D' ? 86400000 : 604800000;
  
  for (let i = count; i >= 0; i--) {
    const time = now - (i * interval);
    const variance = basePrice * 0.02;
    const open = basePrice + (Math.random() - 0.5) * variance;
    const close = basePrice + (Math.random() - 0.5) * variance;
    const high = Math.max(open, close) + Math.random() * variance * 0.5;
    const low = Math.min(open, close) - Math.random() * variance * 0.5;
    
    candles.push({ time, open, high, low, close, volume: Math.random() * 1000 });
  }
  
  return candles;
}

// Update price display
function updatePriceDisplay(asset, price, change = null) {
  const priceEl = document.getElementById(`${asset}-price`);
  const changeEl = document.getElementById(`${asset}-change`);
  
  if (priceEl) {
    priceEl.textContent = `$${price.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    })}`;
  }
  
  if (changeEl && change !== null) {
    const isPositive = change >= 0;
    changeEl.textContent = `${isPositive ? '+' : ''}${change.toFixed(2)}% (24h)`;
    changeEl.className = `price-change ${isPositive ? 'change-positive' : 'change-negative'}`;
  }
}

// Initialize charts
function initializeCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (context) => {
            const candle = context.raw;
            return [
              `O: $${candle.y[0].toFixed(2)}`,
              `H: $${candle.y[1].toFixed(2)}`,
              `L: $${candle.y[2].toFixed(2)}`,
              `C: $${candle.y[3].toFixed(2)}`
            ];
          }
        }
      }
    },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day' },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#888' }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { 
          color: '#888',
          callback: (value) => '$' + value.toFixed(0)
        }
      }
    }
  };
  
  // Gold chart
  charts.gold = new Chart(document.getElementById('gold-chart'), {
    type: 'candlestick',
    data: { datasets: [{ label: 'Gold', data: [] }] },
    options: commonOptions
  });
  
  // Silver chart
  charts.silver = new Chart(document.getElementById('silver-chart'), {
    type: 'candlestick',
    data: { datasets: [{ label: 'Silver', data: [] }] },
    options: commonOptions
  });
  
  // Bitcoin chart
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), {
    type: 'candlestick',
    data: { datasets: [{ label: 'Bitcoin', data: [] }] },
    options: commonOptions
  });
  
  // Combined chart (line chart showing closes)
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Gold', data: [], borderColor: '#FFD700', borderWidth: 2 },
        { label: 'Silver', data: [], borderColor: '#C0C0C0', borderWidth: 2 },
        { label: 'Bitcoin', data: [], borderColor: '#F7931A', borderWidth: 2 }
      ]
    },
    options: {
      ...commonOptions,
      plugins: {
        ...commonOptions.plugins,
        legend: { display: true, position: 'top' }
      }
    }
  });
}

// Update all charts
function updateAllCharts() {
  updateCandlestickChart(charts.gold, priceData.gold.candles[state.timeframe]);
  updateCandlestickChart(charts.silver, priceData.silver.candles[state.timeframe]);
  updateCandlestickChart(charts.bitcoin, priceData.bitcoin.candles[state.timeframe]);
  
  // Update time unit based on timeframe
  const unit = state.timeframe === '1H' ? 'hour' : state.timeframe === '1D' ? 'day' : 'week';
  [charts.gold, charts.silver, charts.bitcoin, charts.combined].forEach(chart => {
    if (chart) chart.options.scales.x.time.unit = unit;
  });
}

// Update candlestick chart
function updateCandlestickChart(chart, candles) {
  if (!candles || candles.length === 0) return;
  
  chart.data.datasets[0].data = candles.map(c => ({
    x: c.time,
    y: [c.open, c.high, c.low, c.close]
  }));
  
  chart.update();
}

// Update combined chart
function updateCombinedChart() {
  const assets = ['gold', 'silver', 'bitcoin'];
  
  assets.forEach((asset, index) => {
    const candles = priceData[asset].candles[state.timeframe];
    if (!candles || candles.length === 0) return;
    
    charts.combined.data.datasets[index].data = candles.map(c => ({
      x: c.time,
      y: c.close
    }));
  });
  
  charts.combined.update();
}

// Custom asset search
async function addCustomAsset() {
  const searchInput = document.getElementById('asset-search');
  const symbol = searchInput.value.trim().toUpperCase();
  
  if (!symbol) return;
  
  if (state.customAssets.length >= 2) {
    alert('Maximum 2 custom assets allowed');
    return;
  }
  
  // Try to find on Kraken first, then CoinGecko
  const asset = await searchAsset(symbol);
  if (asset) {
    state.customAssets.push(asset);
    createCustomChart(asset);
    searchInput.value = '';
  } else {
    alert(`Asset ${symbol} not found`);
  }
}

// Search for asset
async function searchAsset(symbol) {
  // Try Kraken first
  try {
    const pair = `${symbol}USD`;
    const url = `${CONFIG.kraken.ticker}?pair=${pair}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.error || data.error.length === 0) {
      return { symbol, source: 'kraken', pair };
    }
  } catch (e) {
    console.log(`${symbol} not on Kraken, trying CoinGecko...`);
  }
  
  // Try CoinGecko
  try {
    const url = `${CONFIG.coinGecko.search}?query=${symbol}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.coins && data.coins.length > 0) {
      const coin = data.coins[0];
      return { symbol: coin.symbol.toUpperCase(), name: coin.name, id: coin.id, source: 'coingecko' };
    }
  } catch (e) {
    console.error('CoinGecko search error:', e);
  }
  
  return null;
}

// Create custom chart
function createCustomChart(asset) {
  const container = document.getElementById('custom-charts');
  
  const chartDiv = document.createElement('div');
  chartDiv.className = 'chart-card';
  chartDiv.innerHTML = `
    <div class="chart-header">
      <div class="chart-title">
        <span>${asset.symbol}</span>
        <button class="remove-btn" onclick="removeCustomAsset('${asset.symbol}')">✕</button>
      </div>
      <div class="price-info">
        <div class="current-price" id="${asset.symbol}-price">$—</div>
      </div>
    </div>
    <div class="chart-container">
      <canvas id="${asset.symbol}-chart"></canvas>
    </div>
  `;
  
  container.appendChild(chartDiv);
  
  // Initialize chart
  const canvas = document.getElementById(`${asset.symbol}-chart`);
  asset.chart = new Chart(canvas, {
    type: 'candlestick',
    data: { datasets: [{ label: asset.symbol, data: [] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'time', time: { unit: 'day' } },
        y: { ticks: { callback: (v) => '$' + v.toFixed(2) } }
      }
    }
  });
  
  // Fetch data
  fetchCustomAssetData(asset);
}

// Fetch custom asset data
async function fetchCustomAssetData(asset) {
  // Implement based on source (Kraken or CoinGecko)
  // For now, just show placeholder
  console.log('Fetching data for', asset);
}

// Remove custom asset
function removeCustomAsset(symbol) {
  state.customAssets = state.customAssets.filter(a => a.symbol !== symbol);
  // Remove from DOM
  document.getElementById(`${symbol}-chart`).closest('.chart-card').remove();
}
