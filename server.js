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

// file to store orders
const ORDERS_FILE = path.join(__dirname, "orders.json");

// read orders from file
function readOrders() {
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
  }
  const data = fs.readFileSync(ORDERS_FILE, "utf8");
  return JSON.parse(data);
}

// write orders to file
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}

// test
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Orders API is running" });
});

// save order
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
    notes
  } = req.body;

  if (!customerName || !phone) {
    return res.status(400).json({ error: "customerName and phone required" });
  }

  const orders = readOrders();
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
    qty,
    notes,
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);
  writeOrders(orders);

  res.json({ ok: true, order: newOrder });
});

// list orders
app.get("/api/orders", (req, res) => {
  const orders = readOrders();
  res.json(orders);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
