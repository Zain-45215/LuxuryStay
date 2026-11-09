const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");

const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const Reservation = require("../models/Reservation");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
const DAY = 86400000;

const HOTEL_FIELDS =
  "name address city country phone email description currency timezone checkInTime checkOutTime taxRate";

const ROOM_FIELDS =
  "hotel roomType bedType numberOfBeds capacity pricePerNightMinor amenities description";

const BOOKING_FIELDS =
  "bookingReference hotel room guestName guestEmail guestPhone numberOfGuests checkInDate checkOutDate nights status currency pricePerNightMinor subtotalMinor taxRateBps taxAmountMinor totalMinor specialRequests cancelledAt cancellationReason createdAt";

const roomTypes = [
  "standard",
  "deluxe",
  "executive",
  "suite",
  "presidential",
];

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function id(value, label = "ID") {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) {
    fail(`Invalid ${label}.`);
  }
  return value;
}

function text(value, label, max, min = 0) {
  if (value === undefined && min === 0) return "";
  if (typeof value !== "string") fail(`${label} must be text.`);
  const result = value.trim();
  if (result.length < min || result.length > max) {
    fail(`${label} must contain ${min}–${max} characters.`);
  }
  return result;
}

function bodyFields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Invalid request body.");
  }
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fail(`Field "${key}" is not allowed.`);
  }
}

function integer(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("Invalid number.");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > maximum) {
    fail("Number is outside the allowed range.");
  }
  return result;
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail("Dates must use YYYY-MM-DD.");
  }
  const result = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result) ||
    new Date(result).toISOString().slice(0, 10) !== value
  ) {
    fail("Invalid date.");
  }
  return result;
}

function today(timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function stayDates(checkInDate, checkOutDate, hotel) {
  const nights = (parseDate(checkOutDate) - parseDate(checkInDate)) / DAY;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    fail("Please choose a stay between 1 and 365 nights.");
  }
  if (checkInDate < today(hotel.timezone)) {
    fail("Check-in cannot be in the past.");
  }
  return nights;
}

function quote(room, hotel, nights) {
  const rate = room.pricePerNightMinor;
  const taxRateBps = Math.round(hotel.taxRate * 100);

  if (
    !Number.isSafeInteger(rate) ||
    rate < 0 ||
    !Number.isInteger(taxRateBps) ||
    taxRateBps < 0 ||
    taxRateBps > 10000
  ) {
    fail("Room pricing is unavailable. Please contact the hotel.", 409);
  }

  const subtotal = BigInt(rate) * BigInt(nights);
  const tax = (subtotal * BigInt(taxRateBps) + 5000n) / 10000n;
  const total = subtotal + tax;

  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("Booking total is too large.");
  }

  return {
    currency: hotel.currency,
    nights,
    pricePerNightMinor: rate,
    subtotalMinor: Number(subtotal),
    taxRateBps,
    taxAmountMinor: Number(tax),
    totalMinor: Number(total),
  };
}

function overlap(room, checkInDate, checkOutDate) {
  return {
    room,
    status: { $in: ["confirmed", "checked_in", "checked_out"] },
    checkInDate: { $lt: checkOutDate },
    checkOutDate: { $gt: checkInDate },
  };
}

let indexPromise;

async function ensureIndexes() {
  if (!indexPromise) {
    indexPromise = Reservation.createIndexes().catch((error) => {
      indexPromise = undefined;
      throw error;
    });
  }
  await indexPromise;
}

