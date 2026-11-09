const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");

// Routes
const authRoutes = require("./routes/authRoutes");
const hotelRoutes = require("./routes/hotelRoutes");
const roomRoutes = require("./routes/roomRoutes");
const reservationRoutes = require("./routes/reservationRoutes");
const stayRoutes = require("./routes/stayRoutes");
const housekeepingRoutes = require("./routes/housekeepingRoutes");
const staffRoutes = require("./routes/staffRoutes");
const maintenanceRoutes = require("./routes/maintenanceRoutes");
const guestRoutes = require("./routes/guestRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const billingRoutes = require("./routes/billingRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const publicRoutes = require("./routes/publicRoutes");
const reportRoutes = require("./routes/reportRoutes");

const app = express();

const PORT = Number(process.env.PORT) || 5000;
const HOST = "127.0.0.1";
const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

app.disable("x-powered-by");

// Allow the frontend to send authenticated requests.
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

// Parse JSON and form requests.
// Hotel image uploads use their own parser inside hotelRoutes.
app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: false,
    limit: "1mb",
  })
);

app.use(cookieParser());

// Basic server check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "LuxuryStay backend is running!",
  });
});

// Database connection check
app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    success: connected,
    server: "LuxuryStay API",
    database: connected ? "Connected" : "Disconnected",
  });
});

// Authentication
app.use("/api/auth", authRoutes);

// Property management
app.use("/api/hotels", hotelRoutes);
app.use("/api/rooms", roomRoutes);

// Reservations and stays
app.use("/api/reservations", reservationRoutes);
app.use("/api/stays", stayRoutes);

// Hotel operations
app.use("/api/housekeeping", housekeepingRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/maintenance", maintenanceRoutes);

// Guest management and services
app.use("/api/guests", guestRoutes);
app.use("/api/services", serviceRoutes);

// Billing and feedback
app.use("/api/billing", billingRoutes);
app.use("/api/feedback", feedbackRoutes);

// Notifications
app.use("/api/notifications", notificationRoutes);

// Reports and analytics
// GET /api/reports/summary
app.use("/api/reports", reportRoutes);

// Public website and authenticated guest bookings
app.use("/api/public", publicRoutes);

// SettingsManagement uses the existing hotel API:
// GET   /api/hotels
// GET   /api/hotels/:id
// PATCH /api/hotels/:id

// Unknown routes — this must stay below every API route.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err.message);

  if (res.headersSent) {
    return next(err);
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "The request contains invalid JSON.",
    });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "The request exceeds the allowed size.",
    });
  }

  const status =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status <= 599
      ? err.status
      : 500;

  return res.status(status).json({
    success: false,
    message:
      status >= 500
        ? "Something went wrong on the server."
        : err.message || "The request could not be completed.",
  });
});

async function startServer() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from backend/.env");
    }

    if (
      !Number.isInteger(PORT) ||
      PORT < 1 ||
      PORT > 65535
    ) {
      throw new Error("PORT must be a whole number between 1 and 65535.");
    }

    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });

    console.log("MongoDB connected successfully.");

    const server = app.listen(PORT, HOST);

    server.on("listening", () => {
      console.log(`LuxuryStay backend: http://localhost:${PORT}`);
      console.log("Reports API: /api/reports/summary");
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `Port ${PORT} is already in use. Stop the previous backend process, then start this server again.`
        );
      } else {
        console.error("Server could not start:", error.message);
      }

      process.exit(1);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();