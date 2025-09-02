document.addEventListener("DOMContentLoaded", function () {
  const token = localStorage.getItem("token");
  const portfolioId = localStorage.getItem("portfolioId");
  const portfolioName = localStorage.getItem("portfolioName");
  const portfolioExchange = localStorage.getItem("portfolioExchange");

  if (token) {
    try {
      const payload = jwt_decode(token);
      if (payload.username) {
        document.getElementById("username").textContent = payload.username;
      }
    } catch (e) {
      console.error("Invalid token", e);
      window.location.href = `/auth_page.html`;
    }
  } else {
    window.location.href = `/auth_page.html`; 
}

  if (!portfolioId) {
    showModal("Error fetching portfolio.", "error");
    window.location.href = `/index.html`;
    return;
  }

  if (portfolioName) {
    document.getElementById("portfolioName").textContent = portfolioName;
  }
  if (portfolioExchange) {
    document.getElementById("portfolioExchange").textContent =
      portfolioExchange;
  }

    async function buildWeeklyTicker() {
      const track = document.getElementById("weeklyTickerTrack");

      const res = await fetch(
        `${SERVER_ENDPOINT}/portfolio/portfolio/getWeeklyChange/${portfolioId}`,
        {
          headers: { Authorization: "Bearer " + token },
        }
      );
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        track.innerHTML = '<div class="ticker-item">No assets yet</div>';
        return;
      }

      let lastWeekChangeTotal = 0;   
      let totalStocks = 0;

      const items = data.map(({ ticker, changePct }) => {
        const pct = Number(changePct);
        lastWeekChangeTotal += pct;   
        totalStocks += 1;

        const pctStr = pct.toFixed(2);
        const up = pct >= 0;
        const cls = up ? "badge-up" : "badge-down";
        const sign = up ? "+" : "";
        return `<div class="ticker-item">
            <span class="symbol">${ticker}</span>
            <span class="${cls}">${sign}${pctStr}%</span>
          </div>`;
      });


      // Display items in rows, swapping to a new row every 10 seconds
      const itemsPerRow = 6;
      let currentRow = 0;
      let isAnimating = false;
      function showCurrentRow() {
        if (isAnimating) return;
        isAnimating = true;
        // Slide out current row
        track.classList.remove('slide-in');
        track.classList.add('slide-out');
        setTimeout(() => {
          // After slide out, show new row and slide in
          const start = currentRow * itemsPerRow;
          const end = start + itemsPerRow;
          const rowItems = items.slice(start, end);
          track.innerHTML = rowItems.join("");
          track.classList.remove('slide-out');
          track.classList.add('slide-in');
          currentRow = (currentRow + 1) % Math.ceil(items.length / itemsPerRow);
          setTimeout(() => {
            track.classList.remove('slide-in');
            isAnimating = false;
          }, 500); // slide-in duration
        }, 500); // slide-out duration
      }

      // Initial row
      const start = currentRow * itemsPerRow;
      const end = start + itemsPerRow;
      track.innerHTML = items.slice(start, end).join("");
      currentRow = (currentRow + 1) % Math.ceil(items.length / itemsPerRow);

      setInterval(showCurrentRow, 10000);

      let avgChange = totalStocks > 0 ? (lastWeekChangeTotal / totalStocks).toFixed(2) : "0.00";
      const sign = avgChange >= 0 ? "+" : "";
      const cls = avgChange >= 0 ? "order-buy" : "order-sell";

    }
  

  buildWeeklyTicker();

  // Fetch the cumulative portfolio data for the line chart
  // Fetch the cumulative portfolio data for the line chart
// Fetch the cumulative portfolio data for the line chart
fetch(`${SERVER_ENDPOINT}/portfolio/portfolio/getCumulativePricesforPortfolio/${portfolioId}`, {
  headers: { Authorization: "Bearer " + token },
})
  .then((response) => response.json())
  .then((data) => {
    if (!Array.isArray(data?.dates) || !Array.isArray(data?.values) || !data.values.length) {
      console.error("Invalid data structure for cumulative portfolio value", data);
      return;
    }

    // Keep the chart
    renderCumulativeGrowthChart(data.dates, data.values);

    // Only set Current Net Worth
    const latest = Number(data.values[data.values.length - 1]);
    const pvEl = document.getElementById("portfolioValue");
    if (pvEl) {
      pvEl.textContent = `$${latest.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
  })
  .catch((error) => {
    console.error("Error fetching cumulative portfolio data:", error);
    showModal && showModal("Failed to load portfolio data.", "error");
  });




// Map: portfolio_asset_id -> ticker
let assetIdToTicker = {};

const table2 = document
  .getElementById("transactionTable")
  .getElementsByTagName("tbody")[0];

// Load assets → build map → then load transactions
fetch(`${SERVER_ENDPOINT}/portfolio/asset/${portfolioId}`, {
  headers: { Authorization: "Bearer " + token },
})
  .then((response) => response.json())
  .then((assets) => {
    if (Array.isArray(assets)) {
      renderAssetCompositionChart(assets);
      // Build the lookup { [asset.id]: asset.ticker }
      assetIdToTicker = assets.reduce((acc, a) => {
        acc[a.id] = (a.ticker || "").toUpperCase();
        return acc;
      }, {});
    } else {
      console.error("Invalid asset composition data");
    }
  })
  .catch((error) => {
    console.error("Error fetching asset composition data:", error);
    showModal("Failed to load asset composition data.", "error");
  })
  .finally(loadTransactions); // ensure we render transactions even if assets failed

function loadTransactions() {
  fetch(`${SERVER_ENDPOINT}/transaction/transactionByPortfolio/${portfolioId}`, {
    headers: { Authorization: "Bearer " + token },
  })
    .then((response) => response.json())
    .then((data) => {
      // reverse newest-first as you had
      data = Array.isArray(data) ? data.slice().reverse() : [];

      data.forEach((p) => {
        let date = new Date(p.datetime);
        const options = {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        };
        date = date.toLocaleDateString("en-US", options);

        const newRow = table2.insertRow();

        // NEW: ticker cell first
        const tickerCell = newRow.insertCell(0);
        const transactionType = newRow.insertCell(1);
        const purchasePrice = newRow.insertCell(2)
        const quantity = newRow.insertCell(3);
        const dateTime = newRow.insertCell(4);

        // Lookup ticker via the portfolio_asset_id
        const ticker =
          assetIdToTicker[p.portfolio_asset_id] /* preferred */ ||
          p.ticker /* in case you add it server-side later */ ||
          "—";
        tickerCell.textContent = ticker;

        const type = (p.transaction_type || "").toUpperCase();
        transactionType.textContent = type;

        if (type === "BUY") transactionType.classList.add("order-buy");
        else if (type === "SELL") transactionType.classList.add("order-sell");

        purchasePrice.textContent = "$" + p.purchase_price;
        quantity.textContent = p.quantity;
        dateTime.textContent = date;
      });
    })
    .catch((error) => {
      console.error("Error fetching transactions:", error);
      showModal("Failed to load transactions.", "error");
    });
}


});

const token = localStorage.getItem("token");
if (token) {
  try {
    const payload = jwt_decode(token);
    if (payload.username) {
      document.getElementById("username").textContent = payload.username;
    }
  } catch (e) {
    console.error("Invalid token", e);
  }
}

function renderCumulativeGrowthChart(dates, values) {
  const ctx = document.getElementById("cumulativeGrowthChart").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        {
          label: "Cumulative Growth",
          data: values,
          fill: false,
          borderColor: "rgba(75, 192, 192, 1)",
          tension: 0.1,
          pointRadius: 5,
          pointBackgroundColor: "rgba(75, 192, 192, 1)",
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: {
          title: {
            display: true,
            text: "Date",
          },
          ticks: {
            autoSkip: true,
            maxRotation: 45,
            minRotation: 45,
          },
        },
        yAxes: [{
          scaleLabel: {
            display: true,
            labelString: "Net Worth (GBP)"
          }
        }]
        ,
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
        },
      },
    },
  });
}

const colorPalette = [
  "rgba(75, 192, 192, 0.7)",
  "rgba(153, 102, 255, 0.7)", 
  "rgba(255, 159, 64, 0.7)", 
  "rgba(54, 162, 235, 0.7)", 
  "rgba(255, 99, 132, 0.7)",
  "rgba(255, 205, 86, 0.7)", 
  "rgba(201, 203, 207, 0.7)", 
];

function renderAssetCompositionChart(assets) {
  const ctx = document.getElementById("assetCompositionChart").getContext("2d");
  const labels = assets.map((asset) => asset.ticker);
  const data = assets.map((asset) => asset.quantity);
  const backgroundColors = generateColorPalette(assets.length);

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: backgroundColors,
        },
      ],
    },
    options: {
      responsive: true,
      legend: {
        position: "right",
        labels: {
          fontSize: 14, 
          fontStyle: "bold",
          generateLabels: function (chart) {
            const dataset = chart.data.datasets[0];
            return chart.data.labels.map((label, i) => {
              const value = dataset.data[i];
              return {
                text: `${label} (${value})`,
                fillStyle: dataset.backgroundColor[i],
                hidden: isNaN(dataset.data[i]) || dataset.data[i] === null,
                index: i,
              };
            });
          },
        },
      },
      tooltips: {
        callbacks: {
          label: function (tooltipItem, data) {
            const label = data.labels[tooltipItem.index];
            const value = data.datasets[0].data[tooltipItem.index];
            return `${label}: ${value} units`;
          },
        },
      },
    },
  });
}

function generateColorPalette(count) {
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(colorPalette[i % colorPalette.length]);
  }
  return colors;
}

const portfolioId = localStorage.getItem("portfolioId");
const portfolioName = localStorage.getItem("portfolioName");
const portfolioExchange = localStorage.getItem("portfolioExchange");

document
  .getElementById("addAssetForm")
  .addEventListener("submit", async function (event) {
    event.preventDefault();

    const quantity = document.getElementById("addQuantityInput").value;
    const ticker = document
      .getElementById("addTickerInput")
      .value.trim()
      .toUpperCase();

    if (!ticker || !quantity || quantity <= 0) {
      showModal("Please enter a valid ticker and quantity.", "error");
      return;
    }

    try {
      const res = await fetch(`${SERVER_ENDPOINT}/portfolio/asset/${portfolioId}`, {
        headers: {
          Authorization: "Bearer " + token,
        },
      });

      if (!res.ok) throw new Error("Failed to fetch assets for validation.");

      const existingAssets = await res.json();
      const alreadyExists = existingAssets.some(
        (a) => a.ticker.toUpperCase() === ticker
      );

      if (alreadyExists) {
        showModal(`The asset ${ticker} already exists in this portfolio.`, "error");
        return;
      }

      const addRes = await fetch(`${SERVER_ENDPOINT}/portfolio/asset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          ticker: ticker,
          quantity: quantity,
        }),
      });

      if (!addRes.ok) throw new Error("Failed to add asset.");

      const data = await addRes.json();

      if (data.success) {
        showModal(`Asset ${ticker} added successfully!`, "success");
        document.getElementById("addAssetForm").reset();
      } else {
        showModal("Failed to add asset: " + (data.error || "Unknown error."), "error");
      }
    } catch (err) {
      console.error(err);
      showModal("An error occurred: " + err.message, "error");
    }
  });

document
  .getElementById("transactionForm")
  .addEventListener("submit", function (event) {
    event.preventDefault();

    const ticker = document.getElementById("transactionTickerInput").value;
    const transactionTypeElement = document.getElementById(
      "transactionTypeInput"
    );

    const transactionType =
      transactionTypeElement.options[transactionTypeElement.selectedIndex].text;
    const quantity = parseInt(
      document.getElementById("transactionQuantityInput").value
    );

    fetch(`${SERVER_ENDPOINT}/portfolio/asset`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        ticker: ticker,
        transaction_type: transactionType,
        quantity: quantity,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to make transaction.");
        }
        return response.json();
      })
      .then((data) => {
        if (data.success) {
          showModal("Transaction made successfully!", "success");
        } else {
          showModal("Failed to make transaction: " + (data.error || "Unknown error."), "error");
        }
      })
      .catch((error) => {
        showModal("An error occurred: " + error.message, "error");
      });
  });

  
