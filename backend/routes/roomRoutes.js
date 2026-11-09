const express = require("express");
const Room = require("../models/Room");
const Hotel = require("../models/Hotel");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// Room inventory administration is restricted to admins.
router.use(protect);
router.use(authorize("admin"));

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
        message: "Please send data as application/json.",
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
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    fail("Pagination value is too large.");
  }

  return number;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const textLimits = {
  roomNumber: 20,
  floor: 30,
  roomType: 30,
  bedType: 20,
  description: 2000,
};

const roomTypes = [
  "standard",
  "deluxe",
  "executive",
  "suite",
  "presidential",
];

const bedTypes = ["single", "double", "twin", "queen", "king"];

const statuses = [
  "available",
  "occupied",
  "cleaning",
  "maintenance",
];

const amenities = [
  "wifi",
  "air_conditioning",
  "television",
  "minibar",
  "safe",
  "balcony",
  "sea_view",
  "bathtub",
  "work_desk",
  "tea_coffee",
  "room_service",
  "accessible",
];

function readInput(body, creating) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Please provide a valid room object.");
  }

  const allowed = new Set([
    ...Object.keys(textLimits),
    "numberOfBeds",
    "capacity",
    "pricePerNightMinor",
    "amenities",
    "isActive",
    ...(creating ? ["hotel"] : []),
  ]);

  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      fail(`Field "${key}" is not allowed.`);
    }
  }

  const input = {};

  for (const [key, maximum] of Object.entries(textLimits)) {
    if (body[key] === undefined) continue;

    if (typeof body[key] !== "string") {
      fail(`${key} must be text.`);
    }

    input[key] = body[key].trim();

    if (input[key].length > maximum) {
      fail(`${key} cannot exceed ${maximum} characters.`);
    }
  }

  if (input.roomNumber !== undefined) {
    input.roomNumber = input.roomNumber.toUpperCase();

    if (!input.roomNumber) {
      fail("Room number is required.");
    }
  }

  if (
    input.roomType !== undefined &&
    !roomTypes.includes(input.roomType)
  ) {
    fail("Please select a valid room type.");
  }

  if (
    input.bedType !== undefined &&
    !bedTypes.includes(input.bedType)
  ) {
    fail("Please select a valid bed type.");
  }

  for (const [key, maximum] of [
    ["numberOfBeds", 10],
    ["capacity", 20],
  ]) {
    if (body[key] === undefined) continue;

    if (
      !Number.isInteger(body[key]) ||
      body[key] < 1 ||
      body[key] > maximum
    ) {
      fail(`${key} must be a whole number between 1 and ${maximum}.`);
    }

    input[key] = body[key];
  }

  if (body.pricePerNightMinor !== undefined) {
    if (
      !Number.isSafeInteger(body.pricePerNightMinor) ||
      body.pricePerNightMinor < 0
    ) {
      fail("Nightly price must be a non-negative whole minor-unit amount.");
    }

    input.pricePerNightMinor = body.pricePerNightMinor;
  }

  if (body.amenities !== undefined) {
    if (
      !Array.isArray(body.amenities) ||
      body.amenities.length > amenities.length ||
      body.amenities.some(
        (value) =>
          typeof value !== "string" || !amenities.includes(value)
      ) ||
      new Set(body.amenities).size !== body.amenities.length
    ) {
      fail("Please select valid, non-duplicate amenities.");
    }

    input.amenities = body.amenities;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      fail("isActive must be true or false.");
    }

    input.isActive = body.isActive;
  }

  if (creating) {
    if (!validId(body.hotel)) {
      fail("Please select a valid hotel.");
    }

    input.hotel = body.hotel;

    if (!input.roomNumber) {
      fail("Room number is required.");
    }

    if (input.pricePerNightMinor === undefined) {
      fail("Nightly price is required.");
    }
  } else if (Object.keys(input).length === 0) {
    fail("Please provide at least one field to update.");
  }

  return input;
}

router.param("id", (req, res, next, id) => {
  if (!validId(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid room ID.",
    });
  }

  next();
});

// GET /api/rooms
router.get("/", async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 10000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const filter = {};

    if (req.query.hotel !== undefined) {
      if (!validId(req.query.hotel)) {
        fail("Invalid hotel ID.");
      }

      filter.hotel = req.query.hotel;
    }

    if (req.query.status !== undefined) {
      if (!statuses.includes(req.query.status)) {
        fail("Invalid room status.");
      }

      filter.status = req.query.status;
    }

    if (req.query.roomType !== undefined) {
      if (!roomTypes.includes(req.query.roomType)) {
        fail("Invalid room type.");
      }

      filter.roomType = req.query.roomType;
    }

    if (req.query.active !== undefined) {
      if (!["true", "false"].includes(req.query.active)) {
        fail("Active must be true or false.");
      }

      filter.isActive = req.query.active === "true";
    }

    if (req.query.search !== undefined) {
      if (
        typeof req.query.search !== "string" ||
        req.query.search.length > 100
      ) {
        fail("Search must be text with a maximum of 100 characters.");
      }

      const search = req.query.search.trim();

      if (search) {
        filter.roomNumber = {
          $regex: escapeRegex(search),
          $options: "i",
        };
      }
    }

    const [rooms, total] = await Promise.all([
      Room.find(filter)
        .populate("hotel", "name code city currency isActive")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Room.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      rooms,
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

// GET /api/rooms/:id
router.get("/:id", async (req, res, next) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate("hotel", "name code city currency isActive")
      .lean();

    if (!room) fail("Room not found.", 404);

    return res.json({
      success: true,
      room,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/rooms
router.post("/", async (req, res, next) => {
  try {
    const input = readInput(req.body, true);

    const hotel = await Hotel.findById(input.hotel)
      .select("isActive")
      .lean();

    if (!hotel) fail("Hotel not found.", 404);

    if (!hotel.isActive) {
      fail("Activate this hotel before adding rooms.", 409);
    }

    // Ensure the unique hotel + room-number index is ready.
    await Room.init();

    const room = await Room.create({
      ...input,
      status: "available",
      createdBy: req.user._id,
    });

    await room.populate("hotel", "name code city currency isActive");

    return res.status(201).json({
      success: true,
      message: "Room created successfully.",
      room,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/rooms/:id
// Status is intentionally excluded from general inventory edits.
// Check-in/out and housekeeping will manage status separately.
router.patch("/:id", async (req, res, next) => {
  try {
    const input = readInput(req.body, false);

    const filter = { _id: req.params.id };

    // Atomically prevent deactivation of an occupied room.
    if (input.isActive === false) {
      filter.status = { $ne: "occupied" };
    }

    const room = await Room.findOneAndUpdate(
      filter,
      { $set: input },
      {
        new: true,
        runValidators: true,
      }
    ).populate("hotel", "name code city currency isActive");

    if (!room) {
      const exists = await Room.exists({ _id: req.params.id });

      if (!exists) fail("Room not found.", 404);

      fail("An occupied room cannot be deactivated.", 409);
    }

    return res.json({
      success: true,
      message: "Room updated successfully.",
      room,
    });
  } catch (error) {
    next(error);
  }
});

// Room-specific errors
router.use((error, req, res, next) => {
  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "This room number already exists in the selected hotel.",
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

  next(error);
});

module.exports = router;