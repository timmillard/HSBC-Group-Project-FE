// Populate username from JWT in localStorage
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
} else {
  window.location.href = `/auth_page.html`;
}

const portfolioIds = [];
const portfolioNames = {};
const assetTickers = {};
let chart = null;
// format numbers to 2dp with thousand separators
const fmt2 = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });


// Fetch user portfolio IDs
fetch(`${SERVER_ENDPOINT}/userPortfolio/userPortfolio`, {
  headers: { Authorization: "Bearer " + token },
})
  .then((response) => response.json())
  .then((data) => {
    data.forEach((pa) => portfolioIds.push(pa.portfolio_id));
    // for each portfolio
    fetchPortfolioDetails();
  })
  .catch((err) => console.error("Error fetching user portfolio IDs:", err));

function fetchPortfolioDetails() {
  fetch(`${SERVER_ENDPOINT}/portfolio/portfolio`, {
    headers: { Authorization: "Bearer " + token },
  })
    .then((response) => response.json())
    .then(async (data) => {
      for (const portfolio of data) {
        portfolioNames[portfolio.id] = portfolio.name;

        const res = await fetch(`${SERVER_ENDPOINT}/portfolio/asset/${portfolio.id}`, {
          headers: { Authorization: "Bearer " + token },
        });
        const assets = await res.json();
        assets.forEach((a) => {
          assetTickers[a.id] = a.ticker; // map asset_id to tickers used later
        });
      }

      // Build a merged date axis chart across all portfolios
      await buildNetWorthChart();

      // Always call fetchTransactions after portfolioNames and assetTickers are populated
      fetchTransactions();
    })
    .catch((err) => console.error("Error fetching portfolio details:", err));
}

// Build chart with union of dates across portfolios
async function buildNetWorthChart() {
  // fetch all portfolio series in parallel
  const seriesList = await Promise.all(
    portfolioIds.map(async (portfolioId, index) => {
      const resp = await fetch(
        `${SERVER_ENDPOINT}/portfolio/portfolio/getCumulativePricesforPortfolio/${portfolioId}`,
        { headers: { Authorization: "Bearer " + token } }
      );
      const data = await resp.json();
      if (data?.dates?.length && data?.values?.length) {
        return {
          name: portfolioNames[portfolioId] || `Portfolio ${portfolioId}`,
          dates: data.dates,
          values: data.values,
          index,
        };
      }
      return null;
    })
  );

  const cleaned = seriesList.filter(Boolean);
  if (!cleaned.length) return;

  // union of all dates, sorted ascending
  const unionDates = Array.from(
    new Set(cleaned.flatMap((s) => s.dates))
  ).sort();

  // reindex each portfolio’s values onto the union axis (carry-forward after start, null before)
  const datasets = cleaned.map((s) => {
    const reindexed = reindexWithCarryForward(unionDates, s.dates, s.values);
    return {
      label: s.name,
      backgroundColor: `rgba(${s.index * 50}, 123, 255, 0.2)`,
      borderColor: `rgba(${s.index * 50}, 123, 255, 1)`,
      data: reindexed,
      fill: true,
      spanGaps: true, // allow gaps (nulls before a series starts)
    };
  });

  if (chart) chart.destroy();
  chart = new Chart("netWorthChart", {
    type: "line",
    data: {
      labels: unionDates,
      datasets,
    },
    options: {
      responsive: true,
      scales: {
        x: { type: "category", scaleLabel: { display: true, text: "Date" } },
        yAxes: [{
          scaleLabel: {
            display: true,
            labelString: "Net Worth (USD)"
          }
        }]
      },
      plugins: { legend: { display: true, position: "top" } },
    },
  });
}

// Map (dates, values) onto unionDates with carry-forward after first known point.
// Before the first known point, return null to create a gap.
function reindexWithCarryForward(unionDates, dates, values) {
  const map = Object.create(null);
  for (let i = 0; i < dates.length; i++) {
    map[dates[i]] = values[i];
  }

  const out = [];
  let started = false;
  let last = null;

  for (const d of unionDates) {
    if (map[d] != null) {
      last = map[d];
      started = true;
      out.push(last);
    } else {
      out.push(started ? last : null);
    }
  }

  return out;
}

// Populate portfolio table
const table = document
  .getElementById("portfolioTable")
  .getElementsByTagName("tbody")[0];

let totalNetWorth = 0;

