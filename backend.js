// Comprehensive Express server with account functionality
const express = require("express")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const crypto = require("crypto")

// Initialize Stripe with your key
const stripe = require("stripe")(
  "sk_test_51RC5BvH1VVhTMbD6JEwbrZZpAABwWiFl7hw4lFjt4SdtfqOKKLre0d1A4XtN334RHOQhTv8ZCW19Eenftw4cl5xm00lIjO5S9P",
)

// Initialize Express app
const app = express()
const PORT = process.env.PORT || 3000

// Basic request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)
  next()
})

// Enable CORS with a permissive configuration
app.use(cors())

// Parse JSON bodies
app.use(express.json())

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }))

// Serve static files
app.use(express.static(path.join(__dirname, "public")))

// In-memory data store with file system backup
const store = {
  users: [],
  orders: [],
  sessions: {},
}

// Data directory and file paths
const DATA_DIR = path.join(__dirname, "data")
const USERS_FILE = path.join(DATA_DIR, "users.json")
const ORDERS_FILE = path.join(DATA_DIR, "orders.json")

// Initialize data storage
function initializeDataStorage() {
  console.log("Initializing data storage...")

  try {
    // Create data directory if it doesn't exist
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      console.log("Created data directory:", DATA_DIR)
    }

    // Load users from file if it exists
    if (fs.existsSync(USERS_FILE)) {
      try {
        const data = fs.readFileSync(USERS_FILE, "utf8")
        store.users = JSON.parse(data)
        console.log(`Loaded ${store.users.length} users from file`)
      } catch (error) {
        console.error("Error loading users from file:", error.message)
      }
    } else {
      // Create empty users file
      fs.writeFileSync(USERS_FILE, JSON.stringify([]))
      console.log("Created empty users file")
    }

    // Load orders from file if it exists
    if (fs.existsSync(ORDERS_FILE)) {
      try {
        const data = fs.readFileSync(ORDERS_FILE, "utf8")
        store.orders = JSON.parse(data)
        console.log(`Loaded ${store.orders.length} orders from file`)
      } catch (error) {
        console.error("Error loading orders from file:", error.message)
      }
    } else {
      // Create empty orders file
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([]))
      console.log("Created empty orders file")
    }

    return true
  } catch (error) {
    console.error("Error initializing data storage:", error.message)
    console.log("Will use in-memory storage only")
    return false
  }
}

// Initialize data storage
const useFileSystem = initializeDataStorage()

// Helper function to save data to file
function saveData(type, data) {
  if (!useFileSystem) return false

  try {
    const filePath = type === "users" ? USERS_FILE : ORDERS_FILE
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    return true
  } catch (error) {
    console.error(`Error saving ${type} to file:`, error.message)
    return false
  }
}

// Authentication middleware
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1]

  if (!token) {
    return res.status(401).json({ error: "Authentication required" })
  }

  const session = store.sessions[token]
  if (!session) {
    return res.status(401).json({ error: "Invalid or expired session" })
  }

  // Check if session is expired (24 hours)
  if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) {
    delete store.sessions[token]
    return res.status(401).json({ error: "Session expired" })
  }

  // Set user on request object
  req.user = session.user
  next()
}

// ACCOUNT MANAGEMENT ENDPOINTS

// Register new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Email, password, and name are required" })
    }

    // Check if user already exists
    const existingUser = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" })
    }

    // Create salt and hash password
    const salt = crypto.randomBytes(16).toString("hex")
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex")

    // Create new user
    const userId = crypto.randomBytes(16).toString("hex")
    const user = {
      userId,
      email,
      name,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
      points: 0,
      orders: [],
    }

    // Save user
    store.users.push(user)
    saveData("users", store.users)

    // Create session token
    const token = crypto.randomBytes(32).toString("hex")
    store.sessions[token] = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      createdAt: Date.now(),
    }

    // Return user data and token
    return res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      token,
    })
  } catch (error) {
    console.error("Error registering user:", error)
    return res.status(500).json({ error: "Failed to register user" })
  }
})

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" })
    }

    // Find user
    const user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Verify password
    const hash = crypto.pbkdf2Sync(password, user.passwordSalt, 1000, 64, "sha512").toString("hex")
    if (hash !== user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" })
    }

    // Create session token
    const token = crypto.randomBytes(32).toString("hex")
    store.sessions[token] = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      createdAt: Date.now(),
    }

    // Return user data and token
    return res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        points: user.points,
      },
      token,
    })
  } catch (error) {
    console.error("Error logging in:", error)
    return res.status(500).json({ error: "Failed to log in" })
  }
})

