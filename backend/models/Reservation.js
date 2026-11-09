const mongoose = require("mongoose");

const DAY = 24 * 60 * 60 * 1000;

function isValidDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function moneyField() {
  return {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isSafeInteger,
      message: "Amount must be a valid whole minor-unit value.",
    },
  };
}

const reservationSchema = new mongoose.Schema(
  {
    bookingReference: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 40,
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

    guest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    guestName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: "",
      validate: {
        validator(value) {
          return (
            value === "" ||
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          );
        },
        message: "Please enter a valid guest email.",
      },
    },

    guestPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 25,
    },

    numberOfGuests: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
      validate: {
        validator: Number.isInteger,
        message: "Guest count must be a whole number.",
      },
    },

    checkInDate: {
      type: String,
      required: true,
      validate: {
        validator: isValidDate,
        message: "Check-in date must be a valid YYYY-MM-DD date.",
      },
    },

    checkOutDate: {
      type: String,
      required: true,
      validate: {
        validator: isValidDate,
        message: "Check-out date must be a valid YYYY-MM-DD date.",
      },
    },

    nights: {
      type: Number,
      required: true,
      min: 1,
      max: 365,
      validate: {
        validator: Number.isInteger,
        message: "Nights must be a whole number.",
      },
    },

    // Each occupied booking night; checkout day is excluded.
    reservedNights: {
      type: [String],
      default: [],
      select: false,
    },

    status: {
      type: String,
      enum: [
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      default: "confirmed",
      required: true,
    },

    currency: {
      type: String,
      enum: ["PKR", "USD", "EUR", "GBP", "AED"],
      required: true,
    },

    pricePerNightMinor: moneyField(),

    subtotalMinor: moneyField(),

    taxRateBps: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
      validate: {
        validator: Number.isInteger,
        message: "Tax basis points must be a whole number.",
      },
    },

    taxAmountMinor: moneyField(),

    totalMinor: moneyField(),

    specialRequests: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    checkedInAt: {
      type: Date,
      default: null,
    },

    checkedOutAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
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

// Calculate nights and the dates protected against double booking.
reservationSchema.pre("validate", function () {
  if (
    !isValidDate(this.checkInDate) ||
    !isValidDate(this.checkOutDate)
  ) {
    return;
  }

  const start = Date.parse(
    `${this.checkInDate}T00:00:00.000Z`
  );

  const end = Date.parse(
    `${this.checkOutDate}T00:00:00.000Z`
  );

  const nights = (end - start) / DAY;

  if (
    !Number.isInteger(nights) ||
    nights < 1 ||
    nights > 365
  ) {
    this.invalidate(
      "checkOutDate",
      "Check-out must be after check-in, with a maximum stay of 365 nights."
    );
    return;
  }

  this.nights = nights;

  if (
    this.status === "cancelled" ||
    this.status === "no_show"
  ) {
    this.reservedNights = [];
    return;
  }

  this.reservedNights = Array.from(
    { length: nights },
    (_, index) =>
      new Date(start + index * DAY)
        .toISOString()
        .slice(0, 10)
  );
});

// Prevent two reservations from holding the same room/night.
// Cancelled and no-show reservations have no reserved nights.
reservationSchema.index(
  {
    room: 1,
    reservedNights: 1,
  },
  {
    name: "unique_room_reserved_night",
    unique: true,
    partialFilterExpression: {
      "reservedNights.0": { $exists: true },
    },
  }
);

reservationSchema.index({
  hotel: 1,
  status: 1,
  checkInDate: 1,
});

reservationSchema.index({
  guest: 1,
  createdAt: -1,
});

// Export the Mongoose model, not the schema or an Express router.
module.exports = mongoose.model(
  "Reservation",
  reservationSchema
);