const express = require("express");
const mongoose = require("mongoose");

const ServiceRequest = require("../models/ServiceRequest");
const Reservation = require("../models/Reservation");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const User = require("../models/User");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const SERVICE_TYPES = [
  "room_service",
  "laundry",
  "wake_up_call",
  "transportation",
  "extra_amenities",
  "other",
];

const PRIORITIES = ["low", "normal", "high"];
const STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

const STAFF_ROLES = [
  "manager",
  "receptionist",
  "housekeeping",
];

router.use(protect, authorize("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const origin = req.get("Origin");
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    if (origin && origin !== allowedOrigin) {
      return next(fail(403, "Request origin is not allowed."));
    }

    if (!req.is("application/json")) {
      return next(fail(415, "Send the request as application/json."));
    }
  }

  next();
});

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readId(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-fA-F0-9]{24}$/.test(value)
  ) {
    throw fail(400, `${label} is invalid.`);
  }

  return value;
}

function readOptionalId(value, label) {
  if (value === undefined || value === null) return null;
  return readId(value, label);
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

function readChoice(value, choices, label) {
  if (!choices.includes(value)) {
    throw fail(400, `${label} is invalid.`);
  }

  return value;
}

function readCharge(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw fail(
      400,
      "Service charge must be a non-negative integer in minor units."
    );
  }

  return value;
}

function readPage(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value)
  ) {
    throw fail(400, "Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    throw fail(
      400,
      `Pagination value must not exceed ${maximum}.`
    );
  }

  return number;
}

function checkBody(body, allowed, required = []) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw fail(400, "A JSON object is required.");
  }

  if (
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    throw fail(400, "The request contains unsupported fields.");
  }

  for (const key of required) {
    if (!Object.hasOwn(body, key)) {
      throw fail(400, `${key} is required.`);
    }
  }
}

function readRequestedFor(value) {
  if (value === undefined || value === null) return null;

  // Require an ISO timestamp with a timezone.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    throw fail(
      400,
      "Requested time must be an ISO timestamp with a timezone."
    );
  }

  const date = new Date(value);

  if (
    Number.isNaN(date.getTime()) ||
    date.getTime() <= Date.now()
  ) {
    throw fail(400, "Requested time must be in the future.");
  }

  return date;
}

function populateRequest(query) {
  return query
    .populate("hotel", "name code city")
    .populate("room", "roomNumber roomType status")
    .populate(
      "reservation",
      "bookingReference guestName status checkInDate checkOutDate"
    )
    .populate("assignedTo", "name role isActive")
    .populate("createdBy", "name")
    .populate("completedBy", "name")
    .populate("cancelledBy", "name");
}

async function validateAssignee(id, hotel, session) {
  if (!id) return;

  const staff = await User.findOne({
    _id: id,
    hotel,
    role: { $in: STAFF_ROLES },
    isActive: true,
  })
    .select("_id")
    .session(session)
    .lean();

  if (!staff) {
    throw fail(
      400,
      "Choose an active manager, receptionist or housekeeping employee from this hotel."
    );
  }
}

// Writing to the reservation also serializes this operation
// against a concurrent check-out transaction.
async function lockCheckedInReservation(id, session) {
  const reservation = await Reservation.findOneAndUpdate(
    {
      _id: id,
      status: "checked_in",
    },
    {
      $inc: { __v: 1 },
    },
    {
      new: true,
      session,
    }
  ).lean();

  if (!reservation) {
    throw fail(
      409,
      "This operation requires a currently checked-in reservation."
    );
  }

  return reservation;
}

async function getRequest(id) {
  return populateRequest(ServiceRequest.findById(id)).lean();
}

router.param("id", (req, res, next, id) => {
  try {
    readId(id, "Service request ID");
    next();
  } catch (error) {
    next(error);
  }
});