// Google Sign-in (simplified mock version)
app.post("/api/auth/google", async (req, res) => {
  try {
    const { token, email, name, picture } = req.body

    if (!token || !email || !name) {
      return res.status(400).json({ error: "Token, email, and name are required" })
    }

    // Find or create user
    let user = store.users.find((u) => u.email.toLowerCase() === email.toLowerCase())

    if (!user) {
      // Create new user
      const userId = crypto.randomBytes(16).toString("hex")
      user = {
        userId,
        email,
        name,
        picture,
        googleId: token.substring(0, 20), // Mock Google ID
        createdAt: new Date().toISOString(),
        points: 0,
        orders: [],
      }

      // Save user
      store.users.push(user)
      saveData("users", store.users)
    }

    // Create session token
    const sessionToken = crypto.randomBytes(32).toString("hex")
    store.sessions[sessionToken] = {
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        points: user.points,
      },
      createdAt: Date.now(),
    }

    // Return user data and token
    return res.json({
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        picture: user.picture,
        points: user.points,
      },
      token: sessionToken,
    })
  } catch (error) {
    console.error("Error with Google sign-in:", error)
    return res.status(500).json({ error: "Failed to authenticate with Google" })
  }
})

// Logout
app.post("/api/auth/logout", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]

  if (token && store.sessions[token]) {
    delete store.sessions[token]
  }

  return res.json({ success: true })
})

// Get user profile
app.get("/api/user", authenticate, (req, res) => {
  return res.json(req.user)
})

// Update user profile
app.put("/api/user", authenticate, (req, res) => {
  try {
    const { name, address, city, postcode, phone } = req.body

    // Find user
    const userIndex = store.users.findIndex((u) => u.userId === req.user.userId)
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" })
    }

    // Update user
    if (name) store.users[userIndex].name = name
    if (address) store.users[userIndex].address = address
    if (city) store.users[userIndex].city = city
    if (postcode) store.users[userIndex].postcode = postcode
    if (phone) store.users[userIndex].phone = phone

    // Save changes
    saveData("users", store.users)

    // Update session
    const token = req.headers.authorization?.split(" ")[1]
    if (token && store.sessions[token]) {
      store.sessions[token].user = {
        userId: store.users[userIndex].userId,
        email: store.users[userIndex].email,
        name: store.users[userIndex].name,
        points: store.users[userIndex].points,
        picture: store.users[userIndex].picture,
      }
    }

    return res.json({
      userId: store.users[userIndex].userId,
      email: store.users[userIndex].email,
      name: store.users[userIndex].name,
      address: store.users[userIndex].address,
      city: store.users[userIndex].city,
      postcode: store.users[userIndex].postcode,
      phone: store.users[userIndex].phone,
      points: store.users[userIndex].points,
      picture: store.users[userIndex].picture,
    })
  } catch (error) {
    console.error("Error updating user:", error)
    return res.status(500).json({ error: "Failed to update user" })
  }
})

// PAYMENT AND ORDER ENDPOINTS

