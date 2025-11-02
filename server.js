// server.js
import express from "express";
import cors from "cors";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// serve frontend
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// ====== MONGO ======
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ordersdb";

await mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch((err) => {
    console.error("❌ Mongo error", err);
    process.exit(1);
  });

// ====== SCHEMAS ======

// CATEGORY lives in DB now
// we use slug as the main id ("hoodie", "pants", ...)
const categorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true }, // hoodie
    name: { type: String, required: true }, // Hoodie
    sizes: { type: [String], default: [] } // ["M","L","XL"]
  },
  { timestamps: true }
);

const stockSchema = new mongoose.Schema(
  {
    category: { type: String, required: true }, // category slug
    name: { type: String, required: true },
    sizes: { type: Object, default: {} }, // { M: 4, L: 2 }
  },
  { timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, default: "" },
    payment: { type: String, default: "cash" },
    category: { type: String, required: true }, // category slug
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "Stock" },
    itemName: { type: String, default: "" },
    size: { type: String, required: true },
    qty: { type: Number, default: 1 },
    notes: { type: String, default: "" },
    price: { type: Number, default: 0 },
    status: { type: String, default: "pending" },
  },
  { timestamps: true }
);

const Category = mongoose.model("Category", categorySchema);
const Stock = mongoose.model("Stock", stockSchema);
const Order = mongoose.model("Order", orderSchema);

// ====== HELPERS ======
const catToClient = (c) => ({
  id: c._id.toString(),
  slug: c.slug,
  name: c.name,
  sizes: c.sizes || [],
});

