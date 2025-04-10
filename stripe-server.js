// Stripe Checkout Server for Melissa's Melts
require("dotenv").config()
const express = require("express")
const stripe = require("stripe")(
  process.env.STRIPE_SECRET_KEY ||
    "sk_test_51RC5BvH1VVhTMbD6JEwbrZZpAABwWiFl7hw4lFjt4SdtfqOKKLre0d1A4XtN334RHOQhTv8ZCW19Eenftw4cl5xm00lIjO5S9P",
)
const nodemailer = require("nodemailer")
const bodyParser = require("body-parser")
const cors = require("cors")

const app = express()
const PORT = process.env.PORT || 4242

// Middleware
app.use(cors())
app.use(express.static("public"))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Configure email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "your-email@gmail.com", // Your Gmail address
    pass: process.env.EMAIL_PASS || "your-app-password", // Your Gmail app password
  },
})

// Create a Checkout Session
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { cartItems } = req.body

    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: "Cart is empty" })
    }

    // Format line items for Stripe
    const lineItems = cartItems.map((item) => ({
      price_data: {
        currency: "gbp",
        product_data: {
          name: item.name,
          description: item.scent ? `Scent: ${item.scent}` : undefined,
          images: item.image ? [item.image] : undefined,
        },
        unit_amount: Math.round(item.price * 100), // Convert to pennies
      },
      quantity: item.quantity,
    }))

    // Add shipping options
    const shippingOptions = [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: 399, // £3.99
            currency: "gbp",
          },
          display_name: "Standard Shipping",
          delivery_estimate: {
            minimum: {
              unit: "business_day",
              value: 3,
            },
            maximum: {
              unit: "business_day",
              value: 5,
            },
          },
        },
      },
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: 799, // £7.99
            currency: "gbp",
          },
          display_name: "Express Shipping",
          delivery_estimate: {
            minimum: {
              unit: "business_day",
              value: 1,
            },
            maximum: {
              unit: "business_day",
              value: 2,
            },
          },
        },
      },
    ]

    // Create the checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      shipping_options: shippingOptions,
      shipping_address_collection: {
        allowed_countries: ["GB"],
      },
      mode: "payment",
      success_url: `${req.headers.origin}/order-confirmation.html?session_id={CHECKOUT_SESSION.ID}`,
      cancel_url: `${req.headers.origin}/cart.html`,
      automatic_tax: { enabled: true },
      metadata: {
        order_id: "ORD-" + Date.now().toString().slice(-6),
      },
    })

    res.json({ url: session.url })
  } catch (error) {
    console.error("Error creating checkout session:", error)
    res.status(500).json({ error: error.message })
  }
})

// Webhook endpoint to handle Stripe events
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"]
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  // Handle the checkout.session.completed event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object

    try {
      // Retrieve the complete session with line items
      const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ["line_items", "customer", "shipping_details"],
      })

      // Send email notification
      await sendOrderConfirmationEmail(expandedSession)

      // Store order in your database if needed
      // saveOrderToDatabase(expandedSession);
    } catch (error) {
      console.error("Error processing order:", error)
    }
  }

  res.json({ received: true })
})

