const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect, authorize("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const publicFields =
  "_id name email phone preferences isActive createdAt updatedAt";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPage(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw fail(400, "Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    throw fail(400, `Pagination value must not exceed ${maximum}.`);
  }

  return number;
}

function readText(value, label, minimum, maximum) {
  if (typeof value !== "string") {
    throw fail(400, `${label} must be text.`);
  }

  const text = value.trim();

  if (text.length < minimum || text.length > maximum) {
    throw fail(
      400,
      `${label} must contain ${minimum} to ${maximum} characters.`
    );
  }

  return text;
}

router.param("id", (req, res, next, id) => {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return next(fail(400, "Invalid guest ID."));
  }

  next();
});

// List guests.
// GET /api/guests?page=1&limit=10&search=ali&active=true
router.get("/", async (req, res, next) => {
  try {
    const page = readPage(req.query.page, 1, 10000);
    const limit = readPage(req.query.limit, 20, 100);

    const filter = { role: "guest" };

    if (req.query.search !== undefined) {
      const search = readText(req.query.search, "Search", 0, 100);

      if (search) {
        const pattern = new RegExp(escapeRegex(search), "i");

        filter.$or = [
          { name: pattern },
          { email: pattern },
          { phone: pattern },
        ];
      }
    }

    if (req.query.active !== undefined) {
      if (!["true", "false"].includes(req.query.active)) {
        throw fail(400, "Active must be true or false.");
      }

      filter.isActive = req.query.active === "true";
    }

    const [guests, total] = await Promise.all([
      User.find(filter)
        .select(publicFields)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      guests,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// View one guest.
router.get("/:id", async (req, res, next) => {
  try {
    const guest = await User.findOne({
      _id: req.params.id,
      role: "guest",
    })
      .select(publicFields)
      .lean();

    if (!guest) {
      throw fail(404, "Guest not found.");
    }

    res.json({ success: true, guest });
  } catch (error) {
    next(error);
  }
});

// Update guest profile details.
// Email, password and role cannot be changed through this endpoint.
router.patch("/:id", async (req, res, next) => {
  try {
    const origin = req.get("Origin");
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    if (origin && origin !== allowedOrigin) {
      throw fail(403, "Request origin is not allowed.");
    }

    if (!req.is("application/json")) {
      throw fail(415, "Send the request as application/json.");
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      throw fail(400, "A JSON object is required.");
    }

    const allowedFields = ["name", "phone", "preferences"];
    const keys = Object.keys(req.body);

    if (!keys.length) {
      throw fail(400, "Provide at least one field to update.");
    }

    if (keys.some((key) => !allowedFields.includes(key))) {
      throw fail(400, "Only name, phone and preferences can be updated.");
    }

    const updates = {};

    if (Object.hasOwn(req.body, "name")) {
      updates.name = readText(req.body.name, "Name", 2, 100);
    }

    if (Object.hasOwn(req.body, "phone")) {
      updates.phone = readText(req.body.phone, "Phone", 0, 25);
    }

    if (Object.hasOwn(req.body, "preferences")) {
      updates.preferences = readText(
        req.body.preferences,
        "Preferences",
        0,
        1000
      );
    }

    const guest = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        role: "guest",
      },
      {
        $set: updates,
        $inc: { __v: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .select(publicFields)
      .lean();

    if (!guest) {
      throw fail(404, "Guest not found.");
    }

    res.json({
      success: true,
      message: "Guest profile updated successfully.",
      guest,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      return next(fail(400, "Please check the guest profile details."));
    }

    next(error);
  }
});

module.exports = router;