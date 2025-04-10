// BACKEND.JS

// ------------------------------
//  Load dependencies
// ------------------------------
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config(); // If you use dotenv to load env vars locally

// ------------------------------
//  Initialize Express
// ------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------
//  Basic logging middleware
// ------------------------------
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url} - Content-Type: ${req.headers["content-type"]}`
  );
  next();
});

// ------------------------------
//  CORS Configuration
// ------------------------------
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// Explicit handler for all OPTIONS requests
app.options("*", (req, res) => {
  console.log("CORS preflight (OPTIONS) request on:", req.path);
  return res.status(204).end();
});

// ------------------------------
//  Body Parsers
// ------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------------------
//  Stripe Initialization
// ------------------------------
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("Warning: STRIPE_SECRET_KEY is not set in environment!");
}
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "");

// ------------------------------
//  Nodemailer Setup
// ------------------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ------------------------------
//  In-memory store
// ------------------------------
const store = {
  users: [],
  orders: [],
  sessions: {},
};

// ------------------------------
//  Test Endpoint
// ------------------------------
app.get("/api/test", (req, res) => {
  console.log("Test endpoint called successfully");
  return res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ------------------------------
//  Payment Intent Endpoint
// ------------------------------
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    console.log("POST /api/create-payment-intent =>", req.body);

    const { amount } = req.body;
    if (!amount) {
      console.log("Error: 'amount' is required");
      return res.status(400).json({ error: "Amount is required" });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      console.log(`Error: Invalid amount -> ${amount}`);
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    // Convert to pence
    const amountInPennies = Math.round(numericAmount * 100);
    console.log(`Creating PaymentIntent for ${amountInPennies} pence (i.e. £${numericAmount})`);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPennies,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
    });

    console.log("Payment intent created:", paymentIntent.id);
    return res.json({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
    });
  } catch (error) {
    console.error("Error in POST /api/create-payment-intent:", error);
    return res.status(500).json({
      error: "Failed to create payment intent",
      message: error.message,
    });
  }
});

// ------------------------------
//  Helper - Send order confirmation email
// ------------------------------
async function sendOrderConfirmationEmail(order) {
  try {
    // Format items
    const itemsList = order.items
      .map(
        (item) =>
          `${item.name} - Qty: ${item.quantity} - £${(item.price * item.quantity).toFixed(2)}`
      )
      .join("\n");

    // Customer email
    const customerMailOptions = {
      from: process.env.EMAIL_USER,
      to: order.customerEmail,
      subject: `Order Confirmation #${order.orderId} - Melissa's Melts`,
      text: `
Thank you for your order!

Order #${order.orderId}
Date: ${new Date(order.createdAt).toLocaleDateString()}

Items:
${itemsList}

Subtotal: £${order.subtotal.toFixed(2)}
Shipping: ${
        order.shipping === 0 ? "Free" : "£" + order.shipping.toFixed(2)
      }
Total: £${order.total.toFixed(2)}

Shipping Address:
${order.customerName}
${order.customerAddress}
${order.customerCity}, ${order.customerPostcode}

Thank you for shopping with Melissa's Melts!
      `,
    };

    // Owner email
    const ownerMailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Order #${order.orderId} - Melissa's Melts`,
      text: `
A new order has been placed!

Order #${order.orderId}
Date: ${new Date(order.createdAt).toLocaleDateString()}

Customer:
Name: ${order.customerName}
Email: ${order.customerEmail}
Phone: ${order.customerPhone || "Not provided"}

Items:
${itemsList}

Subtotal: £${order.subtotal.toFixed(2)}
Shipping: ${
        order.shipping === 0 ? "Free" : "£" + order.shipping.toFixed(2)
      }
Total: £${order.total.toFixed(2)}

Shipping Address:
${order.customerAddress}
${order.customerCity}, ${order.customerPostcode}
      `,
    };

    await transporter.sendMail(customerMailOptions);
    await transporter.sendMail(ownerMailOptions);

    console.log(`Order confirmation emails sent for order ${order.orderId}`);
    return true;
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    return false;
  }
}

// ------------------------------
//  File-based storage (optional)
// ------------------------------
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

function initializeDataStorage() {
  console.log("Initializing data storage...");
  let usingFileSystem = true;

  try {
    // Create data directory if needed
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      console.log("Created data directory:", DATA_DIR);
    }

    // Load users
    if (fs.existsSync(USERS_FILE)) {
      try {
        const data = fs.readFileSync(USERS_FILE, "utf8");
        store.users = JSON.parse(data);
        console.log(`Loaded ${store.users.length} users from file`);
      } catch (err) {
        console.error("Error loading users file:", err.message);
      }
    } else {
      fs.writeFileSync(USERS_FILE, JSON.stringify([]));
      console.log("Created empty users file");
    }

    // Load orders
    if (fs.existsSync(ORDERS_FILE)) {
      try {
        const data = fs.readFileSync(ORDERS_FILE, "utf8");
        store.orders = JSON.parse(data);
        console.log(`Loaded ${store.orders.length} orders from file`);
      } catch (err) {
        console.error("Error loading orders file:", err.message);
      }
    } else {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([]));
      console.log("Created empty orders file");
    }
  } catch (error) {
    console.error("Error initializing data storage:", error.message);
    console.log("Will use in-memory storage only.");
    usingFileSystem = false;
  }

  return usingFileSystem;
}

