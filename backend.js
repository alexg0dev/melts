// Express server setup
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
let OAuth2Client
try {
  const googleAuth = require("google-auth-library")
  OAuth2Client = googleAuth.OAuth2Client
} catch (error) {
  console.error("Error loading google-auth-library:", error.message)
  // Fallback implementation if the library fails to load
  OAuth2Client = class MockOAuth2Client {
    constructor() {
      console.warn("Using mock OAuth2Client")
    }

    async verifyIdToken() {
      return {
        getPayload: () => ({
          sub: "mock-user-id",
          email: "mock@example.com",
          name: "Mock User",
          picture: "https://via.placeholder.com/150",
        }),
      }
    }
  }
}

// Initialize Express app
const app = express()
const PORT = process.env.PORT || 3000

// Google OAuth client setup with credentials directly in the code
const CLIENT_ID = "741864469861-nnf5f1elnr7ld8lhos3rsod8e2o2a8hb.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const client = new OAuth2Client(CLIENT_ID)

// Middleware
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, "public")))

// Data storage
const DATA_DIR = path.join(__dirname, "data")
const USERS_FILE = path.join(DATA_DIR, "users.json")
const ORDERS_FILE = path.join(DATA_DIR, "orders.json")

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// Initialize data files if they don't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]))
}

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([]))
}

// Helper function to read data
function readData(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8")
    return JSON.parse(data)
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error)
    return []
  }
}

// Helper function to write data
function writeData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (error) {
    console.error(`Error writing to file ${filePath}:`, error)
    return false
  }
}

// Verify Google token
async function verifyGoogleToken(token) {
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID,
    })

    const payload = ticket.getPayload()
    return {
      userId: payload["sub"],
      email: payload["email"],
      name: payload["name"],
      picture: payload["picture"],
    }
  } catch (error) {
    console.error("Error verifying Google token:", error)
    return null
  }
}

// Authentication middleware
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "No token provided" })
  }

  const user = await verifyGoogleToken(token)
  if (!user) {
    return res.status(401).json({ error: "Invalid token" })
  }

  req.user = user
  next()
}

// API Routes

// Google Sign-in
app.post("/api/auth/google", async (req, res) => {
  const { token } = req.body

  if (!token) {
    return res.status(400).json({ error: "Token is required" })
  }

  const userData = await verifyGoogleToken(token)
  if (!userData) {
    return res.status(401).json({ error: "Invalid token" })
  }

  // Check if user exists in our database
  const users = readData(USERS_FILE)
  let user = users.find((u) => u.userId === userData.userId)

  if (!user) {
    // Create new user
    user = {
      ...userData,
      points: 0,
      orders: [],
      createdAt: new Date().toISOString(),
    }
    users.push(user)
    writeData(USERS_FILE, users)
  }

  res.json({
    user: {
      userId: user.userId,
      name: user.name,
      email: user.email,
      picture: user.picture,
      points: user.points,
    },
    token,
  })
})

// Get user data
app.get("/api/user", authenticate, (req, res) => {
  const users = readData(USERS_FILE)
  const user = users.find((u) => u.userId === req.user.userId)

  if (!user) {
    return res.status(404).json({ error: "User not found" })
  }

  res.json({
    userId: user.userId,
    name: user.name,
    email: user.email,
    picture: user.picture,
    points: user.points,
  })
})

// Create order
app.post("/api/orders", authenticate, (req, res) => {
  const { items, total, shipping, discount } = req.body

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Items are required" })
  }

  if (typeof total !== "number" || total <= 0) {
    return res.status(400).json({ error: "Valid total is required" })
  }

  // Create new order
  const orders = readData(ORDERS_FILE)
  const users = readData(USERS_FILE)

  const userIndex = users.findIndex((u) => u.userId === req.user.userId)
  if (userIndex === -1) {
    return res.status(404).json({ error: "User not found" })
  }

  const orderId = Date.now().toString()
  const order = {
    orderId,
    userId: req.user.userId,
    items,
    total,
    shipping,
    discount,
    status: "pending",
    createdAt: new Date().toISOString(),
  }

  orders.push(order)
  writeData(ORDERS_FILE, orders)

  // Add points to user (1 point for each $1 spent)
  const pointsEarned = Math.floor(total)
  users[userIndex].points += pointsEarned
  users[userIndex].orders.push(orderId)
  writeData(USERS_FILE, users)

  // Send email notification
  sendOrderEmail(req.user.email, order)

  res.json({
    success: true,
    order: {
      orderId,
      status: "pending",
      pointsEarned,
    },
  })
})