// Create payment intent
app.post("/api/create-payment-intent", async (req, res) => {
  console.log("Payment intent request received", req.body)

  try {
    // Extract and validate amount
    const { amount } = req.body

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" })
    }

    const numericAmount = Number.parseFloat(amount)

    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" })
    }

    // Convert amount to pennies
    const amountInPennies = Math.round(numericAmount * 100)
    console.log(`Creating payment intent for ${amountInPennies} pennies (£${numericAmount.toFixed(2)})`)

    // Create payment intent with minimal parameters
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPennies,
      currency: "gbp",
      automatic_payment_methods: {
        enabled: true,
      },
    })

    console.log("Payment intent created:", paymentIntent.id)

    // Return client secret
    return res.json({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
    })
  } catch (error) {
    console.error("Error creating payment intent:", error)
    return res.status(500).json({
      error: "Failed to create payment intent",
    })
  }
})

// Create order
app.post("/api/orders", (req, res) => {
  console.log("Create order request received")

  try {
    const {
      items,
      total,
      shipping,
      discount,
      paymentMethod,
      customerEmail,
      customerName,
      customerAddress,
      customerCity,
      customerPostcode,
      customerPhone,
      paymentId,
    } = req.body

    // Basic validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items are required" })
    }

    // Generate order ID
    const orderId = `ORD-${Date.now().toString().slice(-6)}`

    // Create order object
    const order = {
      orderId,
      userId: req.user?.userId || "guest",
      items,
      total: Number.parseFloat(total) || 0,
      shipping: Number.parseFloat(shipping) || 0,
      discount: Number.parseFloat(discount) || 0,
      status: paymentId ? "paid" : "pending",
      createdAt: new Date().toISOString(),
      paymentMethod,
      customerEmail,
      customerName,
      customerAddress,
      customerCity,
      customerPostcode,
      customerPhone,
      paymentId,
    }

    // Save order
    store.orders.push(order)
    saveData("orders", store.orders)

    // If user is authenticated, add order to user's orders
    if (req.user) {
      const userIndex = store.users.findIndex((u) => u.userId === req.user.userId)
      if (userIndex !== -1) {
        // Add order to user's orders
        store.users[userIndex].orders.push(orderId)

        // Add points (1 point per £1 spent)
        const pointsEarned = Math.floor(Number.parseFloat(total) || 0)
        store.users[userIndex].points += pointsEarned

        // Save changes
        saveData("users", store.users)

        // Update session
        const token = req.headers.authorization?.split(" ")[1]
        if (token && store.sessions[token]) {
          store.sessions[token].user.points = store.users[userIndex].points
        }
      }
    }

    console.log(`Order created: ${orderId}`)

    // Return success response
    return res.json({
      success: true,
      order: {
        orderId,
        status: order.status,
      },
    })
  } catch (error) {
    console.error("Error creating order:", error)
    return res.status(500).json({
      error: "Failed to create order",
    })
  }
})

// Get order by ID
app.get("/api/orders/:orderId", (req, res) => {
  try {
    const { orderId } = req.params

    // Find order
    const order = store.orders.find((o) => o.orderId === orderId)

    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }

    // Check if user is authorized to view this order
    if (req.user && order.userId !== "guest" && order.userId !== req.user.userId) {
      return res.status(403).json({ error: "Not authorized to view this order" })
    }

    return res.json(order)
  } catch (error) {
    console.error("Error fetching order:", error)
    return res.status(500).json({
      error: "Failed to fetch order",
    })
  }
})

// Get user orders
app.get("/api/orders", authenticate, (req, res) => {
  try {
    // Find user's orders
    const userOrders = store.orders.filter((o) => o.userId === req.user.userId)
    return res.json(userOrders)
  } catch (error) {
    console.error("Error fetching user orders:", error)
    return res.status(500).json({
      error: "Failed to fetch orders",
    })
  }
})

