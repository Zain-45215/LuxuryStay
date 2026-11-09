const mongoose = require("mongoose");

const hotelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Hotel name is required."],
      trim: true,
      minlength: 2,
      maxlength: 120,
    },

    code: {
      type: String,
      required: [true, "Hotel code is required."],
      unique: true,
      uppercase: true,
      trim: true,
      match: [
        /^[A-Z0-9-]{2,20}$/,
        "Hotel code must contain 2–20 letters, numbers or hyphens.",
      ],
    },

    address: {
      type: String,
      required: [true, "Address is required."],
      trim: true,
      maxlength: 300,
    },

    city: {
      type: String,
      required: [true, "City is required."],
      trim: true,
      maxlength: 100,
    },

    country: {
      type: String,
      required: [true, "Country is required."],
      trim: true,
      maxlength: 100,
      default: "Pakistan",
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 25,
      default: "",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: "",
      validate: {
        validator(value) {
          return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        },
        message: "Please enter a valid hotel email.",
      },
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // Set by the authenticated image upload endpoint.
    imageUrl: {
      type: String,
      default: "",
      maxlength: 200,
      validate: {
        validator(value) {
          return (
            value === "" ||
            /^\/api\/hotels\/images\/[a-f0-9-]{36}\.webp$/.test(value)
          );
        },
        message: "Invalid hotel image path.",
      },
    },

    currency: {
      type: String,
      enum: ["PKR", "USD", "EUR", "GBP", "AED"],
      default: "PKR",
    },

    timezone: {
      type: String,
      default: "Asia/Karachi",
      validate: {
        validator(value) {
          try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
          } catch {
            return false;
          }
        },
        message: "Please enter a valid timezone.",
      },
    },

    checkInTime: {
      type: String,
      default: "14:00",
      match: [
        /^([01]\d|2[0-3]):[0-5]\d$/,
        "Check-in time must use HH:mm format.",
      ],
    },

    checkOutTime: {
      type: String,
      default: "12:00",
      match: [
        /^([01]\d|2[0-3]):[0-5]\d$/,
        "Check-out time must use HH:mm format.",
      ],
    },

    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    isActive: {
      type: Boolean,
      default: true,
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
  }
);

hotelSchema.index({ city: 1, isActive: 1 });

module.exports =
  mongoose.models.Hotel || mongoose.model("Hotel", hotelSchema);