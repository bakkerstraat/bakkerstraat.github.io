// Metal-Crypto Tracker JavaScript
// APIs: GoldPriceZ (Gold/Silver) + CoinGecko (Bitcoin - free, no API key)

const CONFIG = {
  goldPriceZ: {
    apiKey: 'ac27005451ca13e98f52aa302d90090bac270054', // Your GoldPriceZ API key
    endpoint: 'https://goldpricez.com/api/rates/currency/usd/measure/gram/metal/all'
  },
  coinGecko: {
    endpoint: 'https://api.coingecko.com/api/v3/simple/price',
    historyEndpoint: 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart'
  }
};

let charts = {
  gold: null,
  silver: null,
  bitcoin: null,
  combined: null
};

let priceData = {
  gold: { current: 0, history: [] },
  silver: { current: 0, history: [] },
  bitcoin: { current: 0, history: [] }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  setupEventListeners();
  fetchAllPrices();
});

// Setup event listeners
function setupEventListeners() {
  document.getElementById('individual-btn').addEventListener('click', () => showIndividualView());
  document.getElementById('combined-btn').addEventListener('click', () => showCombinedView());
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
}

// View toggle
function showIndividualView() {
  document.getElementById('chart-grid').classList.remove('collapsed');
  document.getElementById('combined-view').style.display = 'none';
  document.getElementById('individual-btn').classList.add('active');
  document.getElementById('combined-btn').classList.remove('active');
}

function showCombinedView() {
  document.getElementById('chart-grid').classList.add('collapsed');
  document.getElementById('combined-view').style.display = 'block';
  document.getElementById('individual-btn').classList.remove('active');
  document.getElementById('combined-btn').classList.add('active');
  updateCombinedChart();
}

// Fetch all prices
async function fetchAllPrices() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  
  try {
    await Promise.all([
      fetchMetalPrices(),
      fetchBitcoinPrice()
    ]);
    
    updateAllCharts();
    console.log('All prices updated successfully');
  } catch (error) {
    console.error('Error fetching prices:', error);
    alert('Failed to fetch prices. Check console for details.');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh Prices';
  }
}

// Fetch Gold & Silver from CSV file (updated by scheduled script)
async function fetchMetalPrices() {
  try {
    // Fetch CSV from GitHub
    const csvUrl = 'https://raw.githubusercontent.com/bakkerstraat/bakkerstraat.github.io/main/prices.csv';
    const response = await fetch(csvUrl + '?t=' + Date.now()); // Cache-busting
    
    if (!response.ok) {
      throw new Error(`CSV fetch error: ${response.status}`);
    }
    
    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    
    // Parse CSV (skip header)
    const dataLines = lines.slice(1);
    
    if (dataLines.length === 0) {
      throw new Error('No price data in CSV');
    }
    
    // Get latest price (last line)
    const lastLine = dataLines[dataLines.length - 1];
    const [timestamp, gold, silver] = lastLine.split(',');
    
    priceData.gold.current = parseFloat(gold);
    priceData.silver.current = parseFloat(silver);
    
    // Build historical data from CSV
    const goldHistory = [];
    const silverHistory = [];
    
    dataLines.forEach(line => {
      const [ts, g, s] = line.split(',');
      const date = new Date(ts);
      goldHistory.push({ date, price: parseFloat(g) });
      silverHistory.push({ date, price: parseFloat(s) });
    });
    
    // Use last 30 days or all data if less
    priceData.gold.history = goldHistory.slice(-30);
    priceData.silver.history = silverHistory.slice(-30);
    
    // If not enough data, pad with mock data
    if (priceData.gold.history.length < 30) {
      const mockGold = generateMockHistory(priceData.gold.current, 30 - priceData.gold.history.length);
      priceData.gold.history = [...mockGold, ...priceData.gold.history];
    }
    if (priceData.silver.history.length < 30) {
      const mockSilver = generateMockHistory(priceData.silver.current, 30 - priceData.silver.history.length);
      priceData.silver.history = [...mockSilver, ...priceData.silver.history];
    }
    
    updatePriceDisplay('gold', priceData.gold.current);
    updatePriceDisplay('silver', priceData.silver.current);
    
    console.log('Metal prices loaded from CSV:', { gold: priceData.gold.current, silver: priceData.silver.current });
    
  } catch (error) {
    console.error('Metal prices fetch error:', error);
    // Fallback to demo data
    priceData.gold.current = 2850;
    priceData.silver.current = 32.50;
    priceData.gold.history = generateMockHistory(2850, 30);
    priceData.silver.history = generateMockHistory(32.50, 30);
    updatePriceDisplay('gold', priceData.gold.current);
    updatePriceDisplay('silver', priceData.silver.current);
  }
}

