const express = require("express");
const crypto = require("crypto");

const Reservation = require("../models/Reservation");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
const DAY = 86400000;

const statuses = [
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
];

// Detect an incorrect model export when the server starts.
if (
  typeof Reservation.find !== "function" ||
  !Reservation.schema
) {
  throw new Error(
    "models/Reservation.js must export the Reservation Mongoose model."
  );
}

// Currently these endpoints are available to admins.
router.use(protect);
router.use(authorize("admin"));

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    if (
      req.headers.origin &&
      req.headers.origin !== allowedOrigin
    ) {
      return res.status(403).json({
        success: false,
        message: "Request origin is not allowed.",
      });
    }

    if (!req.is("application/json")) {
      return res.status(415).json({
        success: false,
        message: "Please send application/json.",
      });
    }
  }

  next();
});

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validId(value) {
  return (
    typeof value === "string" &&
    /^[a-f\d]{24}$/i.test(value)
  );
}

function checkBody(body, allowedFields) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    fail("Please provide a valid request body.");
  }

  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fail(`Field "${key}" is not allowed.`);
    }
  }
}

function readText(value, label, maximum, minimum = 0) {
  if (value === undefined && minimum === 0) {
    return "";
  }

  if (typeof value !== "string") {
    fail(`${label} must be text.`);
  }

  const text = value.trim();

  if (text.length < minimum || text.length > maximum) {
    fail(
      `${label} must contain ${minimum}–${maximum} characters.`
    );
  }

  return text;
}

function parseDate(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    fail(`${label} must use YYYY-MM-DD format.`);
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);

  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    fail(`${label} is invalid.`);
  }

  return timestamp;
}

function hotelToday(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function pageNumber(value, fallback, maximum) {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    fail("Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    fail("Pagination value is too large.");
  }

  return number;
}

// Booking creation requires the room/night unique index.
let indexesReady;

async function ensureIndexes() {
  if (!Reservation.schema.path("reservedNights")) {
    fail(
      "Reservation model needs the reservedNights field.",
      503
    );
  }

  const hasBookingIndex = Reservation.schema.indexes().some(
    ([fields, options]) =>
      fields.room === 1 &&
      fields.reservedNights === 1 &&
      options.unique === true
  );

  if (!hasBookingIndex) {
    fail(
      "Reservation model needs the room/night unique index.",
      503
    );
  }

  if (!indexesReady) {
    indexesReady = Reservation.createIndexes().catch((error) => {
      indexesReady = undefined;
      throw error;
    });
  }

  await indexesReady;
}

router.param("id", (req, res, next, id) => {
  if (!validId(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid reservation ID.",
    });
  }

  next();
});