// GET /api/services
router.get("/", async (req, res, next) => {
  try {
    const page = readPage(req.query.page, 1, 10000);
    const limit = readPage(req.query.limit, 20, 100);

    const filter = {};

    for (const key of [
      "hotel",
      "room",
      "reservation",
      "assignedTo",
    ]) {
      if (req.query[key] !== undefined) {
        filter[key] = readId(req.query[key], key);
      }
    }

    if (req.query.status !== undefined) {
      filter.status = readChoice(
        req.query.status,
        STATUSES,
        "Status"
      );
    }

    if (req.query.priority !== undefined) {
      filter.priority = readChoice(
        req.query.priority,
        PRIORITIES,
        "Priority"
      );
    }

    if (req.query.serviceType !== undefined) {
      filter.serviceType = readChoice(
        req.query.serviceType,
        SERVICE_TYPES,
        "Service type"
      );
    }

    const [requests, total] = await Promise.all([
      populateRequest(
        ServiceRequest.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ).lean(),

      ServiceRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      requests,
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

// GET /api/services/:id
router.get("/:id", async (req, res, next) => {
  try {
    const request = await getRequest(req.params.id);

    if (!request) {
      throw fail(404, "Service request not found.");
    }

    res.json({ success: true, request });
  } catch (error) {
    next(error);
  }
});

// POST /api/services
router.post("/", async (req, res, next) => {
  try {
    checkBody(
      req.body,
      [
        "reservation",
        "serviceType",
        "title",
        "description",
        "quantity",
        "requestedFor",
        "priority",
        "assignedTo",
        "chargeMinor",
      ],
      ["reservation", "serviceType", "title"]
    );

    const reservationId = readId(
      req.body.reservation,
      "Reservation"
    );

    const serviceType = readChoice(
      req.body.serviceType,
      SERVICE_TYPES,
      "Service type"
    );

    const title = readText(req.body.title, "Title", 3, 150);

    const description = readText(
      req.body.description === undefined
        ? ""
        : req.body.description,
      "Description",
      0,
      2000
    );

    const quantity =
      req.body.quantity === undefined ? 1 : req.body.quantity;

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      throw fail(400, "Quantity must be between 1 and 100.");
    }

    const priority = readChoice(
      req.body.priority === undefined
        ? "normal"
        : req.body.priority,
      PRIORITIES,
      "Priority"
    );

    const assignedTo = readOptionalId(
      req.body.assignedTo,
      "Assigned employee"
    );

    const requestedFor = readRequestedFor(req.body.requestedFor);

    if (serviceType === "wake_up_call" && !requestedFor) {
      throw fail(400, "Choose a time for the wake-up call.");
    }

    const chargeMinor =
      req.body.chargeMinor === undefined ||
      req.body.chargeMinor === null
        ? null
        : readCharge(req.body.chargeMinor);

    await ServiceRequest.init();

    const requestId = new mongoose.Types.ObjectId();

    await mongoose.connection.transaction(async (session) => {
      const reservation = await lockCheckedInReservation(
        reservationId,
        session
      );

      const hotel = await Hotel.findOne({
        _id: reservation.hotel,
        isActive: true,
      })
        .select("_id")
        .session(session)
        .lean();

      if (!hotel) {
        throw fail(409, "The hotel is not active.");
      }

      const room = await Room.findOne({
        _id: reservation.room,
        hotel: reservation.hotel,
        status: "occupied",
        isActive: true,
      })
        .select("_id")
        .session(session)
        .lean();

      if (!room) {
        throw fail(
          409,
          "The reservation does not have an active occupied room."
        );
      }

      await validateAssignee(
        assignedTo,
        reservation.hotel,
        session
      );

      await ServiceRequest.create(
        [
          {
            _id: requestId,
            hotel: reservation.hotel,
            room: reservation.room,
            reservation: reservation._id,
            guestUser: reservation.guestUser || null,
            guestName: reservation.guestName,
            currency: reservation.currency,
            serviceType,
            title,
            description,
            quantity,
            requestedFor,
            priority,
            assignedTo,
            chargeMinor,
            status: "pending",
            createdBy: req.user._id,
          },
        ],
        { session }
      );
    });

    const request = await getRequest(requestId);

    res.status(201).json({
      success: true,
      message: "Service request created successfully.",
      request,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/services/:id/assign
// Body: { assignedTo: "staffId" } or { assignedTo: null }
router.patch("/:id/assign", async (req, res, next) => {
  try {
    checkBody(req.body, ["assignedTo"], ["assignedTo"]);

    const assignedTo = readOptionalId(
      req.body.assignedTo,
      "Assigned employee"
    );

    await mongoose.connection.transaction(async (session) => {
      const request = await ServiceRequest.findById(req.params.id)
        .session(session);

      if (!request) {
        throw fail(404, "Service request not found.");
      }

      if (!["pending", "in_progress"].includes(request.status)) {
        throw fail(409, "A closed request cannot be reassigned.");
      }

      await lockCheckedInReservation(
        request.reservation,
        session
      );

      await validateAssignee(assignedTo, request.hotel, session);

      request.assignedTo = assignedTo;
      await request.save({ session });
    });

    res.json({
      success: true,
      message: assignedTo
        ? "Service request assigned successfully."
        : "Staff assignment removed.",
      request: await getRequest(req.params.id),
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/services/:id/start
// PATCH /api/services/:id/complete
// PATCH /api/services/:id/cancel
router.patch("/:id/:action", async (req, res, next) => {
  try {
    const { action } = req.params;

    if (!["start", "complete", "cancel"].includes(action)) {
      throw fail(404, "Service action not found.");
    }

    let completionNotes = "";
    let cancellationReason = "";
    let completedCharge;

    if (action === "start") {
      checkBody(req.body, []);
    }

    if (action === "complete") {
      checkBody(req.body, ["completionNotes", "chargeMinor"]);

      completionNotes = readText(
        req.body.completionNotes === undefined
          ? ""
          : req.body.completionNotes,
        "Completion notes",
        0,
        2000
      );

      if (Object.hasOwn(req.body, "chargeMinor")) {
        completedCharge = readCharge(req.body.chargeMinor);
      }
    }

    if (action === "cancel") {
      checkBody(req.body, ["reason"], ["reason"]);

      cancellationReason = readText(
        req.body.reason,
        "Cancellation reason",
        3,
        500
      );
    }

    const targetStatus = {
      start: "in_progress",
      complete: "completed",
      cancel: "cancelled",
    }[action];

    await mongoose.connection.transaction(async (session) => {
      const request = await ServiceRequest.findById(req.params.id)
        .session(session);

      if (!request) {
        throw fail(404, "Service request not found.");
      }

      // Repeating an already completed transition is harmless.
      if (request.status === targetStatus) return;

      if (["completed", "cancelled"].includes(request.status)) {
        throw fail(409, "This service request is already closed.");
      }

      if (action === "start") {
        if (request.status !== "pending") {
          throw fail(409, "Only pending requests can be started.");
        }

        await lockCheckedInReservation(
          request.reservation,
          session
        );

        await validateAssignee(
          request.assignedTo,
          request.hotel,
          session
        );

        request.status = "in_progress";
        request.startedAt = new Date();
      }

      if (action === "complete") {
        if (request.status !== "in_progress") {
          throw fail(409, "Start the request before completing it.");
        }

        await lockCheckedInReservation(
          request.reservation,
          session
        );

        const finalCharge =
          completedCharge === undefined
            ? request.chargeMinor
            : completedCharge;

        if (finalCharge === null || finalCharge === undefined) {
          throw fail(
            400,
            "Set the total service charge before completing the request. Use zero for a free service."
          );
        }

        request.chargeMinor = readCharge(finalCharge);
        request.completionNotes = completionNotes;
        request.status = "completed";
        request.completedAt = new Date();
        request.completedBy = req.user._id;
      }

      if (action === "cancel") {
        // Cancellation remains available after check-out so
        // outstanding requests can be closed.
        request.status = "cancelled";
        request.cancelledAt = new Date();
        request.cancelledBy = req.user._id;
        request.cancellationReason = cancellationReason;
      }

      await request.save({ session });
    });

    const messages = {
      start: "Service request is in progress.",
      complete: "Service request completed successfully.",
      cancel: "Service request cancelled.",
    };

    res.json({
      success: true,
      message: messages[action],
      request: await getRequest(req.params.id),
    });
  } catch (error) {
    next(error);
  }
});

// Model and transaction errors.
router.use((error, req, res, next) => {
  if (error instanceof mongoose.Error.ValidationError) {
    return next(
      fail(400, "Please check the service request details.")
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return next(fail(400, "An invalid value was provided."));
  }

  if (
    error instanceof mongoose.Error.VersionError ||
    error.code === 112 ||
    error.hasErrorLabel?.("TransientTransactionError")
  ) {
    return next(
      fail(409, "This request changed. Refresh and try again.")
    );
  }

  if (error.code === 11000) {
    return next(fail(409, "This service request already exists."));
  }

  next(error);
});

module.exports = router;