// Function to send order confirmation email
async function sendOrderConfirmationEmail(session) {
  const items = session.line_items.data
  const customer = session.customer_details
  const shipping = session.shipping_details
  const orderId = session.metadata.order_id

  // Format items for email
  const itemsList = items
    .map((item) => `${item.quantity}x ${item.description} - £${(item.amount_total / 100).toFixed(2)}`)
    .join("\n")

  // Format shipping address
  const shippingAddress = shipping
    ? `${shipping.name}\n${shipping.address.line1}\n${shipping.address.city}\n${shipping.address.postal_code}\n${shipping.address.country}`
    : "No shipping address provided"

  // Email to store owner
  const storeEmail = {
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER, // Send to yourself
    subject: `New Order #${orderId}`,
    text: `
      New order received!
      
      Order ID: ${orderId}
      Date: ${new Date().toLocaleString()}
      
      Customer:
      Name: ${customer.name}
      Email: ${customer.email}
      
      Shipping Address:
      ${shippingAddress}
      
      Items:
      ${itemsList}
      
      Subtotal: £${((session.amount_subtotal || 0) / 100).toFixed(2)}
      Shipping: £${((session.amount_total - session.amount_subtotal || 0) / 100).toFixed(2)}
      Total: £${((session.amount_total || 0) / 100).toFixed(2)}
      
      Payment Status: ${session.payment_status}
    `,
    html: `
      <h2>New order received!</h2>
      
      <p><strong>Order ID:</strong> ${orderId}<br>
      <strong>Date:</strong> ${new Date().toLocaleString()}</p>
      
      <h3>Customer:</h3>
      <p>
        <strong>Name:</strong> ${customer.name}<br>
        <strong>Email:</strong> ${customer.email}
      </p>
      
      <h3>Shipping Address:</h3>
      <p>${shippingAddress.replace(/\n/g, "<br>")}</p>
      
      <h3>Items:</h3>
      <ul>
        ${items
          .map((item) => `<li>${item.quantity}x ${item.description} - £${(item.amount_total / 100).toFixed(2)}</li>`)
          .join("")}
      </ul>
      
      <p>
        <strong>Subtotal:</strong> £${((session.amount_subtotal || 0) / 100).toFixed(2)}<br>
        <strong>Shipping:</strong> £${((session.amount_total - session.amount_subtotal || 0) / 100).toFixed(2)}<br>
        <strong>Total:</strong> £${((session.amount_total || 0) / 100).toFixed(2)}
      </p>
      
      <p><strong>Payment Status:</strong> ${session.payment_status}</p>
    `,
  }

  // Email to customer
  const customerEmail = {
    from: process.env.EMAIL_USER,
    to: customer.email,
    subject: `Your Order Confirmation #${orderId} - Melissa's Melts`,
    text: `
      Thank you for your order!
      
      Order ID: ${orderId}
      Date: ${new Date().toLocaleString()}
      
      Items:
      ${itemsList}
      
      Subtotal: £${((session.amount_subtotal || 0) / 100).toFixed(2)}
      Shipping: £${((session.amount_total - session.amount_subtotal || 0) / 100).toFixed(2)}
      Total: £${((session.amount_total || 0) / 100).toFixed(2)}
      
      Shipping Address:
      ${shippingAddress}
      
      We'll process your order as soon as possible. If you have any questions, please contact us.
      
      Thank you for shopping with Melissa's Melts!
    `,
    html: `
      <h2>Thank you for your order!</h2>
      
      <p><strong>Order ID:</strong> ${orderId}<br>
      <strong>Date:</strong> ${new Date().toLocaleString()}</p>
      
      <h3>Items:</h3>
      <ul>
        ${items
          .map((item) => `<li>${item.quantity}x ${item.description} - £${(item.amount_total / 100).toFixed(2)}</li>`)
          .join("")}
      </ul>
      
      <p>
        <strong>Subtotal:</strong> £${((session.amount_subtotal || 0) / 100).toFixed(2)}<br>
        <strong>Shipping:</strong> £${((session.amount_total - session.amount_subtotal || 0) / 100).toFixed(2)}<br>
        <strong>Total:</strong> £${((session.amount_total || 0) / 100).toFixed(2)}
      </p>
      
      <h3>Shipping Address:</h3>
      <p>${shippingAddress.replace(/\n/g, "<br>")}</p>
      
      <p>We'll process your order as soon as possible. If you have any questions, please contact us.</p>
      
      <p>Thank you for shopping with Melissa's Melts!</p>
    `,
  }

  // Send emails
  try {
    await transporter.sendMail(storeEmail)
    console.log(`Store notification email sent for order ${orderId}`)

    await transporter.sendMail(customerEmail)
    console.log(`Customer confirmation email sent for order ${orderId}`)
  } catch (error) {
    console.error("Error sending email:", error)
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Visit http://localhost:${PORT} to view the app`)
})
