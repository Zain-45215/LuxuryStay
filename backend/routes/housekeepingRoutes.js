const express = require("express");
const mongoose = require("mongoose");

const HousekeepingTask = require("../models/HousekeepingTask");
const Room = require("../models/Room");
const Hotel = require("../models/Hotel");
const User = require("../models/User");
const Reservation = require("../models/Reservation");

const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const ACTIVE_STATUSES = ["pending", "in_progress"];
const ALL_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

const TASK_TYPES = [
  "checkout_cleaning",
  "regular_cleaning",
  "deep_cleaning",
];

const PRIORITIES = ["low", "normal", "high"];

const transactionOptions = {
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
  return typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value);
}

function checkBody(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("Send a JSON object.");
  }

  const unknown = Object.keys(body).filter(
    (key) => !allowedFields.includes(key)
  );

  if (unknown.length) {
    fail(`Unsupported fields: ${unknown.join(", ")}`);
  }
}

function readText(value, name, maxLength, required = false) {
  if (value === undefined) value = "";

  if (typeof value !== "string") {
    fail(`${name} must be text.`);
  }

  const text = value.trim();

  if (required && !text) {
    fail(`${name} is required.`);
  }

  if (text.length > maxLength) {
    fail(`${name} must not exceed ${maxLength} characters.`);
  }

  return text;
}

function pageNumber(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    fail("Invalid pagination value.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    fail(`Pagination value must not exceed ${maximum}.`);
  }

  return number;
}

function populateTask(query) {
  return query
    .populate("hotel", "name code city")
    .populate("room", "roomNumber roomType status")
    .populate("assignedTo", "name role")
    .populate("completedBy", "name")
    .populate("createdBy", "name");
}

async function checkAssignee(id, hotelId, session) {
  if (!validId(id)) {
    fail("Invalid staff ID.");
  }

  const staff = await User.findOne({
    _id: id,
    role: "housekeeping",
    isActive: true,
    hotel: hotelId,
  })
    .session(session)
    .lean();

  if (!staff) {
    fail(
      "Choose an active housekeeping staff member assigned to this hotel."
    );
  }
}

async function ensureNoGuest(roomId, session) {
  const occupied = await Reservation.exists({
    room: roomId,
    status: "checked_in",
  }).session(session);

  if (occupied) {
    fail("This room still has a checked-in guest.", 409);
  }
}

// Authentication and admin access.
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
      message: "Invalid housekeeping task ID.",
    });
  }

  next();
});