const stockToClient = (doc) => ({
  id: doc._id.toString(),
  category: doc.category,
  name: doc.name,
  sizes: doc.sizes || {},
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const orderToClient = (doc) => ({
  id: doc._id.toString(),
  customerName: doc.customerName,
  phone: doc.phone,
  address: doc.address,
  payment: doc.payment,
  category: doc.category,
  itemId: doc.itemId ? doc.itemId.toString() : null,
  itemName: doc.itemName,
  size: doc.size,
  qty: doc.qty,
  notes: doc.notes,
  price: doc.price,
  status: doc.status,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

// ====== SEED DEFAULT CATEGORIES (only if empty) ======
const existingCats = await Category.countDocuments();
if (existingCats === 0) {
  console.log("🌱 seeding default categories...");
  await Category.insertMany([
    { slug: "hoodie", name: "Hoodie", sizes: ["M", "L", "XL", "2XL"] },
    { slug: "pants", name: "Pants", sizes: ["M", "L", "XL", "2XL"] },
    { slug: "jeans", name: "Jeans", sizes: ["30", "32", "34", "36", "38"] },
  ]);
}

// ====== ROUTES ======

// health
app.get("/api", (req, res) => {
  res.json({ ok: true, message: "Orders API is running" });
});

// ---------- CATEGORIES (DB) ----------

// get all
app.get("/api/categories", async (req, res) => {
  const cats = await Category.find().sort({ createdAt: 1 });
  res.json(cats.map(catToClient));
});

// create
app.post("/api/categories", async (req, res) => {
  const { name, sizes } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  // avoid duplicates
  const exists = await Category.findOne({ slug });
  if (exists) {
    return res.status(400).json({ error: "category exists" });
  }
  const cat = await Category.create({
    slug,
    name,
    sizes: Array.isArray(sizes) ? sizes : [],
  });
  res.json({ ok: true, category: catToClient(cat) });
});

// delete category → delete stocks → delete orders
app.delete("/api/categories/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    // delete category
    await Category.deleteOne({ slug });

    // find all stocks with this category
    const stocks = await Stock.find({ category: slug });
    const stockIds = stocks.map((s) => s._id);

    // delete orders of these stocks
    await Order.deleteMany({ itemId: { $in: stockIds } });

    // delete the stocks
    await Stock.deleteMany({ category: slug });

    res.json({
      ok: true,
      message: `category ${slug} deleted with its stocks and orders`,
    });
  } catch (err) {
    console.error("delete category error", err);
    res.status(500).json({ error: "server error" });
  }
});

// ---------- STOCKS ----------
app.get("/api/stocks", async (req, res) => {
  const stocks = await Stock.find().sort({ createdAt: -1 });
  res.json(stocks.map(stockToClient));
});

app.post("/api/stocks", async (req, res) => {
  const { category, name, sizes } = req.body;
  if (!category || !name) {
    return res.status(400).json({ error: "category and name required" });
  }
  const stock = await Stock.create({
    category,
    name,
    sizes: sizes || {},
  });
  res.json({ ok: true, stock: stockToClient(stock) });
});

app.put("/api/stocks/:id", async (req, res) => {
  const { id } = req.params;
  const { category, name, sizes } = req.body;
  const stock = await Stock.findById(id);
  if (!stock) return res.status(404).json({ error: "stock not found" });

  if (category !== undefined) stock.category = category;
  if (name !== undefined) stock.name = name;
  if (sizes !== undefined) {
    stock.sizes = sizes;
    stock.markModified("sizes");
  }

  await stock.save();
  res.json({ ok: true, stock: stockToClient(stock) });
});

app.delete("/api/stocks/:id", async (req, res) => {
  const { id } = req.params;
  const stock = await Stock.findById(id);
  if (!stock) return res.status(404).json({ error: "stock not found" });
  await Stock.deleteOne({ _id: id });
  res.json({ ok: true });
});

// ---------- ORDERS ----------
app.get("/api/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders.map(orderToClient));
});

app.post("/api/orders", async (req, res) => {
  try {
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
      status,
    } = req.body;

    if (!customerName || !phone || !itemId || !size) {
      return res.status(400).json({ error: "missing fields" });
    }

    const stock = await Stock.findById(itemId);
    if (!stock) return res.status(400).json({ error: "stock item not found" });

    const want = Number(qty || 1);
    const current = Number((stock.sizes && stock.sizes[size]) || 0);
    if (current < want) {
      return res
        .status(400)
        .json({ error: "not enough stock", available: current });
    }

    stock.sizes[size] = current - want;
    stock.markModified("sizes");
    await stock.save();

    const order = await Order.create({
      customerName,
      phone,
      address: address || "",
      payment: payment || "cash",
      category,
      itemId,
      itemName: itemName || stock.name,
      size,
      qty: want,
      notes: notes || "",
      price: Number(price || 0),
      status: status || "pending",
    });

    const freshStocks = await Stock.find().sort({ createdAt: -1 });
    res.json({
      ok: true,
      order: orderToClient(order),
      stocks: freshStocks.map(stockToClient),
    });
  } catch (err) {
    console.error("create order error", err);
    res.status(500).json({ error: "server error" });
  }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "order not found" });

    const oldQty = order.qty;
    const oldItemId = order.itemId?.toString();
    const oldSize = order.size;

    const newQty = body.qty !== undefined ? Number(body.qty) : oldQty;
    const newItemId = body.itemId || oldItemId;
    const newSize = body.size || oldSize;

    if (newItemId === oldItemId && newSize === oldSize) {
      const stock = await Stock.findById(newItemId);
      if (!stock) return res.status(400).json({ error: "stock item missing" });

      const current = Number(stock.sizes[newSize] || 0);
      const diff = newQty - oldQty;

      if (diff > 0) {
        if (current < diff) {
          return res
            .status(400)
            .json({ error: "not enough stock to increase", available: current });
        }
        stock.sizes[newSize] = current - diff;
      } else if (diff < 0) {
        stock.sizes[newSize] = current + Math.abs(diff);
      }
      stock.markModified("sizes");
      await stock.save();
    } else {
      // return to old stock
      const oldStock = await Stock.findById(oldItemId);
      if (oldStock) {
        const oldCount = Number(oldStock.sizes[oldSize] || 0);
        oldStock.sizes[oldSize] = oldCount + oldQty;
        oldStock.markModified("sizes");
        await oldStock.save();
      }
      // take from new stock
      const newStock = await Stock.findById(newItemId);
      if (!newStock)
        return res.status(400).json({ error: "new stock item missing" });

      const newCount = Number(newStock.sizes[newSize] || 0);
      if (newCount < newQty) {
        return res
          .status(400)
          .json({ error: "not enough stock for new item", available: newCount });
      }
      newStock.sizes[newSize] = newCount - newQty;
      newStock.markModified("sizes");
      await newStock.save();
    }

    order.customerName = body.customerName ?? order.customerName;
    order.phone = body.phone ?? order.phone;
    order.address = body.address ?? order.address;
    order.payment = body.payment ?? order.payment;
    order.category = body.category ?? order.category;
    order.itemId = newItemId;
    order.itemName = body.itemName ?? order.itemName;
    order.size = newSize;
    order.qty = newQty;
    order.notes = body.notes ?? order.notes;
    order.price = body.price ?? order.price;
    order.status = body.status ?? order.status;

    await order.save();

    const freshStocks = await Stock.find().sort({ createdAt: -1 });
    res.json({
      ok: true,
      order: orderToClient(order),
      stocks: freshStocks.map(stockToClient),
    });
  } catch (err) {
    console.error("edit order error", err);
    res.status(500).json({ error: "server error" });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ error: "order not found" });

    const stock = await Stock.findById(order.itemId);
    if (stock) {
      const current = Number(stock.sizes[order.size] || 0);
      stock.sizes[order.size] = current + order.qty;
      stock.markModified("sizes");
      await stock.save();
    }

    await Order.deleteOne({ _id: id });

    const freshStocks = await Stock.find().sort({ createdAt: -1 });
    res.json({ ok: true, stocks: freshStocks.map(stockToClient) });
  } catch (err) {
    console.error("delete order error", err);
    res.status(500).json({ error: "server error" });
  }
});

// fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 server running on " + PORT);
});