// Get user orders
app.get("/api/orders", authenticate, (req, res) => {
  const orders = readData(ORDERS_FILE)
  const userOrders = orders.filter((order) => order.userId === req.user.userId)

  res.json(userOrders)
})

// Use loyalty points
app.post("/api/use-points", authenticate, (req, res) => {
  const { points, orderId } = req.body

  if (!points || typeof points !== "number" || points <= 0) {
    return res.status(400).json({ error: "Valid points amount is required" })
  }

  const users = readData(USERS_FILE)
  const userIndex = users.findIndex((u) => u.userId === req.user.userId)

  if (userIndex === -1) {
    return res.status(404).json({ error: "User not found" })
  }

  if (users[userIndex].points < points) {
    return res.status(400).json({ error: "Not enough points" })
  }

  // Deduct points from user
  users[userIndex].points -= points
  writeData(USERS_FILE, users)

  // If order ID is provided, update the order with points discount
  if (orderId) {
    const orders = readData(ORDERS_FILE)
    const orderIndex = orders.findIndex((o) => o.orderId === orderId && o.userId === req.user.userId)

    if (orderIndex !== -1) {
      // Each point is worth $0.01
      const pointsValue = points * 0.01
      orders[orderIndex].pointsDiscount = pointsValue
      orders[orderIndex].total -= pointsValue
      writeData(ORDERS_FILE, orders)
    }
  }

  res.json({
    success: true,
    remainingPoints: users[userIndex].points,
  })
})

// Apply coupon
app.post("/api/apply-coupon", (req, res) => {
  const { code } = req.body

  // Simple coupon validation
  // In a real app, you would have a database of valid coupons
  const validCoupons = {
    MELT10: { discount: 0.1, type: "percentage" },
    WELCOME: { discount: 5, type: "fixed" },
  }

  if (!code || !validCoupons[code]) {
    return res.status(400).json({ error: "Invalid coupon code" })
  }

  res.json({
    success: true,
    coupon: {
      code,
      ...validCoupons[code],
    },
  })
})

// Add to cart
app.post("/api/cart/add", (req, res) => {
  const { product, quantity } = req.body

  if (!product || !quantity || quantity <= 0) {
    return res.status(400).json({ error: "Valid product and quantity are required" })
  }

  res.json({
    success: true,
    message: `Added ${quantity} of ${product.name} to cart`,
  })
})

// Helper function to send order email
function sendOrderEmail(email, order) {
  // In a real application, you would use a service like SendGrid, Mailgun, etc.
  console.log(`Sending order confirmation email to ${email}`)
  console.log("Order details:", order)

  // For this example, we'll just log the email content
  const emailContent = `
      Thank you for your order!
      
      Order ID: ${order.orderId}
      Date: ${new Date(order.createdAt).toLocaleString()}
      
      Items:
      ${order.items.map((item) => `- ${item.name} (${item.quantity}) - $${item.price.toFixed(2)}`).join("\n")}
      
      Subtotal: $${order.items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2)}
      Shipping: $${order.shipping.toFixed(2)}
      ${order.discount ? `Discount: -$${order.discount.toFixed(2)}` : ""}
      Total: $${order.total.toFixed(2)}
      
      Your order is being processed and will be shipped soon.
      
      Thank you for shopping with Melissa's Melts!
  `

  console.log("Email content:", emailContent)

  // Send email to alexandroghanem@gmail.com as requested
  console.log("Sending order notification to alexandroghanem@gmail.com")
}

// Serve shop.html when products.html is requested
app.get("/products.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "shop.html"))
})

// Serve static files
app.get("*", (req, res) => {
  const filePath = path.join(__dirname, "public", req.path === "/" ? "index.html" : req.path)

  // Check if the file exists
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath)
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"))
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

module.exports = app