fetch(`${SERVER_ENDPOINT}/portfolio/portfolio`, {
  headers: { Authorization: "Bearer " + token },
})
  .then((response) => response.json())
  .then(async (data) => {
    // process all portfolios in parallel and wait for all to finish
    await Promise.all(
      data.map(async (p) => {
        const newRow = table.insertRow();
        const pName = newRow.insertCell(0);
        const pExchange = newRow.insertCell(1);
        const pValue = newRow.insertCell(2);
        const manageButton = newRow.insertCell(3);

        pName.textContent = p.name;
        pExchange.textContent = p.exchange;
        pValue.textContent = "-";
        manageButton.innerHTML = `<button class="btn btn-outline-dark" onclick="managePortfolio(${p.id}, '${p.name}', '${p.exchange}')">Manage</button>`;

        // Fetch current portfolio value
        try {
          const res = await fetch(
            `${SERVER_ENDPOINT}/portfolio/portfolio/getCumulativePricesforPortfolio/${p.id}`,
            { headers: { Authorization: "Bearer " + token } }
          );
          const valueData = await res.json();
          if (valueData?.values?.length) {
            const latestValue = valueData.values[valueData.values.length - 1];
            pValue.textContent = `$${fmt2(latestValue)}`
            totalNetWorth += Number(latestValue);
          } else {
            pValue.textContent = "-";
          }
        } catch (err) {
          console.error("Error fetching portfolio value:", err);
          pValue.textContent = "-";
        }
      })
    );

    // Update the Net Worth card once everything is done
    const netWorthEl = document.getElementById("netWorthValue");
    if (netWorthEl) {
      netWorthEl.textContent = `$${fmt2(totalNetWorth)}`
    }
  })
  .catch((err) => console.error("Error fetching portfolio details:", err));

// helper for manage page navigation
function managePortfolio(id, name, exchange) {
  localStorage.setItem("portfolioId", id);
  localStorage.setItem("portfolioName", name);
  localStorage.setItem("portfolioExchange", exchange);
  window.location.href = "/manage.html";
}

// Adds new portfolio and updates table accordingly
document
  .getElementById("addPortfolioForm")
  .addEventListener("submit", function (e) {
    e.preventDefault();

    const name = document.getElementById("portfolioName").value;
    const exchange = document.getElementById("portfolioExchange").value;
    const ticker = document.getElementById("tickerInput").value;
    const quantity = document.getElementById("quantityInput").value;

    fetch(`${SERVER_ENDPOINT}/portfolio/portfolio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ name, exchange, ticker, quantity }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to add portfolio");
        return response.json();
      })
      .then((newPortfolio) => {
        const table = document
          .getElementById("portfolioTable")
          .getElementsByTagName("tbody")[0];
        const newRow = table.insertRow();
        const pName = newRow.insertCell(0);
        const pExchange = newRow.insertCell(1);
        const pValue = newRow.insertCell(2);
        const manageButton = newRow.insertCell(3);

        pName.textContent = newPortfolio.name;
        pExchange.textContent = newPortfolio.exchange;
        pValue.textContent = "-";
        manageButton.innerHTML = `<button class="btn btn-outline-dark" onclick="managePortfolio(${newPortfolio.id}, '${newPortfolio.name}', '${newPortfolio.exchange}')">Manage</button>`;

        // Fetch and update value
        fetch(`${SERVER_ENDPOINT}/portfolio/portfolio/getCumulativePricesforPortfolio/${newPortfolio.id}`, {
          headers: { Authorization: "Bearer " + token }
        })
          .then(res => res.json())
          .then(valueData => {
            if (valueData?.values?.length) {
              const latestValue = valueData.values[valueData.values.length - 1];
              pValue.textContent = `$${fmt2(latestValue)}`
            }
          });

        document.getElementById("addPortfolioForm").reset();
        const modal = bootstrap.Modal.getInstance(
          document.getElementById("addPortfolioModal")
        );
        modal.hide();
      })
      .catch(err => console.error("Error adding portfolio:", err));
  });

// Update Transaction Table (most recent first)
function fetchTransactions() {
  const table2 = document
    .getElementById("transactionTable")
    .getElementsByTagName("tbody")[0];

  fetch(`${SERVER_ENDPOINT}/transaction/transaction`, {
    headers: { Authorization: "Bearer " + token },
  })
    .then((response) => response.json())
    .then((data) => {
      // Clear existing rows (in case this is called more than once)
      table2.innerHTML = "";

      // Sort by datetime DESC and take top 5
      const rows = (Array.isArray(data) ? data : [])
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
        .slice(0, 5);

      rows.forEach((p) => {
        const date = p.datetime ? new Date(p.datetime) : null;
        const options = {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        };
        const formattedDate = date
          ? date.toLocaleDateString("en-GB", options)
          : "—";

        const newRow = table2.insertRow();

        const portfolioCell = newRow.insertCell(0);
        const tickerCell = newRow.insertCell(1);
        const typeCell = newRow.insertCell(2);
        const quantityCell = newRow.insertCell(3);
        const dateCell = newRow.insertCell(4);

        portfolioCell.textContent = portfolioNames[p.portfolio_id] || "";
        tickerCell.textContent = assetTickers[p.portfolio_asset_id] || "";
        typeCell.textContent = String(p.transaction_type || "").toUpperCase();
        quantityCell.textContent = p.quantity;
        dateCell.textContent = formattedDate;

        if (typeCell.textContent === "BUY") {
          typeCell.classList.add("order-buy");
        } else if (typeCell.textContent === "SELL") {
          typeCell.classList.add("order-sell");
        }
      });
    })
    .catch((err) => console.error("Error fetching transactions:", err));
};
