const express = require("express");
const mongoose = require("mongoose");

const MaintenanceRequest = require("../models/MaintenanceRequest");
const Hotel = require("../models/Hotel");
const Room = require("../models/Room");
const User = require("../models/User");
const Reservation = require("../models/Reservation");
const HousekeepingTask = require("../models/HousekeepingTask");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const CATEGORIES = [
  "electrical",
  "plumbing",
  "air_conditioning",
  "furniture",
  "appliance",
  "internet",
  "other",
];

const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["reported", "in_progress", "resolved", "cancelled"];
const OPEN_STATUSES = ["reported", "in_progress"];

const TRANSACTION_OPTIONS = {
  readPreference: "primary",
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  maxCommitTimeMS: 10000,
};

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validId(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function readId(value, label) {
  if (!validId(value)) fail(`${label} is invalid.`);
  return value;
}

function checkBody(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("A JSON object is required.");
  }

  const unknown = Object.keys(body).filter(
    (key) => !allowed.includes(key)
  );

  if (unknown.length) {
    fail(`Unsupported fields: ${unknown.join(", ")}.`);
  }
}

function readText(value, label, min, max) {
  if (typeof value !== "string") fail(`${label} must be text.`);

  const result = value.trim();

  if (result.length < min || result.length > max) {
    fail(`${label} must contain ${min}-${max} characters.`);
  }

  return result;
}

function readChoice(value, choices, label) {
  if (typeof value !== "string" || !choices.includes(value)) {
    fail(`${label} is invalid.`);
  }

  return value;
}

function readPage(value, fallback, max) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > max) {
    fail(`Pagination value cannot exceed ${max}.`);
  }

  return number;
}

function populateRequest(query) {
  return query
    .populate("hotel", "name code city isActive")
    .populate("room", "roomNumber roomType status")
    .populate("assignedTo", "name role isActive")
    .populate("reportedBy", "name")
    .populate("resolvedBy", "name")
    .populate("cancelledBy", "name");
}

async function checkAssignee(id, hotel, session) {
  if (id === null) return;

  readId(id, "Staff ID");

  const member = await User.exists({
    _id: id,
    hotel,
    role: "maintenance",
    isActive: true,
  }).session(session);

  if (!member) {
    fail(
      "Choose active maintenance staff assigned to this hotel."
    );
  }
}

async function ensureRoomVacant(roomId, session) {
  const occupied = await Reservation.exists({
    room: roomId,
    status: "checked_in",
  }).session(session);

  if (occupied) {
    fail("A guest is still checked in to this room.", 409);
  }
}

async function ensureNoCleaningTask(roomId, session) {
  const cleaning = await HousekeepingTask.exists({
    room: roomId,
    status: { $in: ["pending", "in_progress"] },
  }).session(session);

  if (cleaning) {
    fail(
      "Complete or cancel the active housekeeping task before starting maintenance.",
      409
    );
  }
}

async function ensureNoOtherRepair(roomId, requestId, session) {
  const other = await MaintenanceRequest.exists({
    room: roomId,
    _id: { $ne: requestId },
    status: "in_progress",
  }).session(session);

  if (other) {
    fail("Another maintenance request is already in progress for this room.", 409);
  }
}

async function sendRequest(res, id, message, status = 200) {
  const request = await populateRequest(
    MaintenanceRequest.findById(id)
  ).lean();

  if (!request) fail("Maintenance request not found.", 404);

  return res.status(status).json({
    success: true,
    message,
    request,
  });
}

// This management router is currently for administrators.
router.use(protect, authorize("admin"));

router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");

  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const allowedOrigin =
      process.env.CLIENT_URL || "http://localhost:5173";

    const origin = req.get("origin");

    if (origin && origin !== allowedOrigin) {
      return res.status(403).json({
        success: false,
        message: "Origin is not allowed.",
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
      message: "Invalid maintenance request ID.",
    });
  }

  next();
});

