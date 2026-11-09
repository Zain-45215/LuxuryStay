const express = require("express");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Hotel = require("../models/Hotel");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// Admin accounts are managed separately.
const STAFF_ROLES = [
  "manager",
  "receptionist",
  "housekeeping",
  "maintenance",
];

// Only these fields may appear in staff API responses.
const PUBLIC_FIELDS =
  "_id name email phone role hotel isActive lastLogin createdAt updatedAt";

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validId(value) {
  return typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);
}

function checkBody(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Send a JSON object.");
  }

  const unknown = Object.keys(body).filter(
    (field) => !allowedFields.includes(field)
  );

  if (unknown.length) {
    fail(`Unsupported fields: ${unknown.join(", ")}`);
  }

  if (!Object.keys(body).length) {
    fail("Provide at least one field.");
  }
}

function readText(value, label, min, max) {
  if (typeof value !== "string") {
    fail(`${label} must be text.`);
  }

  const text = value.trim();

  if (text.length < min || text.length > max) {
    fail(`${label} must contain between ${min} and ${max} characters.`);
  }

  return text;
}

function readEmail(value) {
  const email = readText(value, "Email", 3, 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("Please enter a valid email address.");
  }

  return email;
}

function checkPassword(value) {
  if (typeof value !== "string" || value.length < 12) {
    fail("Password must contain at least 12 characters.");
  }

  // Prevent bcrypt password truncation.
  if (Buffer.byteLength(value, "utf8") > 72) {
    fail("Password must not exceed 72 UTF-8 bytes.");
  }

  if (!value.trim()) {
    fail("Password cannot contain only spaces.");
  }

  return value;
}

function readRole(value) {
  if (!STAFF_ROLES.includes(value)) {
    fail("Choose manager, receptionist, housekeeping or maintenance.");
  }

  return value;
}

async function checkHotel(id) {
  if (!validId(id)) {
    fail("A valid hotel ID is required.");
  }

  const hotel = await Hotel.exists({
    _id: id,
    isActive: true,
  });

  if (!hotel) {
    fail("Choose an active hotel.");
  }

  return id;
}

function pageNumber(value, fallback, max) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > max) {
    fail(`Pagination value must not exceed ${max}.`);
  }

  return number;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicStaff(query) {
  return query
    .select(PUBLIC_FIELDS)
    .populate("hotel", "name code city isActive");
}

function staffFilter(id) {
  return {
    _id: id,
    role: { $in: STAFF_ROLES },
  };
}

router.use(protect);
router.use(authorize("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    const origin = req.get("origin");

    if (origin && origin !== allowedOrigin) {
      return res.status(403).json({
        success: false,
        message: "Request origin is not allowed.",
      });
    }

    if (!req.is("application/json")) {
      return res.status(415).json({
        success: false,
        message: "Content-Type must be application/json.",
      });
    }
  }

  next();
});

router.param("id", (req, res, next, id) => {
  if (!validId(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid staff ID.",
    });
  }

  next();
});