const useFileSystem = initializeDataStorage();

function saveData(type, data) {
  if (!useFileSystem) return false;
  try {
    const filePath = type === "users" ? USERS_FILE : ORDERS_FILE;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error saving ${type}:`, error.message);
    return false;
  }
}

// ------------------------------
//  Auth Middleware
// ------------------------------
function authenticate(req, res, next) {
  const tokenHeader = req.headers.authorization || "";
  const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.split(" ")[1] : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const session = store.sessions[token];
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Check expiration (24 hours)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    delete store.sessions[token];
    return res.status(401).json({ error: "Session expired" });
  }

  req.user = session.user;
  next();
}

// ------------------------------
//  Auth Routes
// ------------------------------

// Register
app.post("/api/auth/register", (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" });
    }

    const existingUser = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");

    const userId = crypto.randomBytes(16).toString("hex");
    const newUser = {
      userId,
      email,
      name,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
      points: 0,
      orders: [],
    };

    store.users.push(newUser);
    saveData("users", store.users);

    const token = crypto.randomBytes(32).toString("hex");
    store.sessions[token] = {
      user: {
        userId: newUser.userId,
        email: newUser.email,
        name: newUser.name,
        points: newUser.points,
      },
      createdAt: Date.now(),
    };

    return res.json({
      user: {
        userId: newUser.userId,
        email: newUser.email,
        name: newUser.name,
        points: newUser.points,
      },
      token,
    });
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ error: "Failed to register user" });
  }
});

// Login
app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const hash = crypto.pbkdf2Sync(password, user.passwordSalt, 1000, 64, "sha512").toString("hex");
    if (hash !== user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    store.sessions[token] = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      createdAt: Date.now(),
    };

    return res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      token,
    });
  } catch (error) {
    console.error("Error logging in:", error);
    return res.status(500).json({ error: "Failed to log in" });
  }
});

// Google sign-in (mock)
app.post("/api/auth/google", (req, res) => {
  try {
    const { token, email, name, picture } = req.body;
    if (!token || !email || !name) {
      return res.status(400).json({ error: "Token, email, and name are required" });
    }

    let user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      const userId = crypto.randomBytes(16).toString("hex");
      user = {
        userId,
        email,
        name,
        picture,
        googleId: token.substring(0, 20), // mock
        createdAt: new Date().toISOString(),
        points: 0,
        orders: [],
      };
      store.users.push(user);
      saveData("users", store.users);
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    store.sessions[sessionToken] = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        points: user.points,
      },
      createdAt: Date.now(),
    };

    return res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        points: user.points,
      },
      token: sessionToken,
    });
  } catch (error) {
    console.error("Error with Google sign-in:", error);
    return res.status(500).json({ error: "Failed to authenticate with Google" });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.split(" ")[1] : null;
  if (token && store.sessions[token]) {
    delete store.sessions[token];
  }
  return res.json({ success: true });
});

// Get user
app.get("/api/user", authenticate, (req, res) => {
  return res.json(req.user);
});

// Update user
app.put("/api/user", authenticate, (req, res) => {
  try {
    const { name, address, city, postcode, phone } = req.body;

    const userIndex = store.users.findIndex((u) => u.userId === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    if (name) store.users[userIndex].name = name;
    if (address) store.users[userIndex].address = address;
    if (city) store.users[userIndex].city = city;
    if (postcode) store.users[userIndex].postcode = postcode;
    if (phone) store.users[userIndex].phone = phone;

    saveData("users", store.users);

    const tokenHeader = req.headers.authorization || "";
    const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.split(" ")[1] : null;
    if (token && store.sessions[token]) {
      store.sessions[token].user = {
        userId: store.users[userIndex].userId,
        email: store.users[userIndex].email,
        name: store.users[userIndex].name,
        points: store.users[userIndex].points,
        picture: store.users[userIndex].picture,
      };
    }

    return res.json(store.users[userIndex]);
  } catch (error) {
    console.error("Error updating user:", error);
    return res.status(500).json({ error: "Failed to update user" });
  }
});

// ------------------------------
//  Orders & Payment
// ------------------------------
app.post("/api/orders", (req, res) => {
  try {
    console.log("POST /api/orders =>", req.body);
    const {
      items,
      total,
      shipping,
      discount,
      customerEmail,
      customerName,
      customerPhone,
      customerAddress,
      customerCity,
      customerPostcode,
      paymentId,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items are required" });
    }

    // Generate a simple unique order ID
    const orderId = `ORD-${Date.now().toString().slice(-6)}`;

    const order = {
      orderId,
      items,
      total: parseFloat(total) || 0,
      subtotal: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
      shipping: parseFloat(shipping) || 0,
      discount: parseFloat(discount) || 0,
      status: paymentId ? "paid" : "pending",
      createdAt: new Date().toISOString(),
      customerEmail,
      customerName,
      customerPhone,
      customerAddress,
      customerCity,
      customerPostcode,
      paymentId,
    };

    store.orders.push(order);
    saveData("orders", store.orders);

    // Fire off confirmation email (async, don't block)
    sendOrderConfirmationEmail(order);

    return res.json({
      success: true,
      order: {
        orderId,
        status: order.status,
      },
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return res.status(500).json({ error: "Failed to create order" });
  }
});

// Single order
app.get("/api/orders/:orderId", (req, res) => {
  try {
    const { orderId } = req.params;
    const order = store.orders.find((o) => o.orderId === orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    // Optionally enforce that the user must match
    // if (req.user && order.userId !== "guest" && order.userId !== req.user.userId) {
    //   return res.status(403).json({ error: "Not authorized to view this order" });
    // }
    return res.json(order);
  } catch (error) {
    console.error("Error fetching order:", error);
    return res.status(500).json({ error: "Failed to fetch order" });
  }
});

// All orders for authenticated user
app.get("/api/orders", authenticate, (req, res) => {
  try {
    const userOrders = store.orders.filter((o) => o.userId === req.user.userId);
    return res.json(userOrders);
  } catch (error) {
    console.error("Error fetching user orders:", error);
    return res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Apply coupon
app.post("/api/apply-coupon", (req, res) => {
  try {
    const { code } = req.body;
    const validCoupons = {
      WELCOME10: { discount: 0.1, type: "percentage", description: "10% off your order" },
      MELTS5: { discount: 0.05, type: "percentage", description: "5% off your order" },
      SOAP20: { discount: 0.2, type: "percentage", description: "20% off your order" },
      FREESHIP: { discount: 5.99, type: "fixed", description: "Free shipping" },
      SUMMER15: { discount: 0.15, type: "percentage", description: "15% summer discount" },
    };

    if (!code || !validCoupons[code.toUpperCase()]) {
      return res.status(400).json({ error: "Invalid coupon code" });
    }

    const coupon = validCoupons[code.toUpperCase()];
    return res.json({
      success: true,
      coupon: {
        code: code.toUpperCase(),
        ...coupon,
      },
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    return res.status(500).json({ error: "Failed to apply coupon" });
  }
});

// Use points
app.post("/api/use-points", authenticate, (req, res) => {
  try {
    const { points } = req.body;
    const pointsToUse = parseInt(points, 10);
    if (!points || isNaN(pointsToUse) || pointsToUse <= 0) {
      return res.status(400).json({ error: "Valid points amount is required" });
    }

    const userIndex = store.users.findIndex((u) => u.userId === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    if (store.users[userIndex].points < pointsToUse) {
      return res.status(400).json({ error: "Not enough points" });
    }

    store.users[userIndex].points -= pointsToUse;
    saveData("users", store.users);

    // Update session
    const tokenHeader = req.headers.authorization || "";
    const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.split(" ")[1] : null;
    if (token && store.sessions[token]) {
      store.sessions[token].user.points = store.users[userIndex].points;
    }

    return res.json({
      success: true,
      points: store.users[userIndex].points,
      pointsUsed: pointsToUse,
      discount: pointsToUse * 0.01,
    });
  } catch (error) {
    console.error("Error using points:", error);
    return res.status(500).json({ error: "Failed to use points" });
  }
});

// ------------------------------
//  Newsletter & Contact
// ------------------------------
app.post("/api/subscribe", (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    console.log(`Newsletter subscription from: ${name || "Unknown"} <${email}>`);
    return res.json({ success: true });
  } catch (error) {
    console.error("Error subscribing to newsletter:", error);
    return res.status(500).json({ error: "Failed to subscribe" });
  }
});

app.post("/api/contact", (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!email || !message) {
      return res.status(400).json({ error: "Email and message are required" });
    }
    console.log(`Contact form: ${name || "Unknown"} <${email}> => ${message}`);
    return res.json({ success: true });
  } catch (error) {
    console.error("Error with contact form:", error);
    return res.status(500).json({ error: "Failed to submit contact form" });
  }
});

app.post("/api/workshop-request", (req, res) => {
  try {
    const { name, email, date, participants } = req.body;
    if (!email || !date) {
      return res.status(400).json({ error: "Email and date are required" });
    }
    console.log(`Workshop request from: ${name || "Unknown"} <${email}> => Date: ${date}, Participants: ${participants || 1}`);
    return res.json({ success: true });
  } catch (error) {
    console.error("Error with workshop request:", error);
    return res.status(500).json({ error: "Failed to submit workshop request" });
  }
});

// ------------------------------
//  Serve static files
// ------------------------------
app.use(express.static(path.join(__dirname, "public")));

// Catch-all for front-end routes
app.get("*", (req, res) => {
  const filePath = path.join(__dirname, "public", req.path === "/" ? "index.html" : req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath);
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

// ------------------------------
//  Start server
// ------------------------------
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

server.on("error", (error) => {
  console.error("Server error:", error.message);
});

// Global error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error.message);
  console.error(error.stack);
});