// GET /api/reservations
router.get("/", async (req, res, next) => {
  try {
    const page = pageNumber(req.query.page, 1, 10000);
    const limit = pageNumber(req.query.limit, 20, 100);
    const filter = {};

    if (req.query.hotel !== undefined) {
      if (!validId(req.query.hotel)) {
        fail("Invalid hotel ID.");
      }

      filter.hotel = req.query.hotel;
    }

    if (req.query.status !== undefined) {
      if (!statuses.includes(req.query.status)) {
        fail("Invalid reservation status.");
      }

      filter.status = req.query.status;
    }

    const [reservations, total] = await Promise.all([
      Reservation.find(filter)
        .populate("hotel", "name code city")
        .populate("room", "roomNumber roomType")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Reservation.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      reservations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reservations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const reservation = await Reservation.findById(req.params.id)
      .populate("hotel", "name code city")
      .populate("room", "roomNumber roomType")
      .lean();

    if (!reservation) {
      fail("Reservation not found.", 404);
    }

    return res.json({
      success: true,
      reservation,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/reservations
router.post("/", async (req, res, next) => {
  try {
    checkBody(req.body, [
      "hotel",
      "room",
      "guestName",
      "guestEmail",
      "guestPhone",
      "numberOfGuests",
      "checkInDate",
      "checkOutDate",
      "specialRequests",
    ]);

    const body = req.body;

    if (!validId(body.hotel) || !validId(body.room)) {
      fail("Please select a valid hotel and room.");
    }

    const guestName = readText(
      body.guestName,
      "Guest name",
      100,
      2
    );

    const guestPhone = readText(
      body.guestPhone,
      "Guest phone",
      25,
      1
    );

    const guestEmail = readText(
      body.guestEmail,
      "Guest email",
      254
    ).toLowerCase();

    const specialRequests = readText(
      body.specialRequests,
      "Special requests",
      2000
    );

    if (
      guestEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)
    ) {
      fail("Please enter a valid guest email.");
    }

    if (
      !Number.isInteger(body.numberOfGuests) ||
      body.numberOfGuests < 1 ||
      body.numberOfGuests > 20
    ) {
      fail("Guest count must be a whole number between 1 and 20.");
    }

    const start = parseDate(body.checkInDate, "Check-in date");
    const end = parseDate(body.checkOutDate, "Check-out date");
    const nights = (end - start) / DAY;

    if (
      !Number.isInteger(nights) ||
      nights < 1 ||
      nights > 365
    ) {
      fail("The stay must be between 1 and 365 nights.");
    }

    const [hotel, room] = await Promise.all([
      Hotel.findById(body.hotel).lean(),

      Room.findOne({
        _id: body.room,
        hotel: body.hotel,
      }).lean(),
    ]);

    if (!hotel) {
      fail("Hotel not found.", 404);
    }

    if (!room) {
      fail("Room not found in this hotel.", 404);
    }

    if (!hotel.isActive || !room.isActive) {
      fail("The selected hotel or room is inactive.", 409);
    }

    if (room.status === "maintenance") {
      fail("This room is currently under maintenance.", 409);
    }

    if (body.checkInDate < hotelToday(hotel.timezone)) {
      fail("Check-in date cannot be in the past.");
    }

    if (body.numberOfGuests > room.capacity) {
      fail(
        `This room allows a maximum of ${room.capacity} guests.`
      );
    }

    const taxRateBps = Math.round(hotel.taxRate * 100);

    if (
      !Number.isSafeInteger(room.pricePerNightMinor) ||
      room.pricePerNightMinor < 0 ||
      !Number.isInteger(taxRateBps) ||
      taxRateBps < 0 ||
      taxRateBps > 10000
    ) {
      fail(
        "Room pricing or hotel tax configuration is invalid.",
        409
      );
    }

    // Money calculations use integer minor units.
    const subtotal =
      BigInt(room.pricePerNightMinor) * BigInt(nights);

    const tax =
      (subtotal * BigInt(taxRateBps) + 5000n) / 10000n;

    const total = subtotal + tax;

    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail("The booking amount is too large.");
    }

    await ensureIndexes();

    // Also detect older bookings without reservedNights.
    const overlapping = await Reservation.exists({
      room: room._id,
      status: {
        $in: ["confirmed", "checked_in", "checked_out"],
      },
      checkInDate: { $lt: body.checkOutDate },
      checkOutDate: { $gt: body.checkInDate },
    });

    if (overlapping) {
      fail(
        "This room is already booked for the selected dates.",
        409
      );
    }

    // The model's unique index rejects concurrent overlaps.
    const reservation = await Reservation.create({
      bookingReference:
        `LS-${crypto.randomBytes(10).toString("hex").toUpperCase()}`,
      hotel: hotel._id,
      room: room._id,
      guestName,
      guestEmail,
      guestPhone,
      numberOfGuests: body.numberOfGuests,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      nights,
      currency: hotel.currency,
      pricePerNightMinor: room.pricePerNightMinor,
      subtotalMinor: Number(subtotal),
      taxRateBps,
      taxAmountMinor: Number(tax),
      totalMinor: Number(total),
      specialRequests,
      status: "confirmed",
      createdBy: req.user._id,
    });

    await reservation.populate([
      {
        path: "hotel",
        select: "name code city",
      },
      {
        path: "room",
        select: "roomNumber roomType",
      },
    ]);

    const result = reservation.toObject();
    delete result.reservedNights;

    return res.status(201).json({
      success: true,
      message: "Reservation created successfully.",
      reservation: result,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/reservations/:id/cancel
router.patch("/:id/cancel", async (req, res, next) => {
  try {
    checkBody(req.body, ["reason"]);

    const reason = readText(
      req.body.reason,
      "Cancellation reason",
      500
    );

    // Cancel and release the reserved nights together.
    const reservation = await Reservation.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "confirmed",
      },
      {
        $set: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancellationReason: reason,
          reservedNights: [],
        },
        $inc: { __v: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .populate("hotel", "name code city")
      .populate("room", "roomNumber roomType");

    if (!reservation) {
      const exists = await Reservation.exists({
        _id: req.params.id,
      });

      if (!exists) {
        fail("Reservation not found.", 404);
      }

      fail(
        "Only confirmed reservations can be cancelled here.",
        409
      );
    }

    return res.json({
      success: true,
      message: "Reservation cancelled successfully.",
      reservation,
    });
  } catch (error) {
    next(error);
  }
});

// Reservation-specific error handling
router.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === 11000) {
    const referenceConflict = error.keyPattern?.bookingReference;

    return res.status(409).json({
      success: false,
      message: referenceConflict
        ? "Booking reference conflict. Please try again."
        : "This room is already booked for one or more selected nights.",
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors)
        .map((item) => item.message)
        .join(" "),
    });
  }

  if (error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "An invalid field value was provided.",
    });
  }

  next(error);
});

module.exports = router;