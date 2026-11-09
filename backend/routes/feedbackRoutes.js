const express = require("express");
const mongoose = require("mongoose");

const Feedback = require("../models/Feedback");
const Reservation = require("../models/Reservation");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect);
router.use(authorize("admin", "guest"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

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

const ratingFields = [
  "overallRating",
  "cleanlinessRating",
  "serviceRating",
  "comfortRating",
  "valueRating",
];

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function readId(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{24}$/i.test(value)
  ) {
    fail(400, `${label} is invalid.`);
  }

  return value;
}

function readText(value, label, minimum, maximum) {
  if (typeof value !== "string") {
    fail(400, `${label} must be text.`);
  }

  const text = value.trim();

  if (text.length < minimum || text.length > maximum) {
    fail(
      400,
      `${label} must contain ${minimum}–${maximum} characters.`
    );
  }

  return text;
}

function readBody(req, allowedFields) {
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

function readRating(value, required = false) {
  if (value === undefined || value === null) {
    if (required) {
      fail(400, "Overall rating is required.");
    }

    return null;
  }

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    fail(400, "Ratings must be whole numbers between 1 and 5.");
  }

  return value;
}

function scopedFilter(req) {
  return req.user.role === "guest"
    ? { guestUser: req.user._id }
    : {};
}

// Explicit response fields keep internal notes and staff IDs private.
function serializeFeedback(document, isAdmin) {
  const record =
    typeof document.toObject === "function"
      ? document.toObject()
      : document;

  const result = {
    _id: record._id,
    reservation: record.reservation,
    hotel: record.hotel,
    room: record.room,
    guestName: record.guestName,
    bookingReference: record.bookingReference,
    overallRating: record.overallRating,
    cleanlinessRating: record.cleanlinessRating,
    serviceRating: record.serviceRating,
    comfortRating: record.comfortRating,
    valueRating: record.valueRating,
    title: record.title,
    comment: record.comment,
    source: record.source,
    status: record.status,
    managementResponse: record.managementResponse,
    respondedAt: record.respondedAt,
    reviewedAt: record.reviewedAt,
    resolvedAt: record.resolvedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };

  if (isAdmin) {
    Object.assign(result, {
      guestUser: record.guestUser,
      internalNotes: record.internalNotes || "",
      createdBy: record.createdBy,
      respondedBy: record.respondedBy,
      reviewedBy: record.reviewedBy,
      resolvedBy: record.resolvedBy,
      version: record.__v,
    });
  }

  return result;
}

function populateFeedback(query, isAdmin) {
  query
    .populate("hotel", "name code city")
    .populate("room", "roomNumber roomType");

  if (isAdmin) {
    query
      .select("+internalNotes")
      .populate("createdBy", "name")
      .populate("respondedBy", "name")
      .populate("reviewedBy", "name")
      .populate("resolvedBy", "name");
  }

  return query;
}

function route(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.name === "ValidationError") {
        error.status = 400;
        error.message = Object.values(error.errors)
          .map((item) => item.message)
          .join(" ");
      } else if (error.name === "CastError") {
        error.status = 400;
        error.message = "An identifier or field value is invalid.";
      } else if (error.code === 11000) {
        error.status = 409;
        error.message =
          "Feedback already exists for this reservation.";
      } else if (error.name === "VersionError") {
        error.status = 409;
        error.message =
          "This feedback changed. Refresh before saving again.";
      }

      next(error);
    }
  };
}

