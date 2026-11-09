const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: [true, "Email is required."],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please enter a valid email address.",
      ],
    },

    // Auth and staff routes hash passwords before saving.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    phone: {
      type: String,
      trim: true,
      maxlength: 25,
      default: "",
    },

    role: {
      type: String,
      enum: [
        "admin",
        "manager",
        "receptionist",
        "housekeeping",
        "maintenance",
        "guest",
      ],
      default: "guest",
    },

    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hotel",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    preferences: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    // Increment to invalidate previously issued sessions.
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, result) {
        delete result.passwordHash;
        delete result.tokenVersion;
        delete result.__v;
        return result;
      },
    },
  }
);

module.exports =
  mongoose.models.User || mongoose.model("User", userSchema);