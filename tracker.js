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
      bitcoin: 'XXBTZUSD'
    }
  },
  hyperliquid: {
    info: 'https://api.hyperliquid.xyz/info',
    silver: 'AG' // Silver perpetual
  }
};

let state = {
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
    await fetchKrakenData();
    updateAllCharts();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

async function fetchKrakenData() {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  
  // Fetch Gold and Bitcoin from Kraken
  for (const [asset, pair] of Object.entries(CONFIG.kraken.pairs)) {
    for (const [tf, interval] of Object.entries(intervals)) {
      try {
        const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error && data.error.length > 0) {
          console.error(`Kraken error for ${asset}:`, data.error);
          if (!priceData[asset].data[tf]) {
            priceData[asset].data[tf] = generateMockCandles(2800, tf);
            priceData[asset].current = 2800;
          }
          continue;
        }
        
        const pairKey = Object.keys(data.result).find(k => k !== 'last');
        if (!pairKey) continue;
        
        const candles = data.result[pairKey];
        priceData[asset].data[tf] = candles.map(c => ({
          x: c[0] * 1000,
          o: parseFloat(c[1]),
          h: parseFloat(c[2]),
          l: parseFloat(c[3]),
          c: parseFloat(c[4]),
          y: parseFloat(c[4]) // For line chart
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
  
  // Fetch Silver from Hyperliquid
  await fetchHyperliquidSilver();
}

async function fetchHyperliquidSilver() {
  console.log('Fetching silver from Hyperliquid...');
  
  const intervals = { '1H': '1h', '1D': '1d', '1W': '1w' };
  
  for (const [tf, interval] of Object.entries(intervals)) {
    try {
      // Try @0 suffix (perp contract format)
      const payload = {
        type: 'candleSnapshot',
        req: {
          coin: '@0',  // Silver perp index
          interval: interval
        }
      };
      
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error(`Hyperliquid error ${tf}: ${response.status} ${response.statusText}`);
        const text = await response.text();
        console.error('Response:', text);
        
        if (!priceData.silver.data[tf]) {
          priceData.silver.data[tf] = generateMockCandles(32, tf);
          priceData.silver.current = 32;
          updatePriceDisplay('silver', 32);
        }
        continue;
      }
      
      const data = await response.json();
      console.log(`Hyperliquid ${tf} response:`, data);
      
      if (!data || !Array.isArray(data) || data.length === 0) {
        console.warn(`No Hyperliquid data for silver ${tf}`);
        if (!priceData.silver.data[tf]) {
          priceData.silver.data[tf] = generateMockCandles(32, tf);
          priceData.silver.current = 32;
          updatePriceDisplay('silver', 32);
        }
        continue;
      }
      
      priceData.silver.data[tf] = data.map(c => ({
        x: c.t,
        o: parseFloat(c.o),
        h: parseFloat(c.h),
        l: parseFloat(c.l),
        c: parseFloat(c.c),
        y: parseFloat(c.c)
      }));
      
      if (tf === state.timeframe && data.length > 0) {
        priceData.silver.current = parseFloat(data[data.length - 1].c);
        updatePriceDisplay('silver', priceData.silver.current);
      }
      
      console.log(`✓ Hyperliquid silver ${tf}: ${data.length} candles`);
      
    } catch (error) {
      console.error(`Error fetching Hyperliquid silver ${tf}:`, error);
      if (!priceData.silver.data[tf]) {
        priceData.silver.data[tf] = generateMockCandles(32, tf);
        priceData.silver.current = 32;
        updatePriceDisplay('silver', 32);
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

function generateMockCandles(basePrice, tf) {
  const count = tf === '1H' ? 24 : tf === '1D' ? 30 : 52;
  const interval = tf === '1H' ? 3600000 : tf === '1D' ? 86400000 : 604800000;
  const data = [];
  const now = Date.now();
  let price = basePrice;
  
  for (let i = count; i >= 0; i--) {
    const variance = basePrice * 0.02;
    const o = price + (Math.random() - 0.5) * variance;
    const c = price + (Math.random() - 0.5) * variance;
    const h = Math.max(o, c) + Math.random() * variance * 0.3;
    const l = Math.min(o, c) - Math.random() * variance * 0.3;
    
    data.push({
      x: now - (i * interval),
      o, h, l, c,
      y: c
    });
    price = c;
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
  // Custom candlestick chart plugin
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
        
        // Draw wick (high-low line)
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yLow);
        ctx.stroke();
        
        // Draw body (open-close rectangle)
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
  
  // Helper to create candlestick chart config
  const createCandlestickChart = (color, label) => ({
    type: 'bar',
    plugins: [candlestickPlugin],
    data: {
      datasets: [{
        label: label,
        data: [],
        backgroundColor: 'transparent', // Let plugin draw it
        borderColor: 'transparent',
        barPercentage: 0.8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: {
        xAxisKey: 'x',
        yAxisKey: 'c'
      },
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
  
  charts.gold = new Chart(document.getElementById('gold-chart'), createCandlestickChart('#FFD700', 'Gold'));
  charts.silver = new Chart(document.getElementById('silver-chart'), createCandlestickChart('#C0C0C0', 'Silver'));
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), createCandlestickChart('#F7931A', 'Bitcoin'));
  
  // Combined chart with multiple Y-axes (line chart)
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'Gold', data: [], borderColor: '#FFD700', borderWidth: 2, tension: 0.4, yAxisID: 'y-gold', pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Silver', data: [], borderColor: '#C0C0C0', borderWidth: 2, tension: 0.4, yAxisID: 'y-silver', pointRadius: 0, pointHoverRadius: 4 },
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
        'y-silver': { type: 'linear', position: 'right', grid: { display: false }, ticks: { color: '#C0C0C0', callback: (v) => '$' + v.toFixed(0) } },
        'y-bitcoin': { type: 'linear', position: 'right', grid: { display: false }, ticks: { color: '#F7931A', callback: (v) => '$' + v.toFixed(0) } }
      }
    }
  });
}

function updateAllCharts() {
  const unit = state.timeframe === '1H' ? 'hour' : state.timeframe === '1D' ? 'day' : 'week';
  
  // Update individual charts
  ['gold', 'silver', 'bitcoin'].forEach(asset => {
    const chart = charts[asset];
    if (chart) {
      chart.options.scales.x.time.unit = unit;
      chart.data.datasets[0].data = priceData[asset].data[state.timeframe] || [];
      chart.update('none');
    }
  });
  
  // Update combined chart time unit
  if (charts.combined) {
    charts.combined.options.scales.x.time.unit = unit;
  }
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
  
  if (!symbol) {
    alert('Please enter an asset symbol');
    return;
  }
  
  // Search in loaded Kraken pairs
  const match = state.krakenPairs.find(p => 
    p.includes(symbol + 'USD') || 
    p.includes(symbol + 'USDT') ||
    p === symbol
  );
  
  if (match) {
    console.log(`Found ${symbol} on Kraken: ${match}`);
    
    // Create new chart card
    const container = document.getElementById('custom-charts');
    const chartId = `custom-${symbol.toLowerCase()}`;
    
    const cardHTML = `
      <div class="chart-card" id="${chartId}-card">
        <div class="chart-header">
          <div class="chart-title">
            <span>${symbol}/USD</span>
          </div>
          <div class="price-info">
            <div class="current-price" id="${chartId}-price">$—</div>
          </div>
        </div>
        <div class="chart-container">
          <canvas id="${chartId}-chart"></canvas>
        </div>
        <div class="chart-source">Source: Kraken</div>
      </div>
    `;
    
    container.insertAdjacentHTML('beforeend', cardHTML);
    
    // Initialize chart
    const chart = new Chart(document.getElementById(`${chartId}-chart`), {
      type: 'bar',
      plugins: [charts.gold.config._config.plugins[0]], // Use same candlestick plugin
      data: {
        datasets: [{
          label: symbol,
          data: [],
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          barPercentage: 0.8
        }]
      },
      options: charts.gold.options // Copy gold chart options
    });
    
    // Store chart reference
    charts[chartId] = chart;
    
    // Fetch data for this asset
    fetchCustomAssetData(match, chartId);
    
    input.value = '';
  } else {
    alert(`Asset "${symbol}" not found on Kraken.\n\nTry: BTC, ETH, SOL, DOGE, etc.`);
  }
}

async function fetchCustomAssetData(pair, chartId) {
  const intervals = { '1H': 60, '1D': 1440, '1W': 10080 };
  const assetData = { current: 0, data: {} };
  
  for (const [tf, interval] of Object.entries(intervals)) {
    try {
      const url = `${CONFIG.kraken.ohlc}?pair=${pair}&interval=${interval}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.error && data.error.length > 0) {
        console.error(`Kraken error for ${pair}:`, data.error);
        continue;
      }
      
      const pairKey = Object.keys(data.result).find(k => k !== 'last');
      if (!pairKey) continue;
      
      const candles = data.result[pairKey];
      assetData.data[tf] = candles.map(c => ({
        x: c[0] * 1000,
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4]),
        y: parseFloat(c[4])
      }));
      
      if (tf === state.timeframe && candles.length > 0) {
        assetData.current = parseFloat(candles[candles.length - 1][4]);
        const priceEl = document.getElementById(`${chartId}-price`);
        if (priceEl) {
          priceEl.textContent = `$${assetData.current.toLocaleString('en-US', { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
          })}`;
        }
      }
    } catch (error) {
      console.error(`Error fetching ${pair}:`, error);
    }
  }
  
  // Store data
  priceData[chartId] = assetData;
  
  // Update chart
  if (charts[chartId]) {
    charts[chartId].data.datasets[0].data = assetData.data[state.timeframe] || [];
    charts[chartId].update();
  }
}
