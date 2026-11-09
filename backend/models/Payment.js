const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 50,
      immutable: true,
    },

    // Same payment request dobara aaye to duplicate payment na bane.
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 16,
      maxlength: 128,
      immutable: true,
    },

    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
      immutable: true,
    },

    reservation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      immutable: true,
    },

    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: true,
      immutable: true,
    },

    currency: {
      type: String,
      enum: ["PKR", "USD", "EUR", "GBP", "AED"],
      required: true,
      immutable: true,
    },

    // Smallest currency unit: PKR 1,500.00 = 150000.
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: Number.isSafeInteger,
        message: "Payment amount must be a safe whole number.",
      },
    },

    method: {
      type: String,
      enum: ["cash", "card", "bank_transfer"],
      required: true,
      immutable: true,
    },

    // External receipt/transaction reference only.
    // Never store card numbers, CVV, PIN or banking passwords.
    reference: {
      type: String,
      trim: true,
      maxlength: 150,
      default: "",
      immutable: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
      immutable: true,
    },

    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },

    recordedBy: {
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

paymentSchema.index({ invoice: 1, receivedAt: -1 });
paymentSchema.index({ hotel: 1, receivedAt: -1 });
paymentSchema.index({ reservation: 1, receivedAt: -1 });

module.exports =
  mongoose.models.Payment || mongoose.model("Payment", paymentSchema);