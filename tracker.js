// Metal-Crypto Tracker JavaScript
// Supports hourly (24h), daily (30d), and historical (10y) views

const CONFIG = {
  coinGecko: {
    endpoint: 'https://api.coingecko.com/api/v3/simple/price',
    historyEndpoint: 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart'
  },
  csvUrls: {
    hourly: 'https://raw.githubusercontent.com/bakkerstraat/bakkerstraat.github.io/main/prices_hourly.csv',
    daily: 'https://raw.githubusercontent.com/bakkerstraat/bakkerstraat.github.io/main/prices_daily.csv'
  }
};

let charts = {
  gold: null,
  silver: null,
  bitcoin: null,
  combined: null
};

let priceData = {
  gold: { current: 0, hourly: [], daily: [] },
  silver: { current: 0, hourly: [], daily: [] },
  bitcoin: { current: 0, history: [] }
};

let currentTimeframe = 'daily'; // 'hourly', 'daily', or 'weekly'

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeCharts();
  setupEventListeners();
  fetchAllPrices();
});

// Setup event listeners
function setupEventListeners() {
  // View toggle
  document.getElementById('individual-btn').addEventListener('click', () => showIndividualView());
  document.getElementById('combined-btn').addEventListener('click', () => showCombinedView());
  
  // Timeframe toggle
  document.getElementById('hourly-btn').addEventListener('click', () => switchTimeframe('hourly'));
  document.getElementById('daily-btn').addEventListener('click', () => switchTimeframe('daily'));
  document.getElementById('weekly-btn').addEventListener('click', () => switchTimeframe('weekly'));
  
  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', () => fetchAllPrices());
}

// Switch timeframe
function switchTimeframe(timeframe) {
  currentTimeframe = timeframe;
  
  // Update button states
  document.querySelectorAll('.timeframe-toggle .toggle-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`${timeframe}-btn`).classList.add('active');
  
  // Update charts with appropriate data
  updateAllChartsWithTimeframe();
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
    
    updateAllChartsWithTimeframe();
    console.log('All prices updated successfully');
  } catch (error) {
    console.error('Error fetching prices:', error);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Refresh Prices';
  }
}

// Fetch Gold & Silver from CSV files
async function fetchMetalPrices() {
  try {
    // Fetch both hourly and daily data
    const [hourlyData, dailyData] = await Promise.all([
      fetchCSV(CONFIG.csvUrls.hourly),
      fetchCSV(CONFIG.csvUrls.daily)
    ]);
    
    // Parse hourly data
    if (hourlyData.length > 0) {
      priceData.gold.hourly = hourlyData.map(row => ({
        date: new Date(row.timestamp),
        price: parseFloat(row.gold)
      }));
      priceData.silver.hourly = hourlyData.map(row => ({
        date: new Date(row.timestamp),
        price: parseFloat(row.silver)
      }));
      
      // Set current price from latest hourly data
      const latest = hourlyData[hourlyData.length - 1];
      priceData.gold.current = parseFloat(latest.gold);
      priceData.silver.current = parseFloat(latest.silver);
    }
    
    // Parse daily data
    if (dailyData.length > 0) {
      priceData.gold.daily = dailyData.map(row => ({
        date: new Date(row.date + 'T12:00:00'), // Set to noon to avoid timezone issues
        price: parseFloat(row.gold)
      }));
      priceData.silver.daily = dailyData.map(row => ({
        date: new Date(row.date + 'T12:00:00'),
        price: parseFloat(row.silver)
      }));
      
      // Use daily data for current price if no hourly data
      if (hourlyData.length === 0) {
        const latest = dailyData[dailyData.length - 1];
        priceData.gold.current = parseFloat(latest.gold);
        priceData.silver.current = parseFloat(latest.silver);
      }
    }
    
    updatePriceDisplay('gold', priceData.gold.current);
    updatePriceDisplay('silver', priceData.silver.current);
    
    console.log('Metal prices loaded:', {
      gold: priceData.gold.current,
      silver: priceData.silver.current,
      hourlyPoints: priceData.gold.hourly.length,
      dailyPoints: priceData.gold.daily.length
    });
    
  } catch (error) {
    console.error('Metal prices fetch error:', error);
    // Fallback to demo data
    priceData.gold.current = 2850;
    priceData.silver.current = 32.50;
    priceData.gold.hourly = generateMockHistory(2850, 24, 'hourly');
    priceData.silver.hourly = generateMockHistory(32.50, 24, 'hourly');
    priceData.gold.daily = generateMockHistory(2850, 30, 'daily');
    priceData.silver.daily = generateMockHistory(32.50, 30, 'daily');
    updatePriceDisplay('gold', priceData.gold.current);
    updatePriceDisplay('silver', priceData.silver.current);
  }
}

