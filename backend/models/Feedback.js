const mongoose = require("mongoose");

function ratingField(required = false) {
  return {
    type: Number,
    required,
    min: [1, "Rating must be between 1 and 5."],
    max: [5, "Rating must be between 1 and 5."],
    ...(required ? {} : { default: null }),
    validate: {
      validator(value) {
        return value === null || Number.isInteger(value);
      },
      message: "Rating must be a whole number.",
    },
  };
}

const feedbackSchema = new mongoose.Schema(
  {
    // One feedback record per reservation.
    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      unique: true,
      immutable: true,
    },

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

    // Can be null for a guest booked directly by reception.
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

    bookingReference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      immutable: true,
    },

    overallRating: ratingField(true),

    cleanlinessRating: ratingField(),

    serviceRating: ratingField(),

    comfortRating: ratingField(),

    valueRating: ratingField(),

    title: {
      type: String,
      required: [true, "Feedback title is required."],
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    comment: {
      type: String,
      required: [true, "Feedback comment is required."],
      trim: true,
      minlength: 5,
      maxlength: 3000,
    },

    // Distinguishes guest submissions from feedback entered by staff.
    source: {
      type: String,
      enum: ["guest", "staff"],
      required: true,
      immutable: true,
    },

    status: {
      type: String,
      enum: ["new", "reviewed", "resolved"],
      default: "new",
      required: true,
    },

    // Internal management notes; exclude from guest-facing responses.
    internalNotes: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
      select: false,
    },

    managementResponse: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },

    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    respondedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
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

feedbackSchema.index({ hotel: 1, status: 1, createdAt: -1 });
feedbackSchema.index({ hotel: 1, overallRating: 1, createdAt: -1 });
feedbackSchema.index({ guestUser: 1, createdAt: -1 });

module.exports =
  mongoose.models.Feedback || mongoose.model("Feedback", feedbackSchema);