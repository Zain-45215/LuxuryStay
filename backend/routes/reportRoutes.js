const express = require("express");

const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const Reservation = require("../models/Reservation");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

function validDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// GET /api/reports/summary
// Optional: ?from=2026-11-01&to=2026-11-30
// Dates filter reservation check-in dates, inclusively.
// Room occupancy is always the current operational snapshot.
router.get("/summary", async (req, res, next) => {
  try {
    const { from, to } = req.query;

    if (from !== undefined && !validDate(from)) {
      throw badRequest("From date must be a valid YYYY-MM-DD date.");
    }

    if (to !== undefined && !validDate(to)) {
      throw badRequest("To date must be a valid YYYY-MM-DD date.");
    }

    if (from && to && from > to) {
      throw badRequest("From date cannot be after the To date.");
    }

    const reservationFilter = {};

    if (from || to) {
      reservationFilter.checkInDate = {};

      if (from) reservationFilter.checkInDate.$gte = from;
      if (to) reservationFilter.checkInDate.$lte = to;
    }

    const activeHotels = await Hotel.find({ isActive: true })
      .select("_id")
      .lean();

    const activeHotelIds = activeHotels.map((hotel) => hotel._id);

    const [
      totalHotels,
      roomGroups,
      reservationGroups,
      bookingAmounts,
    ] = await Promise.all([
      Hotel.countDocuments({}),

      Room.aggregate([
        {
          $match: {
            isActive: true,
            hotel: { $in: activeHotelIds },
          },
        },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      Reservation.aggregate([
        { $match: reservationFilter },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
          },
        },
      ]),

      Reservation.aggregate([
        {
          $match: {
            ...reservationFilter,
            status: {
              $in: ["confirmed", "checked_in", "checked_out"],
            },
          },
        },
        {
          $group: {
            _id: "$currency",
            reservations: { $sum: 1 },
            roomNights: { $sum: "$nights" },
            subtotalMinor: { $sum: "$subtotalMinor" },
            taxAmountMinor: { $sum: "$taxAmountMinor" },
            totalMinor: { $sum: "$totalMinor" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const roomStatus = {
      available: 0,
      occupied: 0,
      cleaning: 0,
      maintenance: 0,
      other: 0,
    };

    for (const group of roomGroups) {
      const key = Object.prototype.hasOwnProperty.call(
        roomStatus,
        group._id
      )
        ? group._id
        : "other";

      roomStatus[key] += group.count;
    }

    const totalRooms = Object.values(roomStatus).reduce(
      (sum, count) => sum + count,
      0
    );

    const reservationStatus = {
      confirmed: 0,
      checked_in: 0,
      checked_out: 0,
      cancelled: 0,
      no_show: 0,
      other: 0,
    };

    for (const group of reservationGroups) {
      const key = Object.prototype.hasOwnProperty.call(
        reservationStatus,
        group._id
      )
        ? group._id
        : "other";

      reservationStatus[key] += group.count;
    }

    const totalReservations = Object.values(reservationStatus).reduce(
      (sum, count) => sum + count,
      0
    );

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),

      filters: {
        from: from || null,
        to: to || null,
        dateBasis: "Reservation check-in date",
      },

      hotels: {
        total: totalHotels,
        active: activeHotels.length,
      },

      rooms: {
        total: totalRooms,
        status: roomStatus,

        // Includes cleaning and maintenance rooms in the denominator.
        occupancyPercent:
          totalRooms > 0
            ? Math.round(
                (roomStatus.occupied / totalRooms) * 10000
              ) / 100
            : null,
      },

      reservations: {
        total: totalReservations,
        status: reservationStatus,
      },

      bookingAmounts: bookingAmounts.map((group) => ({
        currency: group._id,
        reservations: group.reservations,
        roomNights: group.roomNights,
        subtotalMinor: group.subtotalMinor,
        taxAmountMinor: group.taxAmountMinor,
        totalMinor: group.totalMinor,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;