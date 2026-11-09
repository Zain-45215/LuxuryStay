const mongoose = require("mongoose");

const maintenanceRequestSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: [true, "Hotel is required."],
      immutable: true,
    },

    // Null for common-area issues such as the lobby or elevator.
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
      immutable: true,
    },

    location: {
      type: String,
      required: [true, "Location is required."],
      trim: true,
      maxlength: 200,
    },

    title: {
      type: String,
      required: [true, "Issue title is required."],
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    description: {
      type: String,
      required: [true, "Issue description is required."],
      trim: true,
      minlength: 5,
      maxlength: 3000,
    },

    category: {
      type: String,
      enum: [
        "electrical",
        "plumbing",
        "air_conditioning",
        "furniture",
        "appliance",
        "internet",
        "other",
      ],
      default: "other",
      required: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      required: true,
    },

    status: {
      type: String,
      enum: ["reported", "in_progress", "resolved", "cancelled"],
      default: "reported",
      required: true,
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolutionNotes: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
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
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

maintenanceRequestSchema.index({
  hotel: 1,
  status: 1,
  createdAt: -1,
});

maintenanceRequestSchema.index({
  room: 1,
  status: 1,
});

maintenanceRequestSchema.index({
  assignedTo: 1,
  status: 1,
  createdAt: -1,
});

maintenanceRequestSchema.index({
  reportedBy: 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.MaintenanceRequest ||
  mongoose.model("MaintenanceRequest", maintenanceRequestSchema);