// Apply coupon
app.post("/api/apply-coupon", (req, res) => {
  try {
    const { code } = req.body

    const validCoupons = {
      WELCOME10: { discount: 0.1, type: "percentage", description: "10% off your order" },
      MELTS5: { discount: 0.05, type: "percentage", description: "5% off your order" },
      SOAP20: { discount: 0.2, type: "percentage", description: "20% off your order" },
      FREESHIP: { discount: 5.99, type: "fixed", description: "Free shipping" },
      SUMMER15: { discount: 0.15, type: "percentage", description: "15% summer discount" },
    }

    if (!code || !validCoupons[code.toUpperCase()]) {
      return res.status(400).json({ error: "Invalid coupon code" })
    }

    const coupon = validCoupons[code.toUpperCase()]

    return res.json({
      success: true,
      coupon: {
        code: code.toUpperCase(),
        ...coupon,
      },
    })
  } catch (error) {
    console.error("Error applying coupon:", error)
    return res.status(500).json({
      error: "Failed to apply coupon",
    })
  }
})

// Use loyalty points
app.post("/api/use-points", authenticate, (req, res) => {
  try {
    const { points } = req.body

    if (!points || isNaN(Number.parseInt(points)) || Number.parseInt(points) <= 0) {
      return res.status(400).json({ error: "Valid points amount is required" })
    }

    const pointsToUse = Number.parseInt(points)

    // Find user
    const userIndex = store.users.findIndex((u) => u.userId === req.user.userId)
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" })
    }

    // Check if user has enough points
    if (store.users[userIndex].points < pointsToUse) {
      return res.status(400).json({ error: "Not enough points" })
    }

    // Deduct points
    store.users[userIndex].points -= pointsToUse

    // Save changes
    saveData("users", store.users)

    // Update session
    const token = req.headers.authorization?.split(" ")[1]
    if (token && store.sessions[token]) {
      store.sessions[token].user.points = store.users[userIndex].points
    }

    return res.json({
      success: true,
      points: store.users[userIndex].points,
      pointsUsed: pointsToUse,
      discount: pointsToUse * 0.01, // Each point is worth £0.01
    })
  } catch (error) {
    console.error("Error using points:", error)
    return res.status(500).json({
      error: "Failed to use points",
    })
  }
})

// NEWSLETTER AND CONTACT ENDPOINTS

// Subscribe to newsletter
app.post("/api/subscribe", (req, res) => {
  try {
    const { email, name } = req.body

    if (!email) {
      return res.status(400).json({ error: "Email is required" })
    }

    console.log(`Newsletter subscription: ${name || "Unknown"} (${email})`)

    return res.json({ success: true })
  } catch (error) {
    console.error("Error subscribing to newsletter:", error)
    return res.status(500).json({
      error: "Failed to subscribe to newsletter",
    })
  }
})

// Contact form
app.post("/api/contact", (req, res) => {
  try {
    const { name, email, message } = req.body

    if (!email || !message) {
      return res.status(400).json({ error: "Email and message are required" })
    }

    console.log(`Contact form submission: ${name || "Unknown"} (${email})`)
    console.log(`Message: ${message}`)

    return res.json({ success: true })
  } catch (error) {
    console.error("Error submitting contact form:", error)
    return res.status(500).json({
      error: "Failed to submit contact form",
    })
  }
})

// Workshop request
app.post("/api/workshop-request", (req, res) => {
  try {
    const { name, email, date, participants } = req.body

    if (!email || !date) {
      return res.status(400).json({ error: "Email and date are required" })
    }

    console.log(`Workshop request: ${name || "Unknown"} (${email})`)
    console.log(`Date: ${date}, Participants: ${participants || 1}`)

    return res.json({ success: true })
  } catch (error) {
    console.error("Error submitting workshop request:", error)
    return res.status(500).json({
      error: "Failed to submit workshop request",
    })
  }
})

// Catch-all route for static files
app.get("*", (req, res) => {
  const filePath = path.join(__dirname, "public", req.path === "/" ? "index.html" : req.path)

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.sendFile(filePath)
  } else {
    // Fall back to index.html
    res.sendFile(path.join(__dirname, "public", "index.html"))
  }
})

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

// Error handling for the server
server.on("error", (error) => {
  console.error("Server error:", error.message)
})

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason)
})

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error.message)
  console.error(error.stack)
})

module.exports = app
