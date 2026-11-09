const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Check whether the user is logged in.
async function protect(req, res, next) {
  try {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 64) {
      return res.status(500).json({
        success: false,
        message: "Authentication is not configured correctly.",
      });
    }

    const token = req.cookies?.luxurystay_token;

    if (typeof token !== "string" || !token) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        issuer: "luxurystay-api",
        audience: "luxurystay-web",
      });
    } catch {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid or expired. Please log in again.",
      });
    }

    if (
      typeof decoded !== "object" ||
      typeof decoded.sub !== "string" ||
      !/^[a-f0-9]{24}$/i.test(decoded.sub) ||
      !Number.isInteger(decoded.tokenVersion) ||
      !Number.isInteger(decoded.exp)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid session. Please log in again.",
      });
    }

    const user = await User.findById(decoded.sub)
      .select("+tokenVersion");

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: "This account is unavailable. Please contact the hotel.",
      });
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({
        success: false,
        message: "Your session has ended. Please log in again.",
      });
    }

    req.user = user;

    return next();
  } catch (error) {
    return next(error);
  }
}

// Allow only specified roles.
// Always use protect before this middleware.
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    return next();
  };
}

module.exports = {
  protect,
  authorize,
};