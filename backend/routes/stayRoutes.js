const express = require("express");
const mongoose = require("mongoose");

const Reservation = require("../models/Reservation");
const Room = require("../models/Room");
const Hotel = require("../models/Hotel");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

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

function todayIn(timezone = "Asia/Karachi") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function requireEmptyBody(req) {
  if (
    !req.body ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Object.keys(req.body).length !== 0
  ) {
    fail("Send an empty JSON object: {}");
  }
}

router.param("id", (req, res, next, id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid reservation ID.",
    });
  }

  next();
});

const transactionOptions = {
  readPreference: "primary",
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  maxCommitTimeMS: 10000,
};

// Basic route check
router.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Check-in / Check-out API is running.",
  });
});

// POST /api/stays/:id/check-in
router.post("/:id/check-in", async (req, res, next) => {
  try {
    requireEmptyBody(req);

    const result = await mongoose.connection.transaction(
      async (session) => {
        const reservation = await Reservation.findById(req.params.id)
          .session(session)
          .lean();

        if (!reservation) {
          fail("Reservation not found.", 404);
        }

        // Repeated requests do not repeat the operation.
        if (reservation.status === "checked_in") {
          return {
            alreadyCompleted: true,
            reservation,
          };
        }

        if (reservation.status !== "confirmed") {
          fail("Only confirmed reservations can be checked in.", 409);
        }

        const hotel = await Hotel.findById(reservation.hotel)
          .session(session)
          .lean();

        if (!hotel || !hotel.isActive) {
          fail("The hotel is missing or inactive.", 409);
        }

        const today = todayIn(hotel.timezone);

        if (today < reservation.checkInDate) {
          fail("Check-in cannot happen before the booked arrival date.", 409);
        }

        if (today >= reservation.checkOutDate) {
          fail("The booked stay has ended. Update the booking first.", 409);
        }

        const otherStay = await Reservation.exists({
          _id: { $ne: reservation._id },
          room: reservation.room,
          status: "checked_in",
        }).session(session);

        if (otherStay) {
          fail("Another guest is still checked into this room.", 409);
        }

        // Conditional write also protects against simultaneous check-ins.
        const room = await Room.findOneAndUpdate(
          {
            _id: reservation.room,
            hotel: reservation.hotel,
            isActive: true,
            status: "available",
            capacity: { $gte: reservation.numberOfGuests },
          },
          {
            $set: { status: "occupied" },
            $inc: { __v: 1 },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!room) {
          fail(
            "The room must be active, available and large enough for this booking. Check cleaning or maintenance status.",
            409
          );
        }

        const updated = await Reservation.findOneAndUpdate(
          {
            _id: reservation._id,
            status: "confirmed",
          },
          {
            $set: {
              status: "checked_in",
              checkedInAt: new Date(),
            },
            $inc: { __v: 1 },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!updated) {
          fail("Reservation changed. Refresh and try again.", 409);
        }

        return {
          alreadyCompleted: false,
          reservation: updated,
          room,
        };
      },
      transactionOptions
    );

    return res.json({
      success: true,
      message: result.alreadyCompleted
        ? "This guest is already checked in."
        : "Guest checked in successfully. Room is now occupied.",
      reservation: result.reservation,
      room: result.room,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/stays/:id/check-out
router.post("/:id/check-out", async (req, res, next) => {
  try {
    requireEmptyBody(req);

    const result = await mongoose.connection.transaction(
      async (session) => {
        const reservation = await Reservation.findById(req.params.id)
          .session(session)
          .lean();

        if (!reservation) {
          fail("Reservation not found.", 404);
        }

        if (reservation.status === "checked_out") {
          return {
            alreadyCompleted: true,
            reservation,
          };
        }

        if (reservation.status !== "checked_in") {
          fail("Only checked-in guests can be checked out.", 409);
        }

        const otherStay = await Reservation.exists({
          _id: { $ne: reservation._id },
          room: reservation.room,
          status: "checked_in",
        }).session(session);

        if (otherStay) {
          fail(
            "Multiple active stays were found for this room. Resolve the room records before checkout.",
            409
          );
        }

        const room = await Room.findOneAndUpdate(
          {
            _id: reservation.room,
            hotel: reservation.hotel,
            status: "occupied",
          },
          {
            $set: { status: "cleaning" },
            $inc: { __v: 1 },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!room) {
          fail(
            "Room status does not match this stay. Refresh and check the room record.",
            409
          );
        }

        const updated = await Reservation.findOneAndUpdate(
          {
            _id: reservation._id,
            status: "checked_in",
          },
          {
            $set: {
              status: "checked_out",
              checkedOutAt: new Date(),
            },
            $inc: { __v: 1 },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!updated) {
          fail("Reservation changed. Refresh and try again.", 409);
        }

        // Keep the original booked dates and charges.
        // Billing adjustments will be handled by the billing module.
        return {
          alreadyCompleted: false,
          reservation: updated,
          room,
        };
      },
      transactionOptions
    );

    return res.json({
      success: true,
      message: result.alreadyCompleted
        ? "This guest is already checked out."
        : "Guest checked out successfully. Room now needs cleaning.",
      reservation: result.reservation,
      room: result.room,
    });
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
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
      message: "Invalid reservation or room value.",
    });
  }

  next(error);
});

module.exports = router;