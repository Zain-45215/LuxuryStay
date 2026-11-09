const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");

const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

const COOKIE_NAME = "luxurystay_token";
const SESSION_DURATION = 8 * 60 * 60 * 1000;

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 64) {
  throw new Error(
    "Add a JWT_SECRET of at least 64 characters to backend/.env"
  );
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
};

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    hotel: user.hotel,
    preferences: user.preferences,
    createdAt: user.createdAt,
  };
}

function createSession(res, user) {
  const token = jwt.sign(
    { tokenVersion: user.tokenVersion },
    JWT_SECRET,
    {
      algorithm: "HS256",
      subject: user._id.toString(),
      issuer: "luxurystay-api",
      audience: "luxurystay-web",
      expiresIn: "8h",
    }
  );

  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: SESSION_DURATION,
  });
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again after 15 minutes.",
  },
});

// Do not cache account information.
router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Check the origin and content type for requests that change data.
router.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const allowedOrigin =
    process.env.CLIENT_URL || "http://localhost:5173";

  const origin = req.get("origin");

  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({
      success: false,
      message: "Request origin is not allowed.",
    });
  }

  if (!req.is("application/json")) {
    return res.status(415).json({
      success: false,
      message: "Please send the request as application/json.",
    });
  }

  return next();
});

// POST /api/auth/register
// Public registration always creates a guest account.
router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone = "",
    } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      typeof phone !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid name, email, password and phone values.",
      });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain between 2 and 100 characters.",
      });
    }

    if (
      cleanEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 12 characters and no more than 72 bytes.",
      });
    }

    if (cleanPhone.length > 25) {
      return res.status(400).json({
        success: false,
        message: "Phone number must not exceed 25 characters.",
      });
    }

    await User.init();

    const existingUser = await User.exists({ email: cleanEmail });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash,
      role: "guest",
      isActive: true,
      tokenVersion: 0,
      lastLogin: new Date(),
    });

    createSession(res, user);

    return res.status(201).json({
      success: true,
      message: "Your account has been created.",
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    return next(error);
  }
});

// POST /api/auth/login
router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      email.trim().length > 254 ||
      !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email and password.",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select("+passwordHash +tokenVersion");

    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!user || !passwordMatches || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password, or account unavailable.",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    createSession(res, user);

    return res.json({
      success: true,
      message: "Logged in successfully.",
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/auth/me
router.get("/me", protect, (req, res) => {
  return res.json({
    success: true,
    user: publicUser(req.user),
  });
});

// POST /api/auth/logout
// End all existing sessions for this account.
router.post("/logout", protect, async (req, res, next) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { tokenVersion: 1 } }
    );

    res.clearCookie(COOKIE_NAME, cookieOptions);

    return res.json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;