// GET /api/maintenance
router.get("/", async (req, res, next) => {
  try {
    const page = readPage(req.query.page, 1, 10000);
    const limit = readPage(req.query.limit, 20, 100);
    const filter = {};

    if (req.query.hotel !== undefined) {
      filter.hotel = readId(req.query.hotel, "Hotel ID");
    }

    if (req.query.room !== undefined) {
      filter.room = readId(req.query.room, "Room ID");
    }

    if (req.query.assignedTo !== undefined) {
      filter.assignedTo = readId(req.query.assignedTo, "Staff ID");
    }

    if (req.query.status !== undefined) {
      filter.status = readChoice(req.query.status, STATUSES, "Status");
    }

    if (req.query.priority !== undefined) {
      filter.priority = readChoice(
        req.query.priority,
        PRIORITIES,
        "Priority"
      );
    }

    if (req.query.category !== undefined) {
      filter.category = readChoice(
        req.query.category,
        CATEGORIES,
        "Category"
      );
    }

    const [requests, total] = await Promise.all([
      populateRequest(
        MaintenanceRequest.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ).lean(),
      MaintenanceRequest.countDocuments(filter),
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

// GET /api/maintenance/:id
router.get("/:id", async (req, res, next) => {
  try {
    const request = await populateRequest(
      MaintenanceRequest.findById(req.params.id)
    ).lean();

    if (!request) fail("Maintenance request not found.", 404);

    res.json({ success: true, request });
  } catch (error) {
    next(error);
  }
});

// POST /api/maintenance
// Reporting an issue does not change room status.
router.post("/", async (req, res, next) => {
  try {
    checkBody(req.body, [
      "hotel",
      "room",
      "location",
      "title",
      "description",
      "category",
      "priority",
      "assignedTo",
    ]);

    const hotelId = readId(req.body.hotel, "Hotel ID");

    const roomId =
      req.body.room === undefined || req.body.room === null
        ? null
        : readId(req.body.room, "Room ID");

    const assignedTo =
      req.body.assignedTo === undefined || req.body.assignedTo === null
        ? null
        : readId(req.body.assignedTo, "Staff ID");

    const title = readText(req.body.title, "Title", 3, 150);
    const description = readText(
      req.body.description,
      "Description",
      5,
      3000
    );

    const category = readChoice(
      req.body.category ?? "other",
      CATEGORIES,
      "Category"
    );

    const priority = readChoice(
      req.body.priority ?? "normal",
      PRIORITIES,
      "Priority"
    );

    let location = "";

    if (req.body.location !== undefined) {
      location = readText(req.body.location, "Location", 0, 200);
    }

    if (!roomId && !location) {
      fail("Enter the common-area location, such as Lobby or Elevator.");
    }

    await MaintenanceRequest.init();

    const requestId = await mongoose.connection.transaction(
      async (session) => {
        const hotel = await Hotel.exists({
          _id: hotelId,
          isActive: true,
        }).session(session);

        if (!hotel) fail("Select an active hotel.");

        let room = null;

        if (roomId) {
          room = await Room.findOne({
            _id: roomId,
            hotel: hotelId,
            isActive: true,
          })
            .select("roomNumber")
            .session(session);

          if (!room) fail("Select an active room belonging to this hotel.");
        }

        await checkAssignee(assignedTo, hotelId, session);

        const [request] = await MaintenanceRequest.create(
          [
            {
              hotel: hotelId,
              room: roomId,
              location: location || `Room ${room.roomNumber}`,
              title,
              description,
              category,
              priority,
              assignedTo,
              reportedBy: req.user._id,
              status: "reported",
            },
          ],
          { session }
        );

        return request._id;
      },
      TRANSACTION_OPTIONS
    );

    await sendRequest(
      res,
      requestId,
      "Maintenance issue reported. Room status is unchanged.",
      201
    );
  } catch (error) {
    next(error);
  }
});

// PATCH /api/maintenance/:id/assign
// Body: { "assignedTo": "staffId" } or { "assignedTo": null }
router.patch("/:id/assign", async (req, res, next) => {
  try {
    checkBody(req.body, ["assignedTo"]);

    if (!Object.prototype.hasOwnProperty.call(req.body, "assignedTo")) {
      fail("assignedTo is required. Use null to remove the assignment.");
    }

    const assignedTo =
      req.body.assignedTo === null
        ? null
        : readId(req.body.assignedTo, "Staff ID");

    await mongoose.connection.transaction(async (session) => {
      const request = await MaintenanceRequest.findById(
        req.params.id
      ).session(session);

      if (!request) fail("Maintenance request not found.", 404);

      if (!OPEN_STATUSES.includes(request.status)) {
        fail("Only open requests can be assigned.", 409);
      }

      await checkAssignee(assignedTo, request.hotel, session);

      const updated = await MaintenanceRequest.findOneAndUpdate(
        {
          _id: request._id,
          status: request.status,
          __v: request.__v,
        },
        {
          $set: { assignedTo },
          $inc: { __v: 1 },
        },
        {
          new: true,
          runValidators: true,
          session,
        }
      );

      if (!updated) {
        fail("The request changed. Refresh and try again.", 409);
      }
    }, TRANSACTION_OPTIONS);

    await sendRequest(
      res,
      req.params.id,
      assignedTo
        ? "Maintenance staff assigned successfully."
        : "Staff assignment removed."
    );
  } catch (error) {
    next(error);
  }
});

// PATCH /api/maintenance/:id/start
// Body: {}
//
// PATCH /api/maintenance/:id/resolve
// Body: { "resolutionNotes": "Repair details..." }
//
// PATCH /api/maintenance/:id/cancel
// Body: { "reason": "Reason..." }
router.patch("/:id/:action", async (req, res, next) => {
  try {
    const { id, action } = req.params;

    if (!["start", "resolve", "cancel"].includes(action)) {
      fail("Route not found.", 404);
    }

    checkBody(
      req.body,
      action === "resolve"
        ? ["resolutionNotes"]
        : action === "cancel"
        ? ["reason"]
        : []
    );

    let notes = "";

    if (action === "resolve") {
      notes = readText(
        req.body.resolutionNotes,
        "Resolution notes",
        5,
        3000
      );
    }

    if (action === "cancel") {
      notes = readText(req.body.reason, "Cancellation reason", 3, 500);
    }

    const targetStatus =
      action === "start"
        ? "in_progress"
        : action === "resolve"
        ? "resolved"
        : "cancelled";

    const outcome = await mongoose.connection.transaction(
      async (session) => {
        const request = await MaintenanceRequest.findById(id).session(
          session
        );

        if (!request) fail("Maintenance request not found.", 404);

        if (request.status === targetStatus) {
          return { alreadyDone: true, releasedRoom: false };
        }

        if (!OPEN_STATUSES.includes(request.status)) {
          fail("This request is already closed.", 409);
        }

        if (action === "start" && request.status !== "reported") {
          fail("Only reported requests can be started.", 409);
        }

        if (action === "resolve" && request.status !== "in_progress") {
          fail("Start the maintenance work before resolving it.", 409);
        }

        const now = new Date();
        const changes = { status: targetStatus };
        let releasedRoom = false;

        if (action === "start") {
          const hotel = await Hotel.exists({
            _id: request.hotel,
            isActive: true,
          }).session(session);

          if (!hotel) fail("This hotel is inactive or unavailable.", 409);

          if (request.assignedTo) {
            await checkAssignee(
              String(request.assignedTo),
              request.hotel,
              session
            );
          }

          if (request.room) {
            // Updating the room serializes competing room operations.
            const room = await Room.findOneAndUpdate(
              {
                _id: request.room,
                hotel: request.hotel,
                isActive: true,
                status: { $in: ["available", "cleaning", "maintenance"] },
              },
              {
                $set: { status: "maintenance" },
                $inc: { __v: 1 },
              },
              {
                new: true,
                runValidators: true,
                session,
              }
            );

            if (!room) {
              fail(
                "This room is occupied, inactive or unavailable. Check out any guest before starting repairs.",
                409
              );
            }

            await ensureRoomVacant(request.room, session);
            await ensureNoCleaningTask(request.room, session);
            await ensureNoOtherRepair(request.room, request._id, session);
          }

          changes.startedAt = now;
        }

        if (
          request.room &&
          request.status === "in_progress" &&
          ["resolve", "cancel"].includes(action)
        ) {
          const room = await Room.findOneAndUpdate(
            {
              _id: request.room,
              hotel: request.hotel,
              status: "maintenance",
            },
            {
              $set: { status: "cleaning" },
              $inc: { __v: 1 },
            },
            {
              new: true,
              runValidators: true,
              session,
            }
          );

          if (!room) {
            fail(
              "The room is no longer marked maintenance. Refresh and review its status.",
              409
            );
          }

          await ensureRoomVacant(request.room, session);
          await ensureNoOtherRepair(request.room, request._id, session);

          releasedRoom = true;
        }

        if (action === "resolve") {
          changes.resolvedAt = now;
          changes.resolvedBy = req.user._id;
          changes.resolutionNotes = notes;
        }

        if (action === "cancel") {
          changes.cancelledAt = now;
          changes.cancelledBy = req.user._id;
          changes.cancellationReason = notes;
        }

        const updated = await MaintenanceRequest.findOneAndUpdate(
          {
            _id: request._id,
            status: request.status,
            __v: request.__v,
          },
          {
            $set: changes,
            $inc: { __v: 1 },
          },
          {
            new: true,
            runValidators: true,
            session,
          }
        );

        if (!updated) {
          fail("The request changed. Refresh and try again.", 409);
        }

        return { alreadyDone: false, releasedRoom };
      },
      TRANSACTION_OPTIONS
    );

    let message;

    if (outcome.alreadyDone) {
      message = "This action has already been completed.";
    } else if (action === "start") {
      message = "Maintenance work started.";
    } else if (action === "resolve") {
      message = "Maintenance request resolved.";
    } else {
      message = "Maintenance request cancelled.";
    }

    if (outcome.releasedRoom) {
      message +=
        " The room is marked cleaning. Create and complete a housekeeping task before making it available.";
    }

    await sendRequest(res, id, message);
  } catch (error) {
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

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
      message: "An invalid value or ID was provided.",
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A conflicting record already exists.",
    });
  }

  next(error);
});

module.exports = router;