// Fetch Bitcoin from CoinGecko (free, no API key needed)
async function fetchBitcoinPrice() {
  try {
    // Current price
    const priceResponse = await fetch(
      `${CONFIG.coinGecko.endpoint}?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`
    );
    
    if (!priceResponse.ok) {
      throw new Error(`CoinGecko API error: ${priceResponse.status}`);
    }
    
    const priceData = await priceResponse.json();
    const currentPrice = priceData.bitcoin.usd;
    const change24h = priceData.bitcoin.usd_24h_change;
    
    // Historical data (30 days)
    const historyResponse = await fetch(
      `${CONFIG.coinGecko.historyEndpoint}?vs_currency=usd&days=30&interval=daily`
    );
    
    const historyData = await historyResponse.json();
    
    // Store data
    priceData.bitcoin.current = currentPrice;
    priceData.bitcoin.history = historyData.prices.map(([timestamp, price]) => ({
      date: new Date(timestamp),
      price: price
    }));
    
    updatePriceDisplay('bitcoin', currentPrice, change24h);
    
  } catch (error) {
    console.error('Bitcoin price fetch error:', error);
    // Show mock data if API fails
    priceData.bitcoin.current = 95000; // Approximate current BTC price
    priceData.bitcoin.history = generateMockHistory(95000, 30);
    updatePriceDisplay('bitcoin', priceData.bitcoin.current, 2.5);
  }
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

// Generate mock historical data (temporary - replace with real API later)
function generateMockHistory(currentPrice, days) {
  const history = [];
  const now = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Random walk around current price
    const variance = currentPrice * 0.15; // 15% variance
    const randomPrice = currentPrice + (Math.random() - 0.5) * variance;
    
    history.push({
      date: date,
      price: randomPrice
    });
  }
  
  return history;
}

// Initialize all charts
function initializeCharts() {
  const chartConfig = {
    type: 'line',
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1
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
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  };
  
  // Gold chart
  charts.gold = new Chart(document.getElementById('gold-chart'), {
    ...chartConfig,
    data: {
      datasets: [{
        label: 'Gold Price',
        data: [],
        borderColor: '#FFD700',
        backgroundColor: 'rgba(255, 215, 0, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    }
  });
  
  // Silver chart
  charts.silver = new Chart(document.getElementById('silver-chart'), {
    ...chartConfig,
    data: {
      datasets: [{
        label: 'Silver Price',
        data: [],
        borderColor: '#C0C0C0',
        backgroundColor: 'rgba(192, 192, 192, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    }
  });
  
  // Bitcoin chart
  charts.bitcoin = new Chart(document.getElementById('bitcoin-chart'), {
    ...chartConfig,
    data: {
      datasets: [{
        label: 'Bitcoin Price',
        data: [],
        borderColor: '#F7931A',
        backgroundColor: 'rgba(247, 147, 26, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    }
  });
  
  // Combined chart
  charts.combined = new Chart(document.getElementById('combined-chart'), {
    ...chartConfig,
    data: {
      datasets: [
        {
          label: 'Gold',
          data: [],
          borderColor: '#FFD700',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y-percentage'
        },
        {
          label: 'Silver',
          data: [],
          borderColor: '#C0C0C0',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y-percentage'
        },
        {
          label: 'Bitcoin',
          data: [],
          borderColor: '#F7931A',
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y-percentage'
        }
      ]
    },
    options: {
      ...chartConfig.options,
      scales: {
        x: chartConfig.options.scales.x,
        'y-percentage': {
          type: 'linear',
          position: 'left',
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#888',
            callback: (value) => value.toFixed(1) + '%'
          },
          title: {
            display: true,
            text: 'Percentage Change',
            color: '#888'
          }
        }
      },
      plugins: {
        ...chartConfig.options.plugins,
        legend: { display: false }
      }
    }
  });
}

// Update individual charts
function updateAllCharts() {
  updateChart(charts.gold, priceData.gold.history);
  updateChart(charts.silver, priceData.silver.history);
  updateChart(charts.bitcoin, priceData.bitcoin.history);
}

function updateChart(chart, history) {
  chart.data.datasets[0].data = history.map(item => ({
    x: item.date,
    y: item.price
  }));
  chart.update();
}

// Update combined chart with percentage changes
function updateCombinedChart() {
  const datasets = ['gold', 'silver', 'bitcoin'];
  
  datasets.forEach((asset, index) => {
    const history = priceData[asset].history;
    if (history.length === 0) return;
    
    const basePrice = history[0].price;
    const percentageData = history.map(item => ({
      x: item.date,
      y: ((item.price - basePrice) / basePrice) * 100
    }));
    
    charts.combined.data.datasets[index].data = percentageData;
  });
  
  charts.combined.update();
}

// Make priceData accessible globally for Bitcoin fetch
window.priceData = priceData;