// GET /api/feedback
// Admin: all feedback.
// Guest: only feedback linked to their account.
router.get(
  "/",
  route(async (req, res) => {
    const isAdmin = req.user.role === "admin";
    const filter = scopedFilter(req);

    const page = readPage(req.query.page, 1, 1000000);
    const limit = readPage(req.query.limit, 20, 100);

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
      if (!["new", "reviewed", "resolved"].includes(req.query.status)) {
        fail(400, "Feedback status is invalid.");
      }

      filter.status = req.query.status;
    }

    if (req.query.rating !== undefined) {
      if (
        typeof req.query.rating !== "string" ||
        !/^[1-5]$/.test(req.query.rating)
      ) {
        fail(400, "Rating filter must be between 1 and 5.");
      }

      filter.overallRating = Number(req.query.rating);
    }

    const query = Feedback.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const [records, total] = await Promise.all([
      populateFeedback(query, isAdmin).lean(),
      Feedback.countDocuments(filter),
    ]);

    res.json({
      success: true,
      feedback: records.map((record) =>
        serializeFeedback(record, isAdmin)
      ),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  })
);

// GET /api/feedback/:id
router.get(
  "/:id",
  route(async (req, res) => {
    const id = readId(req.params.id, "Feedback");
    const isAdmin = req.user.role === "admin";

    const record = await populateFeedback(
      Feedback.findOne({
        ...scopedFilter(req),
        _id: id,
      }),
      isAdmin
    ).lean();

    if (!record) {
      fail(404, "Feedback not found.");
    }

    res.json({
      success: true,
      feedback: serializeFeedback(record, isAdmin),
    });
  })
);

// POST /api/feedback
// Body:
// {
//   reservation,
//   overallRating,
//   cleanlinessRating?,
//   serviceRating?,
//   comfortRating?,
//   valueRating?,
//   title,
//   comment
// }
router.post(
  "/",
  route(async (req, res) => {
    const body = readBody(req, [
      "reservation",
      ...ratingFields,
      "title",
      "comment",
    ]);

    const reservationId = readId(
      body.reservation,
      "Reservation"
    );

    const title = readText(body.title, "Title", 3, 150);
    const comment = readText(body.comment, "Comment", 5, 3000);

    const ratings = {};

    for (const field of ratingFields) {
      ratings[field] = readRating(
        body[field],
        field === "overallRating"
      );
    }

    const isAdmin = req.user.role === "admin";

    const reservationFilter = {
      _id: reservationId,
      ...(isAdmin ? {} : { guestUser: req.user._id }),
    };

    const reservation = await Reservation.findOne(
      reservationFilter
    ).lean();

    if (!reservation) {
      fail(404, "Reservation not found.");
    }

    if (reservation.status !== "checked_out") {
      fail(
        409,
        "Feedback can only be submitted after check-out."
      );
    }

    await Feedback.init();

    if (
      await Feedback.exists({
        reservation: reservation._id,
      })
    ) {
      fail(409, "Feedback already exists for this reservation.");
    }

    const record = await Feedback.create({
      reservation: reservation._id,
      hotel: reservation.hotel,
      room: reservation.room,
      guestUser: reservation.guestUser || null,
      guestName: reservation.guestName,
      bookingReference: reservation.bookingReference,
      ...ratings,
      title,
      comment,
      source: isAdmin ? "staff" : "guest",
      status: "new",
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully.",
      feedback: serializeFeedback(record, isAdmin),
    });
  })
);

// PATCH /api/feedback/:id
// Admin management only.
// Body: {
//   version,
//   status?,
//   internalNotes?,
//   managementResponse?
// }
// Ratings and the original guest comment cannot be changed here.
router.patch(
  "/:id",
  authorize("admin"),
  route(async (req, res) => {
    const id = readId(req.params.id, "Feedback");

    const body = readBody(req, [
      "version",
      "status",
      "internalNotes",
      "managementResponse",
    ]);

    if (
      !Number.isSafeInteger(body.version) ||
      body.version < 0
    ) {
      fail(400, "The current feedback version is required.");
    }

    const has = (field) =>
      Object.prototype.hasOwnProperty.call(body, field);

    if (
      !has("status") &&
      !has("internalNotes") &&
      !has("managementResponse")
    ) {
      fail(400, "Provide at least one field to update.");
    }

    if (
      has("status") &&
      !["new", "reviewed", "resolved"].includes(body.status)
    ) {
      fail(400, "Feedback status is invalid.");
    }

    const internalNotes = has("internalNotes")
      ? readText(body.internalNotes, "Internal notes", 0, 3000)
      : undefined;

    const managementResponse = has("managementResponse")
      ? readText(
          body.managementResponse,
          "Management response",
          0,
          3000
        )
      : undefined;

    const record = await Feedback.findById(id)
      .select("+internalNotes");

    if (!record) {
      fail(404, "Feedback not found.");
    }

    if (record.__v !== body.version) {
      fail(
        409,
        "This feedback changed. Refresh before saving again."
      );
    }

    const now = new Date();

    if (internalNotes !== undefined) {
      record.internalNotes = internalNotes;
    }

    if (
      managementResponse !== undefined &&
      managementResponse !== record.managementResponse
    ) {
      record.managementResponse = managementResponse;
      record.respondedBy = managementResponse
        ? req.user._id
        : null;
      record.respondedAt = managementResponse ? now : null;
    }

    if (has("status") && body.status !== record.status) {
      record.status = body.status;

      if (body.status === "new") {
        record.reviewedBy = null;
        record.reviewedAt = null;
        record.resolvedBy = null;
        record.resolvedAt = null;
      } else if (body.status === "reviewed") {
        if (!record.reviewedAt) {
          record.reviewedBy = req.user._id;
          record.reviewedAt = now;
        }

        record.resolvedBy = null;
        record.resolvedAt = null;
      } else {
        if (!record.reviewedAt) {
          record.reviewedBy = req.user._id;
          record.reviewedAt = now;
        }

        record.resolvedBy = req.user._id;
        record.resolvedAt = now;
      }
    }

    await record.save();

    await record.populate([
      { path: "hotel", select: "name code city" },
      { path: "room", select: "roomNumber roomType" },
      { path: "createdBy", select: "name" },
      { path: "respondedBy", select: "name" },
      { path: "reviewedBy", select: "name" },
      { path: "resolvedBy", select: "name" },
    ]);

    res.json({
      success: true,
      message: "Feedback updated successfully.",
      feedback: serializeFeedback(record, true),
    });
  })
);

module.exports = router;