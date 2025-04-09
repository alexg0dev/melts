// Express server setup
const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const path = require("path")
const fs = require("fs")
const stripe = require("stripe")(
  "sk_test_51RC5BvH1VVhTMbD6JEwbrZZpAABwWiFl7hw4lFjt4SdtfqOKKLre0d1A4XtN334RHOQhTv8ZCW19Eenftw4cl5xm00lIjO5S9P",
)
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

// CORS configuration - Allow all origins for development
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
)

// Body parser middleware - Important to parse JSON before routes
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Special handling for Stripe webhook
app.use("/webhook", express.raw({ type: "application/json" }))

// Serve static files
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

// Enhanced helper function to send email
function sendEmail(to, { subject, body }) {
  // In a real application, you would use a service like SendGrid, Mailgun, etc.
  console.log(`Sending email to ${to}`)
  console.log(`Subject: ${subject}`)
  console.log(`Body: ${body}`)

  // For this example, we'll just log the email content
  console.log("Email would be sent with the following content:")
  console.log("To:", to)
  console.log("Subject:", subject)
  console.log("Body:", body)

  // Send email to alexandroghanem@gmail.com for all order notifications
  if (to !== "alexandroghanem@gmail.com" && subject.includes("Order")) {
    console.log("Forwarding order notification to alexandroghanem@gmail.com")
    console.log("Subject: Order Notification - " + subject)
    console.log("Body: " + body)
  }
}

// Modify the existing sendOrderEmail function to use the enhanced sendEmail function
function sendOrderEmail(email, order) {
  // Create email content for customer
  const customerEmailContent = `
    Thank you for your order!
    
    Order ID: ${order.orderId}
    Date: ${new Date(order.createdAt).toLocaleString()}
    
    Items:
    ${order.items.map((item) => `- ${item.name} (${item.quantity}) - £${item.price.toFixed(2)}`).join("\n")}
    
    Subtotal: £${order.items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2)}
    Shipping: £${order.shipping.toFixed(2)}
    ${order.discount ? `Discount: -£${order.discount.toFixed(2)}` : ""}
    Total: £${order.total.toFixed(2)}
    
    Your order is being processed and will be shipped soon.
    
    If there are any issues with your order, please contact: Melissa's Melts on Facebook.
    
    Thank you for shopping with Melissa's Melts!
  `

  // Create email content for owner
  const ownerEmailContent = `
    New Order Received!
    
    Order ID: ${order.orderId}
    Customer: ${order.customerName || "Unknown"} (${order.customerEmail || "Unknown"})
    Address: ${order.customerAddress || "Unknown"}, ${order.customerCity || "Unknown"}, ${order.customerPostcode || "Unknown"}
    Phone: ${order.customerPhone || "Unknown"}
    Date: ${new Date(order.createdAt).toLocaleString()}
    
    Items:
    ${order.items.map((item) => `- ${item.name} (${item.quantity}) - £${item.price.toFixed(2)}`).join("\n")}
    
    Subtotal: £${order.items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2)}
    Shipping: £${order.shipping.toFixed(2)}
    ${order.discount ? `Discount: -£${order.discount.toFixed(2)}` : ""}
    Total: £${order.total.toFixed(2)}
    
    Payment Method: ${order.paymentMethod ? `${order.paymentMethod.type.toUpperCase()} (ending in ${order.paymentMethod.lastFour})` : "Unknown"}
    Payment Status: ${order.status === "paid" ? "PAID" : "PENDING"}
    
    Please process this order as soon as possible.
  `

  // Send email to customer
  sendEmail(email, {
    subject: `Order Confirmation #${order.orderId}`,
    body: customerEmailContent,
  })

  // Send email to owner
  sendEmail("alexandroghanem@gmail.com", {
    subject: `New Order #${order.orderId}`,
    body: ownerEmailContent,
  })
}

// API Routes

// STRIPE PAYMENT ROUTES - Placing this first to ensure it's not caught by other middleware

// Create a payment intent
app.post("/api/create-payment-intent", async (req, res) => {
  try {
    console.log("Creating payment intent with data:", req.body)
    const { amount, currency = "gbp", customer_email, metadata = {} } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount is required" })
    }

    // Add the notification email to metadata if not already present
    if (!metadata.notificationEmail) {
      metadata.notificationEmail = "alexandroghanem1@gmail.com"
    }

    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents/pence
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      receipt_email: customer_email,
      metadata,
    })

    console.log("Payment intent created successfully:", paymentIntent.id)

    // Send the client secret to the client
    res.json({
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
    })
  } catch (error) {
    console.error("Error creating payment intent:", error)
    res.status(500).json({ error: error.message || "Failed to create payment intent" })
  }
})

