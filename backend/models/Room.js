const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      required: [true, "Please select a hotel."],
      immutable: true,
    },

    roomNumber: {
      type: String,
      required: [true, "Room number is required."],
      trim: true,
      uppercase: true,
      minlength: 1,
      maxlength: 20,
    },

    floor: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "Ground",
    },

    roomType: {
      type: String,
      required: true,
      enum: [
        "standard",
        "deluxe",
        "executive",
        "suite",
        "presidential",
      ],
      default: "standard",
    },

    bedType: {
      type: String,
      enum: ["single", "double", "twin", "queen", "king"],
      default: "double",
    },

    numberOfBeds: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
      max: 10,
      validate: {
        validator: Number.isInteger,
        message: "Number of beds must be a whole number.",
      },
    },

    capacity: {
      type: Number,
      required: true,
      default: 2,
      min: 1,
      max: 20,
      validate: {
        validator: Number.isInteger,
        message: "Guest capacity must be a whole number.",
      },
    },

    // Uses the hotel's currency.
    // Example: PKR 12,500.00 = 1250000 paisa.
    pricePerNightMinor: {
      type: Number,
      required: [true, "Nightly room price is required."],
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: "Price must be a valid whole minor-unit amount.",
      },
    },

    // Physical room status; reservation dates determine availability.
    status: {
      type: String,
      enum: ["available", "occupied", "cleaning", "maintenance"],
      default: "available",
    },

    amenities: {
      type: [
        {
          type: String,
          trim: true,
          enum: [
            "wifi",
            "air_conditioning",
            "television",
            "minibar",
            "safe",
            "balcony",
            "sea_view",
            "bathtub",
            "work_desk",
            "tea_coffee",
            "room_service",
            "accessible",
          ],
        },
      ],
      default: [],
      validate: {
        validator(values) {
          return (
            values.length <= 12 &&
            new Set(values).size === values.length
          );
        },
        message: "Amenities must be unique, with a maximum of 12.",
      },
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
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

// Each hotel can have only one room with a given room number.
roomSchema.index(
  { hotel: 1, roomNumber: 1 },
  { unique: true }
);

roomSchema.index({
  hotel: 1,
  isActive: 1,
  status: 1,
});

module.exports = mongoose.model("Room", roomSchema);