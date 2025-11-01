// server.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

const ORDERS_FILE = path.join(__dirname, "orders.json");
const STOCKS_FILE = path.join(__dirname, "stocks.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ---------- STOCKS ----------

// get all stocks
app.get("/api/stocks", (req, res) => {
  const stocks = readJson(STOCKS_FILE, []);
  res.json(stocks);
});

// create stock
app.post("/api/stocks", (req, res) => {
  const { id, category, name, sizes } = req.body;
  if (!category || !name) return res.status(400).json({ error: "category and name required" });

  const stocks = readJson(STOCKS_FILE, []);
  // create new
  const newItem = {
    id: "stk-" + Math.random().toString(36).slice(2, 9),
    category,
    name,
    sizes: sizes || {}
  };
  stocks.push(newItem);
  writeJson(STOCKS_FILE, stocks);
  res.json({ ok: true, stock: newItem });
});

// edit stock (name/category/sizes)
app.put("/api/stocks/:id", (req, res) => {
  const stockId = req.params.id;
  const { category, name, sizes } = req.body;
  const stocks = readJson(STOCKS_FILE, []);
  const idx = stocks.findIndex(s => s.id === stockId);
  if (idx === -1) return res.status(404).json({ error: "stock not found" });

  const updated = {
    ...stocks[idx],
    category: category ?? stocks[idx].category,
    name: name ?? stocks[idx].name,
    sizes: sizes ?? stocks[idx].sizes
  };

  stocks[idx] = updated;
  writeJson(STOCKS_FILE, stocks);
  res.json({ ok: true, stock: updated });
});

// delete stock
app.delete("/api/stocks/:id", (req, res) => {
  const stockId = req.params.id;
  const stocks = readJson(STOCKS_FILE, []);
  const idx = stocks.findIndex(s => s.id === stockId);
  if (idx === -1) return res.status(404).json({ error: "stock not found" });

  stocks.splice(idx, 1);
  writeJson(STOCKS_FILE, stocks);
  res.json({ ok: true });
});

// ---------- ORDERS ----------

app.get("/api/orders", (req, res) => {
  const orders = readJson(ORDERS_FILE, []);
  res.json(orders);
});

app.post("/api/orders", (req, res) => {
  const {
    customerName,
    phone,
    address,
    payment,
    category,
    itemId,
    itemName,
    size,
    qty,
    notes,
    price,
    status
  } = req.body;

  if (!customerName || !phone || !itemId || !size) {
    return res.status(400).json({ error: "missing fields" });
  }

  // check stock
  const stocks = readJson(STOCKS_FILE, []);
  const stockItem = stocks.find(s => s.id === itemId);
  if (!stockItem) return res.status(400).json({ error: "stock item not found" });

  const currentQty = Number(stockItem.sizes?.[size] || 0);
  const wanted = Number(qty || 1);
  if (currentQty < wanted) {
    return res.status(400).json({ error: "not enough stock", available: currentQty });
  }

  // decrease stock
  stockItem.sizes[size] = currentQty - wanted;
  writeJson(STOCKS_FILE, stocks);

  const orders = readJson(ORDERS_FILE, []);
  const newOrder = {
    id: Date.now(),
    customerName,
    phone,
    address,
    payment,
    category,
    itemId,
    itemName,
    size,
    qty: wanted,
    notes: notes || "",
    price: Number(price || 0),
    status: status || "pending",
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeJson(ORDERS_FILE, orders);

  res.json({ ok: true, order: newOrder });
});

// update order (adjust stock on qty change)
app.put("/api/orders/:id", (req, res) => {
  const orderId = Number(req.params.id);
  const body = req.body;

  const orders = readJson(ORDERS_FILE, []);
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return res.status(404).json({ error: "order not found" });

  const oldOrder = orders[idx];
  const newQty = body.qty !== undefined ? Number(body.qty) : oldOrder.qty;

  // if qty changed -> update stock
  if (newQty !== oldOrder.qty) {
    const diff = newQty - oldOrder.qty;
    const stocks = readJson(STOCKS_FILE, []);
    const stockItem = stocks.find(s => s.id === oldOrder.itemId);
    if (!stockItem) return res.status(400).json({ error: "stock item missing" });
    const currentQty = Number(stockItem.sizes?.[oldOrder.size] || 0);

    if (diff > 0) {
      // need more
      if (currentQty < diff) {
        return res.status(400).json({ error: "not enough stock to increase", available: currentQty });
      }
      stockItem.sizes[oldOrder.size] = currentQty - diff;
    } else if (diff < 0) {
      // return stock
      stockItem.sizes[oldOrder.size] = currentQty + Math.abs(diff);
    }
    writeJson(STOCKS_FILE, stocks);
  }

  const updated = {
    ...oldOrder,
    ...body,
    qty: newQty
  };
  orders[idx] = updated;
  writeJson(ORDERS_FILE, orders);
  res.json({ ok: true, order: updated });
});

app.delete("/api/orders/:id", (req, res) => {
  const orderId = Number(req.params.id);
  const orders = readJson(ORDERS_FILE, []);
  const idx = orders.findIndex(o => o.id === orderId);
  if (idx === -1) return res.status(404).json({ error: "order not found" });

  const order = orders[idx];

  // return stock
  const stocks = readJson(STOCKS_FILE, []);
  const stockItem = stocks.find(s => s.id === order.itemId);
  if (stockItem) {
    const currentQty = Number(stockItem.sizes?.[order.size] || 0);
    stockItem.sizes[order.size] = currentQty + order.qty;
    writeJson(STOCKS_FILE, stocks);
  }

  orders.splice(idx, 1);
  writeJson(ORDERS_FILE, orders);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("running on " + PORT);
});