// Webhook to handle Stripe events
app.post("/webhook", async (req, res) => {
  let event

  try {
    // Verify the webhook signature
    const signature = req.headers["stripe-signature"]
    const endpointSecret = "whsec_your_webhook_signing_secret" // Replace with your webhook signing secret

    try {
      event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret)
    } catch (err) {
      console.error(`⚠️  Webhook signature verification failed.`, err.message)
      return res.status(400).send(`Webhook Error: ${err.message}`)
    }

    // Handle the event
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object
        console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`)
        // Update order status in your database
        await handleSuccessfulPayment(paymentIntent)
        break
      case "payment_intent.payment_failed":
        const failedPayment = event.data.object
        console.log(`Payment failed: ${failedPayment.last_payment_error?.message}`)
        break
      default:
        console.log(`Unhandled event type ${event.type}`)
    }

    // Return a 200 response to acknowledge receipt of the event
    res.send()
  } catch (error) {
    console.error("Error handling webhook:", error)
    res.status(500).send(`Webhook Error: ${error.message}`)
  }
})

// Helper function to handle successful payments
async function handleSuccessfulPayment(paymentIntent) {
  try {
    // Extract order ID from metadata
    const orderId = paymentIntent.metadata.orderId
    if (!orderId) return

    // Update order status in database
    const orders = readData(ORDERS_FILE)
    const orderIndex = orders.findIndex((o) => o.orderId === orderId)

    if (orderIndex !== -1) {
      orders[orderIndex].status = "paid"
      orders[orderIndex].paymentId = paymentIntent.id
      orders[orderIndex].paidAt = new Date().toISOString()
      writeData(ORDERS_FILE, orders)

      // Send confirmation email
      if (orders[orderIndex].customerEmail) {
        sendEmail(orders[orderIndex].customerEmail, {
          subject: `Payment Confirmed for Order #${orderId}`,
          body: `
            Dear ${orders[orderIndex].customerName || "Customer"},
            
            We're happy to confirm that your payment for order #${orderId} has been successfully processed.
            
            Your order is now being prepared for shipping.
            
            Thank you for shopping with Melissa's Melts!
          `,
        })
      }

      // Always send notification to the admin email
      sendEmail("alexandroghanem1@gmail.com", {
        subject: `New Order #${orderId} - Payment Confirmed`,
        body: `
          New Order Received!
          
          Order ID: ${orderId}
          Customer: ${orders[orderIndex].customerName || "Unknown"} (${orders[orderIndex].customerEmail || "Unknown"})
          Address: ${orders[orderIndex].customerAddress || "Unknown"}, ${orders[orderIndex].customerCity || "Unknown"}, ${orders[orderIndex].customerPostcode || "Unknown"}
          Phone: ${orders[orderIndex].customerPhone || "Unknown"}
          Date: ${new Date().toLocaleString()}
          
          Items:
          ${orders[orderIndex].items.map((item) => `- ${item.name} (${item.quantity}) - £${item.price.toFixed(2)}`).join("\n")}
          
          Subtotal: £${orders[orderIndex].items.reduce((total, item) => total + item.price * item.quantity, 0).toFixed(2)}
          Shipping: £${orders[orderIndex].shipping.toFixed(2)}
          ${orders[orderIndex].discount ? `Discount: -£${orders[orderIndex].discount.toFixed(2)}` : ""}
          Total: £${orders[orderIndex].total.toFixed(2)}
          
          Payment Method: ${orders[orderIndex].paymentMethod ? `${orders[orderIndex].paymentMethod.type.toUpperCase()} (ending in ${orders[orderIndex].paymentMethod.lastFour})` : "Unknown"}
          
          Please process this order as soon as possible.
        `,
      })
    }
  } catch (error) {
    console.error("Error handling successful payment:", error)
  }
}

