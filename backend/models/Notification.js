const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // Each notification belongs to one user.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
      immutable: true,
    },

    type: {
      type: String,
      enum: [
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
      ],
      required: true,
      immutable: true,
    },

    title: {
      type: String,
      required: [true, "Notification title is required."],
      trim: true,
      minlength: 3,
      maxlength: 150,
      immutable: true,
    },

    message: {
      type: String,
      required: [true, "Notification message is required."],
      trim: true,
      minlength: 3,
      maxlength: 2000,
      immutable: true,
    },

    priority: {
      type: String,
      enum: ["normal", "high", "urgent"],
      default: "normal",
      immutable: true,
    },

    // Optional related record for navigation.
    // Opening a record must still pass that module's authorization.
    relatedModel: {
      type: String,
      enum: [
        "Reservation",
        "HousekeepingTask",
        "MaintenanceRequest",
        "ServiceRequest",
        "Invoice",
        "Feedback",
      ],
      default: null,
      immutable: true,
    },

    relatedId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "relatedModel",
      default: null,
      immutable: true,
    },

    // Null means unread.
    readAt: {
      type: Date,
      default: null,
    },

    // Hide from the active inbox without deleting the record.
    archivedAt: {
      type: Date,
      default: null,
    },

    // Null for automatically generated system notifications.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    // Optional stable event key to prevent duplicate delivery.
    // Leave absent when no deduplication key is needed.
    eventKey: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 200,
      immutable: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

// Inbox listing.
notificationSchema.index({
  recipient: 1,
  archivedAt: 1,
  createdAt: -1,
});

// Unread count and unread filtering.
notificationSchema.index({
  recipient: 1,
  archivedAt: 1,
  readAt: 1,
  createdAt: -1,
});

// The same event can notify many users, but each user receives it once.
notificationSchema.index(
  {
    recipient: 1,
    eventKey: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      eventKey: { $type: "string" },
    },
  }
);

notificationSchema.pre("validate", function () {
  const hasModel = this.relatedModel != null;
  const hasId = this.relatedId != null;

  if (hasModel !== hasId) {
    this.invalidate(
      "relatedId",
      "Provide both relatedModel and relatedId, or leave both empty."
    );
  }
});

module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);