// GET /api/housekeeping
// Filters: hotel, room, status, page, limit.
router.get("/", async (req, res, next) => {
  try {
    const filter = {};
    const page = pageNumber(req.query.page, 1, 10000);
    const limit = pageNumber(req.query.limit, 20, 100);

    for (const field of ["hotel", "room"]) {
      if (req.query[field] !== undefined) {
        if (!validId(req.query[field])) {
          fail(`Invalid ${field} ID.`);
        }

        filter[field] = req.query[field];
      }
    }

    if (req.query.status !== undefined) {
      if (!ALL_STATUSES.includes(req.query.status)) {
        fail("Invalid housekeeping status.");
      }

      filter.status = req.query.status;
    }

    const [tasks, total] = await Promise.all([
      populateTask(
        HousekeepingTask.find(filter)
          .sort({ scheduledFor: 1, _id: 1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ).lean(),
      HousekeepingTask.countDocuments(filter),
    ]);

    res.json({
      success: true,
      tasks,
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

// GET /api/housekeeping/:id
router.get("/:id", async (req, res, next) => {
  try {
    const task = await populateTask(
      HousekeepingTask.findById(req.params.id)
    ).lean();

    if (!task) {
      fail("Housekeeping task not found.", 404);
    }

    res.json({ success: true, task });
  } catch (error) {
    next(error);
  }
});

// POST /api/housekeeping
// Creating a task immediately marks the vacant room as cleaning.
// scheduledFor is the target cleaning time, not a future room-status timer.
router.post("/", async (req, res, next) => {
  try {
    checkBody(req.body, [
      "hotel",
      "room",
      "taskType",
      "priority",
      "assignedTo",
      "scheduledFor",
      "instructions",
    ]);

    const {
      hotel,
      room,
      taskType = "checkout_cleaning",
      priority = "normal",
    } = req.body;

    if (!validId(hotel) || !validId(room)) {
      fail("Valid hotel and room IDs are required.");
    }

    if (!TASK_TYPES.includes(taskType)) {
      fail("Invalid cleaning task type.");
    }

    if (!PRIORITIES.includes(priority)) {
      fail("Invalid task priority.");
    }

    const instructions = readText(
      req.body.instructions,
      "Instructions",
      2000
    );

    const assignedTo = req.body.assignedTo ?? null;

    if (assignedTo !== null && !validId(assignedTo)) {
      fail("Assigned staff must be a valid ID or null.");
    }

    let scheduledFor = new Date();

    if (req.body.scheduledFor !== undefined) {
      if (
        typeof req.body.scheduledFor !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(
          req.body.scheduledFor
        )
      ) {
        fail("Scheduled time must include a timezone.");
      }

      scheduledFor = new Date(req.body.scheduledFor);

      if (Number.isNaN(scheduledFor.getTime())) {
        fail("Invalid scheduled time.");
      }
    }

    // Prepare the collection before starting a transaction.
    await HousekeepingTask.init();

    const result = await mongoose.connection.transaction(
      async (session) => {
        const property = await Hotel.findOne({
          _id: hotel,
          isActive: true,
        })
          .session(session)
          .lean();

        if (!property) {
          fail("Active hotel not found.", 404);
        }

        // Every task creation writes the same room document.
        // This serializes concurrent task creation for this room.
        const updatedRoom = await Room.findOneAndUpdate(
          {
            _id: room,
            hotel,
            isActive: true,
            status: { $in: ["available", "cleaning"] },
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

        if (!updatedRoom) {
          fail(
            "Choose an active, vacant room with available or cleaning status.",
            409
          );
        }

        await ensureNoGuest(room, session);

        const existingTask = await HousekeepingTask.exists({
          room,
          status: { $in: ACTIVE_STATUSES },
        }).session(session);

        if (existingTask) {
          fail("This room already has an active cleaning task.", 409);
        }

        if (assignedTo) {
          await checkAssignee(assignedTo, hotel, session);
        }

        const [task] = await HousekeepingTask.create(
          [
            {
              hotel,
              room,
              taskType,
              priority,
              assignedTo,
              scheduledFor,
              instructions,
              status: "pending",
              createdBy: req.user._id,
            },
          ],
          { session }
        );

        return {
          task: task.toObject(),
          room: updatedRoom,
        };
      },
      transactionOptions
    );

    res.status(201).json({
      success: true,
      message: "Cleaning task created. Room marked as cleaning.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/housekeeping/:id/assign
// Body: { "assignedTo": "staffId" } or { "assignedTo": null }
router.patch("/:id/assign", async (req, res, next) => {
  try {
    checkBody(req.body, ["assignedTo"]);

    if (req.body.assignedTo === undefined) {
      fail("assignedTo is required. Use null to remove an assignment.");
    }

    const assignedTo = req.body.assignedTo;

    const task = await mongoose.connection.transaction(
      async (session) => {
        const current = await HousekeepingTask.findById(req.params.id)
          .session(session)
          .lean();

        if (!current) {
          fail("Housekeeping task not found.", 404);
        }

        if (!ACTIVE_STATUSES.includes(current.status)) {
          fail("Only active tasks can be assigned.", 409);
        }

        if (assignedTo !== null) {
          await checkAssignee(assignedTo, current.hotel, session);
        }

        const updated = await HousekeepingTask.findOneAndUpdate(
          {
            _id: current._id,
            status: { $in: ACTIVE_STATUSES },
          },
          {
            $set: { assignedTo },
            $inc: { __v: 1 },
          },
          { session, new: true, runValidators: true }
        ).lean();

        if (!updated) {
          fail("Task changed. Refresh and try again.", 409);
        }

        return updated;
      },
      transactionOptions
    );

    res.json({
      success: true,
      message: assignedTo
        ? "Staff member assigned."
        : "Staff assignment removed.",
      task,
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/housekeeping/:id/start
// PATCH /api/housekeeping/:id/complete
// PATCH /api/housekeeping/:id/cancel
router.patch("/:id/:action", async (req, res, next) => {
  try {
    const { action } = req.params;

    if (!["start", "complete", "cancel"].includes(action)) {
      fail("Route not found.", 404);
    }

    const allowedFields =
      action === "complete"
        ? ["completionNotes"]
        : action === "cancel"
          ? ["reason"]
          : [];

    checkBody(req.body, allowedFields);

    const completionNotes =
      action === "complete"
        ? readText(req.body.completionNotes, "Completion notes", 2000)
        : "";

    const cancellationReason =
      action === "cancel"
        ? readText(req.body.reason, "Cancellation reason", 500, true)
        : "";

    const result = await mongoose.connection.transaction(
      async (session) => {
        const task = await HousekeepingTask.findById(req.params.id)
          .session(session)
          .lean();

        if (!task) {
          fail("Housekeeping task not found.", 404);
        }

        const targetStatus = {
          start: "in_progress",
          complete: "completed",
          cancel: "cancelled",
        }[action];

        if (task.status === targetStatus) {
          return {
            task,
            alreadyCompleted: true,
          };
        }

        if (!ACTIVE_STATUSES.includes(task.status)) {
          fail("This task has already been completed or cancelled.", 409);
        }

        if (action === "complete" && task.status !== "in_progress") {
          fail("Start the cleaning task before completing it.", 409);
        }

        // Cancellation leaves room status unchanged.
        // Starting/completing requires a room currently marked cleaning.
        const roomFilter = {
          _id: task.room,
          hotel: task.hotel,
        };

        if (action !== "cancel") {
          roomFilter.status = "cleaning";
        }

        const roomUpdate = {
          $inc: { __v: 1 },
        };

        if (action === "complete") {
          roomUpdate.$set = { status: "available" };
        }

        const room = await Room.findOneAndUpdate(
          roomFilter,
          roomUpdate,
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!room) {
          fail(
            "Room is missing or its status no longer allows this action.",
            409
          );
        }

        if (action !== "cancel") {
          await ensureNoGuest(task.room, session);

          const otherTask = await HousekeepingTask.exists({
            _id: { $ne: task._id },
            room: task.room,
            status: { $in: ACTIVE_STATUSES },
          }).session(session);

          if (otherTask) {
            fail(
              "Another active task exists for this room. Resolve it first.",
              409
            );
          }
        }

        const changes = { status: targetStatus };

        if (action === "start") {
          changes.startedAt = new Date();
        }

        if (action === "complete") {
          changes.completedAt = new Date();
          changes.completedBy = req.user._id;
          changes.completionNotes = completionNotes;
        }

        if (action === "cancel") {
          changes.cancelledAt = new Date();
          changes.cancelledBy = req.user._id;
          changes.cancellationReason = cancellationReason;
        }

        const updatedTask = await HousekeepingTask.findOneAndUpdate(
          {
            _id: task._id,
            status: task.status,
          },
          {
            $set: changes,
            $inc: { __v: 1 },
          },
          {
            session,
            new: true,
            runValidators: true,
          }
        ).lean();

        if (!updatedTask) {
          fail("Task changed. Refresh and try again.", 409);
        }

        return {
          task: updatedTask,
          room,
          alreadyCompleted: false,
        };
      },
      transactionOptions
    );

    const messages = {
      start: "Cleaning started.",
      complete: "Cleaning completed. Room marked as available.",
      cancel: "Task cancelled. Room status has not changed.",
    };

    res.json({
      success: true,
      message: result.alreadyCompleted
        ? "This action was already completed."
        : messages[action],
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

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