// Fetch and parse CSV file
async function fetchCSV(url) {
  try {
    const response = await fetch(url + '?t=' + Date.now()); // Cache-busting
    if (!response.ok) throw new Error(`CSV fetch error: ${response.status}`);
    
    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((header, i) => {
        row[header] = values[i];
      });
      return row;
    });
  } catch (error) {
    console.warn(`Failed to fetch ${url}:`, error);
    return [];
  }
}

// Fetch Bitcoin from CoinGecko
async function fetchBitcoinPrice() {
  try {
    // Determine days based on timeframe
    const days = currentTimeframe === 'hourly' ? 1 : currentTimeframe === 'daily' ? 30 : 365;
    
    // Current price
    const priceResponse = await fetch(
      `${CONFIG.coinGecko.endpoint}?ids=bitcoin&vs_currencies=usd&include_24hr_change=true`
    );
    
    if (!priceResponse.ok) throw new Error(`CoinGecko API error: ${priceResponse.status}`);
    
    const priceData_temp = await priceResponse.json();
    const currentPrice = priceData_temp.bitcoin.usd;
    const change24h = priceData_temp.bitcoin.usd_24h_change;
    
    // Historical data
    const historyResponse = await fetch(
      `${CONFIG.coinGecko.historyEndpoint}?vs_currency=usd&days=${days}&interval=${currentTimeframe === 'hourly' ? 'hourly' : 'daily'}`
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
    priceData.bitcoin.current = 95000;
    priceData.bitcoin.history = generateMockHistory(95000, currentTimeframe === 'hourly' ? 24 : 30, currentTimeframe === 'hourly' ? 'hourly' : 'daily');
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

// Generate mock historical data
function generateMockHistory(currentPrice, points, type) {
  const history = [];
  const now = new Date();
  const interval = type === 'hourly' ? 3600000 : 86400000; // 1 hour or 1 day in ms
  
  for (let i = points; i >= 0; i--) {
    const date = new Date(now.getTime() - (i * interval));
    const variance = currentPrice * 0.15;
    const randomPrice = currentPrice + (Math.random() - 0.5) * variance;
    
    history.push({ date, price: randomPrice });
  }
  
  return history;
}

// Get data for current timeframe
function getDataForTimeframe(asset) {
  if (asset === 'bitcoin') {
    return priceData.bitcoin.history;
  }
  
  switch (currentTimeframe) {
    case 'hourly':
      // Last 24 hours from hourly data
      return priceData[asset].hourly.slice(-24);
    case 'daily':
      // Last 30 days from daily data
      return priceData[asset].daily.slice(-30);
    case 'weekly':
      // All daily data (10 years)
      return priceData[asset].daily;
    default:
      return priceData[asset].daily.slice(-30);
  }
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

// Update all charts with current timeframe
function updateAllChartsWithTimeframe() {
  // Update time unit based on timeframe
  const timeUnit = currentTimeframe === 'hourly' ? 'hour' : 
                   currentTimeframe === 'weekly' ? 'month' : 'day';
  
  [charts.gold, charts.silver, charts.bitcoin, charts.combined].forEach(chart => {
    if (chart) {
      chart.options.scales.x.time.unit = timeUnit;
    }
  });
  
  updateChart(charts.gold, getDataForTimeframe('gold'));
  updateChart(charts.silver, getDataForTimeframe('silver'));
  updateChart(charts.bitcoin, getDataForTimeframe('bitcoin'));
  
  charts.gold.update();
  charts.silver.update();
  charts.bitcoin.update();
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
    const history = getDataForTimeframe(asset);
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