async function publicBooking(bookingId, guestId) {
  return Reservation.findOne({ _id: bookingId, guest: guestId })
    .select(BOOKING_FIELDS)
    .populate("hotel", HOTEL_FIELDS)
    .populate("room", "roomType bedType capacity")
    .lean();
}

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    if (req.headers.origin && req.headers.origin !== allowedOrigin) {
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

// Public hotel catalogue, with pagination.
router.get("/hotels", wrap(async (req, res) => {
  const page = integer(req.query.page, 1, 10000);
  const limit = 12;
  const filter = { isActive: true };

  const [hotels, total] = await Promise.all([
    Hotel.find(filter)
      .select(HOTEL_FIELDS)
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Hotel.countDocuments(filter),
  ]);

  res.json({
    success: true,
    hotels,
    pagination: {
      page,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}));

// Availability for one property and selected dates.
router.get("/rooms", wrap(async (req, res) => {
  const hotelId = id(req.query.hotel, "hotel");
  const hotel = await Hotel.findOne({ _id: hotelId, isActive: true })
    .select(HOTEL_FIELDS)
    .lean();

  if (!hotel) fail("Hotel not found.", 404);

  const nights = stayDates(
    req.query.checkInDate,
    req.query.checkOutDate,
    hotel
  );

  const guests = integer(req.query.guests, 1, 20);
  const page = integer(req.query.page, 1, 10000);
  const limit = 12;

  const filter = {
    hotel: hotel._id,
    isActive: true,
    status: { $ne: "maintenance" },
    capacity: { $gte: guests },
  };

  if (req.query.roomType) {
    if (!roomTypes.includes(req.query.roomType)) fail("Invalid room type.");
    filter.roomType = req.query.roomType;
  }

  // Exclude overlaps without exposing other guests' booking data.
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: Reservation.collection.name,
        let: { selectedRoom: "$_id" },
        pipeline: [
          {
            $match: {
              status: { $in: ["confirmed", "checked_in", "checked_out"] },
              checkInDate: { $lt: req.query.checkOutDate },
              checkOutDate: { $gt: req.query.checkInDate },
              $expr: { $eq: ["$room", "$$selectedRoom"] },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "conflicts",
      },
    },
    { $match: { "conflicts.0": { $exists: false } } },
    {
      $facet: {
        rooms: [
          { $sort: { pricePerNightMinor: 1, _id: 1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $project: {
              hotel: 1,
              roomType: 1,
              bedType: 1,
              numberOfBeds: 1,
              capacity: 1,
              pricePerNightMinor: 1,
              amenities: 1,
              description: 1,
            },
          },
        ],
        count: [{ $count: "total" }],
      },
    },
  ];

  const [result] = await Room.aggregate(pipeline);
  const total = result.count[0]?.total || 0;

  res.json({
    success: true,
    hotel,
    rooms: result.rooms.map((room) => ({
      ...room,
      quote: quote(room, hotel, nights),
    })),
    pagination: {
      page,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}));

// Everything below requires a guest account.
router.use(protect, authorize("guest"));

router.get("/bookings", wrap(async (req, res) => {
  const page = integer(req.query.page, 1, 10000);
  const limit = 10;
  const filter = { guest: req.user._id };

  const [bookings, total] = await Promise.all([
    Reservation.find(filter)
      .select(BOOKING_FIELDS)
      .populate("hotel", HOTEL_FIELDS)
      .populate("room", "roomType bedType capacity")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Reservation.countDocuments(filter),
  ]);

  res.json({
    success: true,
    bookings,
    pagination: {
      page,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}));

router.post("/bookings", wrap(async (req, res) => {
  bodyFields(req.body, [
    "room",
    "checkInDate",
    "checkOutDate",
    "numberOfGuests",
    "guestPhone",
    "specialRequests",
    "expectedTotalMinor",
    "expectedCurrency",
    "requestKey",
  ]);

  const body = req.body;
  id(body.room, "room");
  parseDate(body.checkInDate);
  parseDate(body.checkOutDate);

  if (
    !Number.isInteger(body.numberOfGuests) ||
    body.numberOfGuests < 1 ||
    body.numberOfGuests > 20
  ) {
    fail("Guest count must be between 1 and 20.");
  }

  const guestPhone = text(body.guestPhone, "Phone", 25, 1);
  const specialRequests = text(body.specialRequests, "Special requests", 2000);
  const requestKey = text(body.requestKey, "Request key", 80, 16);

  if (!/^[a-zA-Z0-9-]+$/.test(requestKey)) fail("Invalid request key.");

  if (
    !Number.isSafeInteger(body.expectedTotalMinor) ||
    body.expectedTotalMinor < 0 ||
    !["PKR", "USD", "EUR", "GBP", "AED"].includes(body.expectedCurrency)
  ) {
    fail("Please search again to obtain a valid quote.");
  }

  // Same guest + same request key always resolves to the same booking.
  const bookingReference = "WEB-" + crypto
    .createHash("sha256")
    .update(`${req.user._id}:${requestKey}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();

  function verifyReplay(existing) {
    if (
      String(existing.guest) !== String(req.user._id) ||
      String(existing.room) !== body.room ||
      existing.checkInDate !== body.checkInDate ||
      existing.checkOutDate !== body.checkOutDate ||
      existing.numberOfGuests !== body.numberOfGuests ||
      existing.guestPhone !== guestPhone ||
      existing.specialRequests !== specialRequests ||
      existing.totalMinor !== body.expectedTotalMinor ||
      existing.currency !== body.expectedCurrency
    ) {
      fail("This request key belongs to a different booking.", 409);
    }
  }

  await ensureIndexes();

  let bookingId;
  let replay = false;

  try {
    await mongoose.connection.transaction(async (session) => {
      const existing = await Reservation.findOne({ bookingReference })
        .session(session);

      if (existing) {
        verifyReplay(existing);
        bookingId = existing._id;
        replay = true;
        return;
      }

      // Touch room and hotel so concurrent configuration updates conflict.
      const room = await Room.findOneAndUpdate(
        {
          _id: body.room,
          isActive: true,
          status: { $ne: "maintenance" },
          capacity: { $gte: body.numberOfGuests },
        },
        { $inc: { __v: 1 } },
        { new: true, session }
      );

      if (!room) fail("This room is no longer available for your group.", 409);

      const hotel = await Hotel.findOneAndUpdate(
        { _id: room.hotel, isActive: true },
        { $inc: { __v: 1 } },
        { new: true, session }
      );

      if (!hotel) fail("This hotel is currently unavailable.", 409);

      const nights = stayDates(body.checkInDate, body.checkOutDate, hotel);
      const price = quote(room, hotel, nights);

      if (
        price.totalMinor !== body.expectedTotalMinor ||
        price.currency !== body.expectedCurrency
      ) {
        fail("The price has changed. Search again and review the new total.", 409);
      }

      const conflict = await Reservation.exists(
        overlap(room._id, body.checkInDate, body.checkOutDate)
      ).session(session);

      if (conflict) fail("This room was booked for these dates. Search again.", 409);

      const [created] = await Reservation.create([{
        bookingReference,
        hotel: hotel._id,
        room: room._id,
        guest: req.user._id,
        guestName: req.user.name,
        guestEmail: req.user.email,
        guestPhone,
        numberOfGuests: body.numberOfGuests,
        checkInDate: body.checkInDate,
        checkOutDate: body.checkOutDate,
        ...price,
        specialRequests,
        status: "confirmed",
        createdBy: req.user._id,
      }], { session });

      bookingId = created._id;
    });
  } catch (error) {
    if (error.code !== 11000) throw error;

    const existing = await Reservation.findOne({ bookingReference });
    if (!existing) {
      fail("This room was just booked. Please search again.", 409);
    }
    verifyReplay(existing);
    bookingId = existing._id;
    replay = true;
  }

  const booking = await publicBooking(bookingId, req.user._id);

  res.status(replay ? 200 : 201).json({
    success: true,
    message: "Your reservation is confirmed. No online payment was taken.",
    booking,
  });
}));

router.patch("/bookings/:id/cancel", wrap(async (req, res) => {
  id(req.params.id, "booking");
  bodyFields(req.body, ["reason"]);
  const reason = text(req.body.reason, "Cancellation reason", 500);

  const current = await Reservation.findOne({
    _id: req.params.id,
    guest: req.user._id,
  }).populate("hotel", "timezone");

  if (!current) fail("Booking not found.", 404);

  if (current.status === "cancelled") {
    return res.json({
      success: true,
      message: "This reservation is already cancelled.",
    });
  }

  if (
    current.status !== "confirmed" ||
    !current.hotel ||
    current.checkInDate <= today(current.hotel.timezone)
  ) {
    fail("Online cancellation is available before the arrival date. Contact the hotel.", 409);
  }

  const changed = await Reservation.findOneAndUpdate(
    {
      _id: current._id,
      guest: req.user._id,
      status: "confirmed",
      __v: current.__v,
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
    { new: true, runValidators: true }
  );

  if (!changed) fail("Booking changed. Refresh your bookings and try again.", 409);

  res.json({
    success: true,
    message: "Reservation cancelled. No refund was processed by this action.",
  });
}));

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors).map((item) => item.message).join(" "),
    });
  }

  if (error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid field value.",
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "The room is no longer available for these dates.",
    });
  }

  next(error);
});

module.exports = router;