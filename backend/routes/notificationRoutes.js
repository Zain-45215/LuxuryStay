const express = require("express");

const Notification = require("../models/Notification");
const { protect } = require("../middleware/auth");

const router = express.Router();

const TYPES = [
  "reservation",
  "check_in",
  "check_out",
  "housekeeping",
  "maintenance",
  "service",
  "billing",
  "feedback",
  "announcement",
  "system",
];

const PRIORITIES = ["normal", "high", "urgent"];

const PUBLIC_FIELDS =
  "_id hotel type title message priority relatedModel relatedId " +
  "readAt archivedAt createdAt updatedAt";

router.use(protect);

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const allowedOrigin =
    process.env.CLIENT_URL || "http://localhost:5173";

  const origin = req.get("origin");

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

function readId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{24}$/i.test(value)
  ) {
    fail(400, "Notification ID is invalid.");
  }

  return value;
}

function readPage(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    fail(400, "Pagination values must be positive whole numbers.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    fail(400, "Pagination value is too large.");
  }

  return number;
}

function readChoice(value, allowed, fallback, label) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(400, `${label} is invalid.`);
  }

  return value;
}

function readBody(req, allowedFields = []) {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "A JSON object is required.");
  }

  const unknown = Object.keys(body).filter(
    (field) => !allowedFields.includes(field)
  );

  if (unknown.length) {
    fail(400, `Unsupported fields: ${unknown.join(", ")}.`);
  }

  return body;
}

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.name === "CastError") {
        error.status = 400;
        error.message = "An identifier or field value is invalid.";
      } else if (error.name === "ValidationError") {
        error.status = 400;
        error.message = Object.values(error.errors)
          .map((entry) => entry.message)
          .join(" ");
      }

      next(error);
    }
  };
}

// GET /api/notifications
//
// Query:
// page=1
// limit=20
// archived=false | true
// read=all | unread | read
// type=reservation | maintenance | ...
// priority=normal | high | urgent
router.get(
  "/",
  route(async (req, res) => {
    const page = readPage(req.query.page, 1, 1000000);
    const limit = readPage(req.query.limit, 20, 100);

    const archived = readChoice(
      req.query.archived,
      ["true", "false"],
      "false",
      "Archive filter"
    );

    const read = readChoice(
      req.query.read,
      ["all", "unread", "read"],
      "all",
      "Read filter"
    );

    const filter = {
      recipient: req.user._id,
      archivedAt: archived === "true" ? { $ne: null } : null,
    };

    if (read === "unread") {
      filter.readAt = null;
    } else if (read === "read") {
      filter.readAt = { $ne: null };
    }

    if (req.query.type !== undefined) {
      filter.type = readChoice(
        req.query.type,
        TYPES,
        undefined,
        "Notification type"
      );
    }

    if (req.query.priority !== undefined) {
      filter.priority = readChoice(
        req.query.priority,
        PRIORITIES,
        undefined,
        "Priority"
      );
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .select(PUBLIC_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      Notification.countDocuments(filter),
    ]);

    res.json({
      success: true,
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

// GET /api/notifications/unread-count
// Archived notifications do not contribute to the inbox badge.
router.get(
  "/unread-count",
  route(async (req, res) => {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      archivedAt: null,
      readAt: null,
    });

    res.json({
      success: true,
      unreadCount,
    });
  })
);

// PATCH /api/notifications/read-all
// Body: {}
// Marks currently existing, unarchived notifications as read.
router.patch(
  "/read-all",
  route(async (req, res) => {
    readBody(req);

    const now = new Date();

    const result = await Notification.updateMany(
      {
        recipient: req.user._id,
        archivedAt: null,
        readAt: null,
        createdAt: { $lte: now },
      },
      {
        $set: { readAt: now },
        $inc: { __v: 1 },
      },
      { runValidators: true }
    );

    res.json({
      success: true,
      message: "Inbox notifications marked as read.",
      updatedCount: result.modifiedCount,
    });
  })
);

// GET /api/notifications/:id
// Viewing the record does not automatically mark it as read.
router.get(
  "/:id",
  route(async (req, res) => {
    const id = readId(req.params.id);

    const notification = await Notification.findOne({
      _id: id,
      recipient: req.user._id,
    })
      .select(PUBLIC_FIELDS)
      .lean();

    if (!notification) {
      fail(404, "Notification not found.");
    }

    res.json({
      success: true,
      notification,
    });
  })
);

// PATCH /api/notifications/:id/read
// Body: { "isRead": true } or { "isRead": false }
router.patch(
  "/:id/read",
  route(async (req, res) => {
    const id = readId(req.params.id);
    const body = readBody(req, ["isRead"]);

    if (typeof body.isRead !== "boolean") {
      fail(400, "isRead must be true or false.");
    }

    // Update only when the read state actually changes.
    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: req.user._id,
        readAt: body.isRead ? null : { $ne: null },
      },
      {
        $set: {
          readAt: body.isRead ? new Date() : null,
        },
        $inc: { __v: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .select(PUBLIC_FIELDS)
      .lean();

    const result =
      notification ||
      (await Notification.findOne({
        _id: id,
        recipient: req.user._id,
      })
        .select(PUBLIC_FIELDS)
        .lean());

    if (!result) {
      fail(404, "Notification not found.");
    }

    res.json({
      success: true,
      message: body.isRead
        ? "Notification marked as read."
        : "Notification marked as unread.",
      notification: result,
    });
  })
);

// PATCH /api/notifications/:id/archive
// Body: { "archived": true } or { "archived": false }
// Restoring preserves the notification's read/unread state.
router.patch(
  "/:id/archive",
  route(async (req, res) => {
    const id = readId(req.params.id);
    const body = readBody(req, ["archived"]);

    if (typeof body.archived !== "boolean") {
      fail(400, "archived must be true or false.");
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipient: req.user._id,
        archivedAt: body.archived ? null : { $ne: null },
      },
      {
        $set: {
          archivedAt: body.archived ? new Date() : null,
        },
        $inc: { __v: 1 },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .select(PUBLIC_FIELDS)
      .lean();

    const result =
      notification ||
      (await Notification.findOne({
        _id: id,
        recipient: req.user._id,
      })
        .select(PUBLIC_FIELDS)
        .lean());

    if (!result) {
      fail(404, "Notification not found.");
    }

    res.json({
      success: true,
      message: body.archived
        ? "Notification archived."
        : "Notification restored to inbox.",
      notification: result,
    });
  })
);

module.exports = router;