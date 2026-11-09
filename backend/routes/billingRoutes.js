const express = require("express");
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const Reservation = require("../models/Reservation");
const ServiceRequest = require("../models/ServiceRequest");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// JSON requests and allowed browser origin for write operations.
router.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  const allowedOrigin =
    process.env.CLIENT_URL || "http://localhost:5173";

  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({
      success: false,
      message: "This origin is not allowed.",
    });
  }

  if (!req.is("application/json")) {
    return res.status(415).json({
      success: false,
      message: "Send the request as application/json.",
    });
  }

  next();
});

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function readId(value, label = "ID") {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{24}$/i.test(value)
  ) {
    fail(400, `${label} is invalid.`);
  }

  return value;
}

function readText(value, label, max, required = false) {
  if (value === undefined || value === null) {
    value = "";
  }

  if (typeof value !== "string") {
    fail(400, `${label} must be text.`);
  }

  const result = value.trim();

  if (required && !result) {
    fail(400, `${label} is required.`);
  }

  if (result.length > max) {
    fail(400, `${label} cannot exceed ${max} characters.`);
  }

  return result;
}

function readBody(req, allowed) {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "A JSON object is required.");
  }

  const unknown = Object.keys(body).filter(
    (key) => !allowed.includes(key)
  );

  if (unknown.length) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  return body;
}

function readPage(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail(400, "Pagination values must be positive whole numbers.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    fail(400, "Pagination value is too large.");
  }

  return number;
}

function money(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(400, `${label} must be a safe whole number of minor units.`);
  }

  return value;
}

function safeNumber(value) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(409, "The calculated amount is outside the supported range.");
  }

  return Number(value);
}

function makeItem({
  type,
  serviceRequest = null,
  description,
  quantity,
  subtotalMinor,
  taxRateBps,
}) {
  money(subtotalMinor, "Subtotal");

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    quantity > 365
  ) {
    fail(409, "An invoice item has an invalid quantity.");
  }

  if (
    !Number.isInteger(taxRateBps) ||
    taxRateBps < 0 ||
    taxRateBps > 10000
  ) {
    fail(409, "The reservation tax rate is invalid.");
  }

  const subtotal = BigInt(subtotalMinor);
  const tax = (subtotal * BigInt(taxRateBps) + 5000n) / 10000n;

  return {
    type,
    serviceRequest,
    description,
    quantity,
    subtotalMinor,
    taxRateBps,
    taxAmountMinor: safeNumber(tax),
    totalMinor: safeNumber(subtotal + tax),
  };
}

const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.name === "ValidationError") {
        error.status = 400;
        error.message = Object.values(error.errors)
          .map((entry) => entry.message)
          .join(" ");
      } else if (error.name === "CastError") {
        error.status = 400;
        error.message = "An identifier or field value is invalid.";
      } else if (error.code === 11000) {
        error.status = 409;
        error.message =
          "This invoice or payment already exists. Refresh and try again.";
      } else if (
        error.name === "VersionError" ||
        error.code === 112 ||
        error.hasErrorLabel?.("TransientTransactionError")
      ) {
        error.status = 409;
        error.message = "The record changed. Refresh and try again.";
      }

      next(error);
    }
  };
}