// Get order by ID
app.get("/api/orders/:orderId", (req, res) => {
  try {
    const { orderId } = req.params
    const orders = readData(ORDERS_FILE)
    const order = orders.find((o) => o.orderId === orderId)

    if (!order) {
      return res.status(404).json({ error: "Order not found" })
    }

    res.json(order)
  } catch (error) {
    console.error("Error fetching order:", error)
    res.status(500).json({ error: "Failed to fetch order" })
  }
})

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
app.post("/api/orders", (req, res) => {
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
      orderId,
    } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items are required" })
    }

    if (typeof total !== "number" || total <= 0) {
      return res.status(400).json({ error: "Valid total is required" })
    }

    // Create new order
    const orders = readData(ORDERS_FILE)

    // Generate order ID if not provided
    const newOrderId = orderId || Date.now().toString()

    const order = {
      orderId: newOrderId,
      userId: req.user?.userId || "guest",
      items,
      total,
      shipping,
      discount,
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

    orders.push(order)
    writeData(ORDERS_FILE, orders)

    // If user is authenticated, add points and update user record
    if (req.user) {
      const users = readData(USERS_FILE)
      const userIndex = users.findIndex((u) => u.userId === req.user.userId)

      if (userIndex !== -1) {
        // Add points to user (1 point for each $1 spent)
        const pointsEarned = Math.floor(total)
        users[userIndex].points += pointsEarned
        users[userIndex].orders.push(newOrderId)
        writeData(USERS_FILE, users)
      }
    }

    // Send email notification
    sendOrderEmail(customerEmail, order)

    res.json({
      success: true,
      order: {
        orderId: newOrderId,
        status: order.status,
      },
    })
  } catch (error) {
    console.error("Error creating order:", error)
    res.status(500).json({ error: "Failed to create order" })
  }
})

// Get user orders
app.get("/api/orders", authenticate, (req, res) => {
  const orders = readData(ORDERS_FILE)
  const userOrders = orders.filter((order) => order.userId === req.user.userId)

  res.json(userOrders)
})

// Subscribe to newsletter
app.post("/api/subscribe", (req, res) => {
  const { name, email, consent } = req.body

  if (!email) {
    return res.status(400).json({ error: "Email is required" })
  }

  // In a real application, you would store this in a database
  console.log(`New newsletter subscription: ${name} (${email}), consent: ${consent}`)

  // Send confirmation email
  sendEmail(email, {
    subject: "Welcome to Melissa's Melts Newsletter!",
    body: `
      Hi ${name},

      Thank you for subscribing to our newsletter! You'll now receive updates on new products, special offers, and skincare tips.

      If you have any questions, feel free to reply to this email.

      Best regards,
      The Melissa's Melts Team
    `,
  })

  // Also send notification to admin
  sendEmail("alexandroghanem@gmail.com", {
    subject: "New Newsletter Subscription",
    body: `
      New subscriber details:
      Name: ${name}
      Email: ${email}
      Marketing consent: ${consent ? "Yes" : "No"}
      Date: ${new Date().toLocaleString()}
    `,
  })

  res.json({ success: true })
})

// Workshop request
app.post("/api/workshop-request", (req, res) => {
  const { name, email, date, participants } = req.body

  if (!email || !date) {
    return res.status(400).json({ error: "Email and date are required" })
  }

  // In a real application, you would store this in a database
  console.log(`New workshop request: ${name} (${email}), date: ${date}, participants: ${participants}`)

  // Send confirmation email
  sendEmail(email, {
    subject: "Your Workshop Request - Melissa's Melts",
    body: `
      Hi ${name},

      Thank you for your interest in our virtual workshop! We've received your request for ${date} with ${participants} participant(s).

      We'll review your request and get back to you within 24-48 hours to confirm your booking.

      Best regards,
      The Melissa's Melts Team
    `,
  })

  // Also send notification to admin
  sendEmail("alexandroghanem@gmail.com", {
    subject: "New Workshop Request",
    body: `
      New workshop request details:
      Name: ${name}
      Email: ${email}
      Requested date: ${date}
      Number of participants: ${participants}
      Request date: ${new Date().toLocaleString()}
    `,
  })

  res.json({ success: true })
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

  // Expanded coupon validation with more coupon codes
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

  res.json({
    success: true,
    coupon: {
      code: code.toUpperCase(),
      ...coupon,
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

// Add a route handler for redirecting to the GitHub Pages site
app.get("/redirect-to-github", (req, res) => {
  res.redirect("https://alexg0dev.github.io/melts/index.html")
})

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
