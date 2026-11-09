const mongoose = require("mongoose");

const serviceRequestSchema = new mongoose.Schema(
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

    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      immutable: true,
    },

    guestUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    guestName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      immutable: true,
    },

    serviceType: {
      type: String,
      enum: [
        "room_service",
        "laundry",
        "wake_up_call",
        "transportation",
        "extra_amenities",
        "other",
      ],
      required: true,
    },

    title: {
      type: String,
      required: [true, "Service title is required."],
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    quantity: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 100,
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number.",
      },
    },

    requestedFor: {
      type: Date,
      default: null,
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

    currency: {
      type: String,
      enum: ["PKR", "USD", "EUR", "GBP", "AED"],
      required: true,
      immutable: true,
    },

    // Total charge before tax for all quantities.
    // PKR 500.00 = 50000 paisa.
    // Null = price not set; zero = free service.
    chargeMinor: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator(value) {
          return (
            value === null ||
            (Number.isSafeInteger(value) && value >= 0)
          );
        },
        message: "Service charge must be a valid non-negative integer.",
      },
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

    completionNotes: {
      type: String,
      trim: true,
      maxlength: 2000,
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

serviceRequestSchema.index({
  hotel: 1,
  status: 1,
  createdAt: -1,
});

serviceRequestSchema.index({
  reservation: 1,
  status: 1,
  createdAt: -1,
});

serviceRequestSchema.index({
  assignedTo: 1,
  status: 1,
  requestedFor: 1,
});

serviceRequestSchema.index({
  guestUser: 1,
  createdAt: -1,
});

module.exports =
  mongoose.models.ServiceRequest ||
  mongoose.model("ServiceRequest", serviceRequestSchema);