// GET /api/billing/invoices
router.get(
  "/invoices",
  route(async (req, res) => {
    const page = readPage(req.query.page, 1, 1000000);
    const limit = readPage(req.query.limit, 20, 100);
    const filter = {};

    if (req.query.hotel) {
      filter.hotel = readId(req.query.hotel, "Hotel");
    }

    if (req.query.reservation) {
      filter.reservation = readId(
        req.query.reservation,
        "Reservation"
      );
    }

    if (req.query.status) {
      if (
        !["unpaid", "partially_paid", "paid"].includes(req.query.status)
      ) {
        fail(400, "Invoice status is invalid.");
      }

      filter.status = req.query.status;
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .select("-items")
        .sort({ issuedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
    ]);

    res.json({
      success: true,
      invoices,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

// GET /api/billing/invoices/:id
router.get(
  "/invoices/:id",
  route(async (req, res) => {
    const id = readId(req.params.id, "Invoice");

    const invoice = await Invoice.findById(id)
      .populate("createdBy", "name")
      .lean();

    if (!invoice) fail(404, "Invoice not found.");

    res.json({ success: true, invoice });
  })
);

// GET /api/billing/invoices/:id/payments
router.get(
  "/invoices/:id/payments",
  route(async (req, res) => {
    const id = readId(req.params.id, "Invoice");
    const page = readPage(req.query.page, 1, 1000000);
    const limit = readPage(req.query.limit, 20, 100);

    if (!(await Invoice.exists({ _id: id }))) {
      fail(404, "Invoice not found.");
    }

    const filter = { invoice: id };

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .select("-idempotencyKey")
        .populate("recordedBy", "name")
        .sort({ receivedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payment.countDocuments(filter),
    ]);

    res.json({
      success: true,
      payments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

// POST /api/billing/invoices
// Body: { reservation, notes? }
router.post(
  "/invoices",
  route(async (req, res) => {
    const body = readBody(req, ["reservation", "notes"]);
    const reservationId = readId(body.reservation, "Reservation");
    const notes = readText(body.notes, "Notes", 2000);

    await Invoice.init();

    let invoice;
    let created = false;

    try {
      await mongoose.connection.transaction(async (session) => {
        created = false;

        const existing = await Invoice.findOne({
          reservation: reservationId,
        }).session(session);

        if (existing) {
          invoice = existing;
          return;
        }

        const reservation = await Reservation.findOneAndUpdate(
          { _id: reservationId, status: "checked_out" },
          { $inc: { __v: 1 } },
          { new: true, session }
        ).lean();

        if (!reservation) {
          fail(
            409,
            "A final invoice can only be created for a checked-out reservation."
          );
        }

        const openService = await ServiceRequest.exists({
          reservation: reservationId,
          status: { $in: ["pending", "in_progress"] },
        }).session(session);

        if (openService) {
          fail(
            409,
            "Complete or cancel all pending services before creating the invoice."
          );
        }

        const hotel = await Hotel.findById(reservation.hotel)
          .session(session)
          .lean();

        const room = await Room.findById(reservation.room)
          .session(session)
          .lean();

        if (!hotel || !room) {
          fail(409, "The reservation hotel or room is missing.");
        }

        const services = await ServiceRequest.find({
          reservation: reservationId,
          status: "completed",
        })
          .sort({ completedAt: 1, _id: 1 })
          .limit(500)
          .session(session)
          .lean();

        if (services.length > 499) {
          fail(409, "This invoice exceeds the supported item limit.");
        }

        // Use the reservation's stored tax rate for all lines.
        // Room pricing uses the booked stay subtotal.
        const items = [
          makeItem({
            type: "room",
            description: `Room ${room.roomNumber} — ${reservation.nights} night(s)`,
            quantity: reservation.nights,
            subtotalMinor: reservation.subtotalMinor,
            taxRateBps: reservation.taxRateBps,
          }),
        ];

        if (
          items[0].taxAmountMinor !== reservation.taxAmountMinor ||
          items[0].totalMinor !== reservation.totalMinor
        ) {
          fail(409, "Reservation totals are inconsistent. Review the booking.");
        }

        for (const service of services) {
          if (
            String(service.hotel) !== String(reservation.hotel) ||
            String(service.room) !== String(reservation.room) ||
            service.currency !== reservation.currency
          ) {
            fail(409, "A service does not match this reservation.");
          }

          if (
            !Number.isSafeInteger(service.chargeMinor) ||
            service.chargeMinor < 0
          ) {
            fail(409, `Set a valid charge for service: ${service.title}.`);
          }

          items.push(
            makeItem({
              type: "service",
              serviceRequest: service._id,
              description: service.title,
              quantity: service.quantity,
              // chargeMinor is the TOTAL service charge for its quantity.
              subtotalMinor: service.chargeMinor,
              taxRateBps: reservation.taxRateBps,
            })
          );
        }

        const subtotalMinor = safeNumber(
          items.reduce((sum, item) => sum + BigInt(item.subtotalMinor), 0n)
        );

        const taxAmountMinor = safeNumber(
          items.reduce((sum, item) => sum + BigInt(item.taxAmountMinor), 0n)
        );

        const totalMinor = safeNumber(
          BigInt(subtotalMinor) + BigInt(taxAmountMinor)
        );

        const records = await Invoice.create(
          [
            {
              invoiceNumber: `INV-${randomUUID().toUpperCase()}`,
              reservation: reservation._id,
              hotel: reservation.hotel,
              room: reservation.room,
              guestUser: reservation.guestUser || null,
              hotelName: hotel.name,
              hotelAddress: hotel.address || "",
              hotelPhone: hotel.phone || "",
              guestName: reservation.guestName,
              guestEmail: reservation.guestEmail || "",
              guestPhone: reservation.guestPhone || "",
              bookingReference: reservation.bookingReference,
              roomNumber: room.roomNumber,
              checkInDate: reservation.checkInDate,
              checkOutDate: reservation.checkOutDate,
              currency: reservation.currency,
              items,
              subtotalMinor,
              taxAmountMinor,
              totalMinor,
              paidMinor: 0,
              balanceMinor: totalMinor,
              notes,
              createdBy: req.user._id,
            },
          ],
          { session }
        );

        invoice = records[0];
        created = true;
      }, transactionOptions);
    } catch (error) {
      // A concurrent request may have created this invoice.
      if (error.code !== 11000) throw error;

      invoice = await Invoice.findOne({ reservation: reservationId });
      if (!invoice) throw error;
      created = false;
    }

    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? "Invoice created." : "Invoice already exists.",
      invoice,
    });
  })
);

// POST /api/billing/invoices/:id/payments
// Records money already received; does not charge a bank/card.
router.post(
  "/invoices/:id/payments",
  route(async (req, res) => {
    const invoiceId = readId(req.params.id, "Invoice");
    const body = readBody(req, [
      "amountMinor",
      "method",
      "reference",
      "notes",
      "idempotencyKey",
    ]);

    const amountMinor = money(body.amountMinor, "Payment amount", 1);
    const method = body.method;

    if (!["cash", "card", "bank_transfer"].includes(method)) {
      fail(400, "Payment method is invalid.");
    }

    const reference = readText(body.reference, "Reference", 150);
    const notes = readText(body.notes, "Notes", 1000);
    const idempotencyKey = readText(
      body.idempotencyKey,
      "Idempotency key",
      128,
      true
    );

    if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      fail(
        400,
        "Use an idempotency key of 16–128 letters, numbers, hyphens or underscores."
      );
    }

    function checkExisting(payment) {
      if (
        String(payment.invoice) !== invoiceId.toLowerCase() ||
        payment.amountMinor !== amountMinor ||
        payment.method !== method ||
        payment.reference !== reference ||
        payment.notes !== notes ||
        String(payment.recordedBy) !== String(req.user._id)
      ) {
        fail(409, "This idempotency key was used for a different payment.");
      }
    }

    await Payment.init();

    let payment;
    let invoice;
    let replayed = false;

    try {
      await mongoose.connection.transaction(async (session) => {
        replayed = false;

        const existing = await Payment.findOne({
          idempotencyKey,
        }).session(session);

        if (existing) {
          checkExisting(existing);
          payment = existing;
          invoice = await Invoice.findById(invoiceId).session(session);

          if (!invoice) fail(404, "Invoice not found.");

          replayed = true;
          return;
        }

        invoice = await Invoice.findById(invoiceId).session(session);

        if (!invoice) fail(404, "Invoice not found.");

        if (
          !Number.isSafeInteger(invoice.totalMinor) ||
          !Number.isSafeInteger(invoice.paidMinor) ||
          invoice.paidMinor < 0 ||
          invoice.totalMinor < invoice.paidMinor
        ) {
          fail(409, "Invoice balances are inconsistent.");
        }

        const balance = invoice.totalMinor - invoice.paidMinor;

        if (amountMinor > balance) {
          fail(409, "Payment exceeds the remaining invoice balance.");
        }

        // Saving runs Invoice validation and recalculates balance/status.
        invoice.paidMinor = safeNumber(
          BigInt(invoice.paidMinor) + BigInt(amountMinor)
        );

        await invoice.save({ session });

        const records = await Payment.create(
          [
            {
              receiptNumber: `PAY-${randomUUID().toUpperCase()}`,
              idempotencyKey,
              invoice: invoice._id,
              reservation: invoice.reservation,
              hotel: invoice.hotel,
              currency: invoice.currency,
              amountMinor,
              method,
              reference,
              notes,
              recordedBy: req.user._id,
            },
          ],
          { session }
        );

        payment = records[0];
      }, transactionOptions);
    } catch (error) {
      if (error.code !== 11000) throw error;

      const existing = await Payment.findOne({ idempotencyKey });
      if (!existing) throw error;

      checkExisting(existing);
      payment = existing;
      invoice = await Invoice.findById(invoiceId);

      if (!invoice) fail(404, "Invoice not found.");

      replayed = true;
    }

    const paymentData = payment.toObject();
    delete paymentData.idempotencyKey;

    res.status(replayed ? 200 : 201).json({
      success: true,
      message: replayed
        ? "This payment was already recorded."
        : "Payment recorded successfully.",
      payment: paymentData,
      invoice,
    });
  })
);

module.exports = router;