// GET /api/staff
// Filters: hotel, role, active, search, page, limit.
router.get("/", async (req, res, next) => {
  try {
    const filter = {
      role: { $in: STAFF_ROLES },
    };

    const page = pageNumber(req.query.page, 1, 10000);
    const limit = pageNumber(req.query.limit, 20, 100);

    if (req.query.hotel !== undefined) {
      if (!validId(req.query.hotel)) {
        fail("Invalid hotel ID.");
      }

      filter.hotel = req.query.hotel;
    }

    if (req.query.role !== undefined) {
      filter.role = readRole(req.query.role);
    }

    if (req.query.active !== undefined) {
      if (!["true", "false"].includes(req.query.active)) {
        fail("active must be true or false.");
      }

      filter.isActive = req.query.active === "true";
    }

    if (req.query.search !== undefined) {
      const search = readText(req.query.search, "Search", 0, 100);

      if (search) {
        const expression = new RegExp(escapeRegex(search), "i");

        filter.$or = [
          { name: expression },
          { email: expression },
          { phone: expression },
        ];
      }
    }

    const [staff, total] = await Promise.all([
      publicStaff(
        User.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ).lean(),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      staff,
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

// GET /api/staff/:id
router.get("/:id", async (req, res, next) => {
  try {
    const staff = await publicStaff(
      User.findOne(staffFilter(req.params.id))
    ).lean();

    if (!staff) {
      fail("Staff member not found.", 404);
    }

    res.json({ success: true, staff });
  } catch (error) {
    next(error);
  }
});

// POST /api/staff
router.post("/", async (req, res, next) => {
  try {
    checkBody(req.body, [
      "name",
      "email",
      "phone",
      "password",
      "role",
      "hotel",
    ]);

    const name = readText(req.body.name, "Name", 2, 100);
    const email = readEmail(req.body.email);
    const phone = readText(req.body.phone ?? "", "Phone", 0, 25);
    const role = readRole(req.body.role);
    const password = checkPassword(req.body.password);
    const hotel = await checkHotel(req.body.hotel);

    await User.init();

    const passwordHash = await bcrypt.hash(password, 12);

    const created = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role,
      hotel,
      isActive: true,
      tokenVersion: 0,
    });

    // Use an explicit projection; never return the password hash.
    const staff = await publicStaff(
      User.findById(created._id)
    ).lean();

    res.status(201).json({
      success: true,
      message: "Staff account created successfully.",
      staff,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/staff/:id
// Profile, hotel and role changes.
router.patch("/:id", async (req, res, next) => {
  try {
    checkBody(req.body, ["name", "email", "phone", "role", "hotel"]);

    const changes = {};

    if (req.body.name !== undefined) {
      changes.name = readText(req.body.name, "Name", 2, 100);
    }

    if (req.body.email !== undefined) {
      changes.email = readEmail(req.body.email);
    }

    if (req.body.phone !== undefined) {
      changes.phone = readText(req.body.phone, "Phone", 0, 25);
    }

    if (req.body.role !== undefined) {
      changes.role = readRole(req.body.role);
    }

    if (req.body.hotel !== undefined) {
      changes.hotel = await checkHotel(req.body.hotel);
    }

    const invalidatesSession =
      changes.email !== undefined ||
      changes.role !== undefined ||
      changes.hotel !== undefined;

    const increment = { __v: 1 };

    if (invalidatesSession) {
      increment.tokenVersion = 1;
    }

    const staff = await publicStaff(
      User.findOneAndUpdate(
        staffFilter(req.params.id),
        {
          $set: changes,
          $inc: increment,
        },
        {
          new: true,
          runValidators: true,
        }
      )
    ).lean();

    if (!staff) {
      fail("Staff member not found.", 404);
    }

    res.json({
      success: true,
      message: invalidatesSession
        ? "Staff updated. The staff member must log in again."
        : "Staff profile updated.",
      staff,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/staff/:id/status
// Body: { "isActive": true } or { "isActive": false }
router.patch("/:id/status", async (req, res, next) => {
  try {
    checkBody(req.body, ["isActive"]);

    if (typeof req.body.isActive !== "boolean") {
      fail("isActive must be true or false.");
    }

    const staff = await publicStaff(
      User.findOneAndUpdate(
        staffFilter(req.params.id),
        {
          $set: { isActive: req.body.isActive },
          $inc: { tokenVersion: 1, __v: 1 },
        },
        {
          new: true,
          runValidators: true,
        }
      )
    ).lean();

    if (!staff) {
      fail("Staff member not found.", 404);
    }

    res.json({
      success: true,
      message: staff.isActive
        ? "Staff account activated. Please log in again."
        : "Staff account deactivated and existing sessions invalidated.",
      staff,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/staff/:id/password
// Body: { "password": "new password" }
router.patch("/:id/password", async (req, res, next) => {
  try {
    checkBody(req.body, ["password"]);

    const password = checkPassword(req.body.password);

    const exists = await User.exists(staffFilter(req.params.id));

    if (!exists) {
      fail("Staff member not found.", 404);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const staff = await publicStaff(
      User.findOneAndUpdate(
        staffFilter(req.params.id),
        {
          $set: { passwordHash },
          $inc: { tokenVersion: 1, __v: 1 },
        },
        {
          new: true,
          runValidators: true,
        }
      )
    ).lean();

    if (!staff) {
      fail("Staff member not found.", 404);
    }

    res.json({
      success: true,
      message: "Password reset. The staff member must log in again.",
      staff,
    });
  } catch (error) {
    next(error);
  }
});

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "An account with this email already exists.",
    });
  }

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: Object.values(err.errors)
        .map((item) => item.message)
        .join(" "),
    });
  }

  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid value supplied.",
    });
  }

  next(err);
});

module.exports = router;