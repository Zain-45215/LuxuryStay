const mongoose = require("mongoose");

function moneyField(extra = {}) {
  return {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: Number.isSafeInteger,
      message: "Amount must be a valid integer in minor units.",
    },
    ...extra,
  };
}

const invoiceItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["room", "service"],
      required: true,
    },

    // Set for a completed service charge.
    serviceRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceRequest",
      default: null,
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    // Room item: number of nights.
    // Service item: requested quantity.
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 365,
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number.",
      },
    },

    // Total before tax for this entire line.
    subtotalMinor: moneyField(),

    // 100 basis points = 1%.
    taxRateBps: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
      validate: {
        validator: Number.isInteger,
        message: "Tax rate must be a whole number.",
      },
    },

    taxAmountMinor: moneyField(),
    totalMinor: moneyField(),
  },
  {
    _id: false,
  }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      trim: true,
      maxlength: 50,
    },

    // One final invoice per reservation.
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

    guestUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    // Snapshot fields preserve invoice details if profiles change.
    hotelName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      immutable: true,
    },

    hotelAddress: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
      immutable: true,
    },

    hotelPhone: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "",
      immutable: true,
    },

    guestName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      immutable: true,
    },

    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      default: "",
      immutable: true,
    },

    guestPhone: {
      type: String,
      trim: true,
      maxlength: 25,
      default: "",
      immutable: true,
    },

    bookingReference: {
      type: String,
      required: true,
      maxlength: 50,
      immutable: true,
    },

    roomNumber: {
      type: String,
      required: true,
      maxlength: 30,
      immutable: true,
    },

    checkInDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      immutable: true,
    },

    checkOutDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      immutable: true,
    },

    currency: {
      type: String,
      enum: ["PKR", "USD", "EUR", "GBP", "AED"],
      required: true,
      immutable: true,
    },

    items: {
      type: [invoiceItemSchema],
      required: true,
      immutable: true,
      validate: {
        validator(items) {
          return items.length >= 1 && items.length <= 500;
        },
        message: "An invoice must contain 1 to 500 items.",
      },
    },

    subtotalMinor: moneyField({ immutable: true }),
    taxAmountMinor: moneyField({ immutable: true }),
    totalMinor: moneyField({ immutable: true }),

    // Updated only by payment routes.
    paidMinor: moneyField({ default: 0 }),
    balanceMinor: moneyField(),

    status: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid"],
      required: true,
      default: "unpaid",
    },

    issuedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
      immutable: true,
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

// Validate invoice arithmetic before document save.
invoiceSchema.pre("validate", function () {
  const validMoney = (value) =>
    Number.isSafeInteger(value) && value >= 0;

  if (!this.items?.length) return;

  let subtotal = 0n;
  let taxTotal = 0n;
  let total = 0n;
  let roomItems = 0;

  const serviceIds = new Set();

  for (let index = 0; index < this.items.length; index += 1) {
    const item = this.items[index];

    if (
      !validMoney(item.subtotalMinor) ||
      !validMoney(item.taxAmountMinor) ||
      !validMoney(item.totalMinor) ||
      !Number.isInteger(item.taxRateBps) ||
      item.taxRateBps < 0 ||
      item.taxRateBps > 10000
    ) {
      this.invalidate(
        `items.${index}`,
        "Invoice item contains invalid amounts."
      );
      return;
    }

    if (item.type === "room") {
      roomItems += 1;

      if (item.serviceRequest) {
        this.invalidate(
          `items.${index}.serviceRequest`,
          "A room charge cannot reference a service request."
        );
      }
    }

    if (item.type === "service") {
      if (!item.serviceRequest) {
        this.invalidate(
          `items.${index}.serviceRequest`,
          "A service charge must reference a service request."
        );
      } else {
        const serviceId = String(item.serviceRequest);

        if (serviceIds.has(serviceId)) {
          this.invalidate(
            `items.${index}.serviceRequest`,
            "A service request cannot be charged twice."
          );
        }

        serviceIds.add(serviceId);
      }
    }

    const lineSubtotal = BigInt(item.subtotalMinor);
    const lineTax = BigInt(item.taxAmountMinor);
    const lineTotal = BigInt(item.totalMinor);

    // Round tax to the nearest minor unit, half up.
    const expectedTax =
      (lineSubtotal * BigInt(item.taxRateBps) + 5000n) / 10000n;

    if (lineTax !== expectedTax) {
      this.invalidate(
        `items.${index}.taxAmountMinor`,
        "Invoice item tax does not match its tax rate."
      );
    }

    if (lineTotal !== lineSubtotal + lineTax) {
      this.invalidate(
        `items.${index}.totalMinor`,
        "Invoice item total does not match its charges."
      );
    }

    subtotal += lineSubtotal;
    taxTotal += lineTax;
    total += lineTotal;
  }

  if (roomItems !== 1) {
    this.invalidate(
      "items",
      "An invoice must contain exactly one room charge."
    );
  }

  const maximum = BigInt(Number.MAX_SAFE_INTEGER);

  if (
    subtotal > maximum ||
    taxTotal > maximum ||
    total > maximum
  ) {
    this.invalidate("totalMinor", "Invoice amount is too large.");
    return;
  }

  for (const [field, expected] of [
    ["subtotalMinor", subtotal],
    ["taxAmountMinor", taxTotal],
    ["totalMinor", total],
  ]) {
    if (
      !validMoney(this[field]) ||
      BigInt(this[field]) !== expected
    ) {
      this.invalidate(field, "Invoice totals do not match its items.");
    }
  }

  if (!validMoney(this.paidMinor)) {
    this.invalidate("paidMinor", "Paid amount is invalid.");
    return;
  }

  if (BigInt(this.paidMinor) > total) {
    this.invalidate(
      "paidMinor",
      "Paid amount cannot exceed the invoice total."
    );
    return;
  }

  const balance = Number(total - BigInt(this.paidMinor));

  this.balanceMinor = balance;

  if (balance === 0) {
    this.status = "paid";
    this.paidAt = this.paidAt || new Date();
  } else {
    this.status =
      this.paidMinor > 0 ? "partially_paid" : "unpaid";
    this.paidAt = null;
  }
});

invoiceSchema.index({
  hotel: 1,
  status: 1,
  issuedAt: -1,
});

invoiceSchema.index({
  guestUser: 1,
  issuedAt: -1,
});

module.exports =
  mongoose.models.Invoice ||
  mongoose.model("Invoice", invoiceSchema);