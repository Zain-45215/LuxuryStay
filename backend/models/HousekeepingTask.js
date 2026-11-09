const mongoose = require("mongoose");

const housekeepingTaskSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      immutable: true,
    },

    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      immutable: true,
    },

    taskType: {
      type: String,
      enum: ["checkout_cleaning", "regular_cleaning", "deep_cleaning"],
      default: "checkout_cleaning",
      required: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "cancelled"],
      default: "pending",
      required: true,
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    scheduledFor: {
      type: Date,
      required: true,
      default: Date.now,
    },

    instructions: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    completionNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    cancellationReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

// Hotel task lists and scheduled cleaning.
housekeepingTaskSchema.index({
  hotel: 1,
  status: 1,
  scheduledFor: 1,
});

// Cleaning history for a room.
housekeepingTaskSchema.index({
  room: 1,
  createdAt: -1,
});

// Tasks assigned to a staff member.
housekeepingTaskSchema.index({
  assignedTo: 1,
  status: 1,
  scheduledFor: 1,
});

module.exports =
  mongoose.models.HousekeepingTask ||
  mongoose.model("HousekeepingTask", housekeepingTaskSchema);