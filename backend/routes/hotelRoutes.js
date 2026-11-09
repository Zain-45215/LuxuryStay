const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const sharp = require("sharp");

const Hotel = require("../models/Hotel");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

const IMAGE_DIRECTORY = path.join(__dirname, "..", "uploads", "hotels");
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_NAME = /^[a-f0-9-]{36}\.webp$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/*
 * Public access to published hotel images only.
 * This route must appear before the admin authentication middleware.
 * Other hotel endpoints remain admin-only.
 */
router.get("/images/:filename", async (req, res, next) => {
  try {
    const { filename } = req.params;

    if (!IMAGE_NAME.test(filename)) {
      return res.status(404).json({
        success: false,
        message: "Image not found.",
      });
    }

    const imageUrl = `/api/hotels/images/${filename}`;

    const published = await Hotel.exists({
      imageUrl,
      isActive: true,
    });

    if (!published) {
      return res.status(404).json({
        success: false,
        message: "Image not found.",
      });
    }

    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.sendFile(
      filename,
      {
        root: IMAGE_DIRECTORY,
        dotfiles: "deny",
        headers: { "Cache-Control": "no-store" },
      },
      (error) => {
        if (!error) return;
        if (res.headersSent) return next(error);

        if (error.code === "ENOENT" || error.status === 404) {
          return res.status(404).json({
            success: false,
            message: "Image file not found.",
          });
        }

        return next(error);
      }
    );
  } catch (error) {
    return next(error);
  }
});

// All management endpoints require an authenticated administrator.
router.use(protect);
router.use(authorize("admin"));

router.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");

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

  const imageUpload =
    req.method === "PUT" &&
    /^\/[a-f0-9]{24}\/image\/?$/i.test(req.path);

  if (imageUpload) {
    if (!IMAGE_TYPES.some((type) => req.is(type))) {
      return res.status(415).json({
        success: false,
        message: "Please upload a JPG, PNG or WebP image.",
      });
    }
  } else if (!req.is("application/json")) {
    return res.status(415).json({
      success: false,
      message: "Please send the request as application/json.",
    });
  }

  return next();
});

const textFields = [
  "name",
  "code",
  "address",
  "city",
  "country",
  "phone",
  "email",
  "description",
  "currency",
  "timezone",
  "checkInTime",
  "checkOutTime",
];

// imageUrl cannot be supplied manually.
const allowedFields = new Set([
  ...textFields,
  "taxRate",
  "isActive",
]);

function readHotelInput(body, creating = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Please provide a valid hotel object.");
  }

  const unknownFields = Object.keys(body).filter(
    (key) => !allowedFields.has(key)
  );

  if (unknownFields.length) {
    throw badRequest(`Unsupported fields: ${unknownFields.join(", ")}`);
  }

  const input = {};

  for (const field of textFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      if (typeof body[field] !== "string") {
        throw badRequest(`${field} must be text.`);
      }

      input[field] = body[field].trim();
    }
  }

  if (input.code !== undefined) {
    input.code = input.code.toUpperCase();
  }

  if (input.currency !== undefined) {
    input.currency = input.currency.toUpperCase();
  }

  if (input.email !== undefined) {
    input.email = input.email.toLowerCase();
  }

  if (Object.prototype.hasOwnProperty.call(body, "taxRate")) {
    if (
      typeof body.taxRate !== "number" ||
      !Number.isFinite(body.taxRate) ||
      body.taxRate < 0 ||
      body.taxRate > 100
    ) {
      throw badRequest("Tax rate must be a number between 0 and 100.");
    }

    input.taxRate = body.taxRate;
  }

  if (Object.prototype.hasOwnProperty.call(body, "isActive")) {
    if (typeof body.isActive !== "boolean") {
      throw badRequest("isActive must be true or false.");
    }

    input.isActive = body.isActive;
  }

  if (creating) {
    for (const field of ["name", "code", "address", "city"]) {
      if (!input[field]) {
        throw badRequest(`${field} is required.`);
      }
    }
  } else if (!Object.keys(input).length) {
    throw badRequest("Provide at least one field to update.");
  }

  return input;
}

function readPositiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw badRequest("Page and limit must be positive whole numbers.");
  }

  const number = Number(value);

  if (!Number.isSafeInteger(number) || number > maximum) {
    throw badRequest(`Pagination value must not exceed ${maximum}.`);
  }

  return number;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.param("id", (req, res, next, id) => {
  if (!/^[a-f0-9]{24}$/i.test(id) || !mongoose.isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid hotel ID.",
    });
  }

  return next();
});

// GET /api/hotels
router.get("/", async (req, res, next) => {
  try {
    const page = readPositiveInteger(req.query.page, 1, 10000);
    const limit = readPositiveInteger(req.query.limit, 20, 100);

    const filter = {};

    if (req.query.search !== undefined) {
      if (
        typeof req.query.search !== "string" ||
        req.query.search.length > 100
      ) {
        throw badRequest("Search must be text up to 100 characters.");
      }

      const search = req.query.search.trim();

      if (search) {
        const expression = new RegExp(escapeRegex(search), "i");

        filter.$or = [
          { name: expression },
          { code: expression },
          { city: expression },
        ];
      }
    }

    if (req.query.active !== undefined) {
      if (!["true", "false"].includes(req.query.active)) {
        throw badRequest("active must be true or false.");
      }

      filter.isActive = req.query.active === "true";
    }

    const [hotels, total] = await Promise.all([
      Hotel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Hotel.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      hotels,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/hotels/:id
router.get("/:id", async (req, res, next) => {
  try {
    const hotel = await Hotel.findById(req.params.id).lean();

    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: "Hotel not found.",
      });
    }

    return res.json({ success: true, hotel });
  } catch (error) {
    return next(error);
  }
});

// POST /api/hotels
router.post("/", async (req, res, next) => {
  try {
    const input = readHotelInput(req.body, true);

    await Hotel.init();

    const hotel = await Hotel.create({
      ...input,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Hotel created successfully.",
      hotel,
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/hotels/:id
router.patch("/:id", async (req, res, next) => {
  try {
    const input = readHotelInput(req.body);

    const hotel = await Hotel.findByIdAndUpdate(
      req.params.id,
      { $set: input },
      { new: true, runValidators: true }
    );

    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: "Hotel not found.",
      });
    }

    return res.json({
      success: true,
      message: "Hotel updated successfully.",
      hotel,
    });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/hotels/:id/image
// The request body is the image file itself, not JSON or FormData.
router.put(
  "/:id/image",
  express.raw({
    type: IMAGE_TYPES,
    limit: "5mb",
    inflate: false,
  }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw badRequest("Please select an image.");
      }

      if (!(await Hotel.exists({ _id: req.params.id }))) {
        return res.status(404).json({
          success: false,
          message: "Hotel not found.",
        });
      }

      let output;

      try {
        const processor = sharp(req.body, {
          limitInputPixels: 25000000,
          failOn: "warning",
        });

        const metadata = await processor.metadata();

        if (
          !["jpeg", "png", "webp"].includes(metadata.format) ||
          (metadata.pages || 1) > 1
        ) {
          throw new Error("Unsupported image.");
        }

        output = await processor
          .rotate()
          .resize({
            width: 1920,
            height: 1440,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
      } catch {
        throw badRequest(
          "Choose a valid, non-animated JPG, PNG or WebP image up to 25 megapixels."
        );
      }

      await fs.mkdir(IMAGE_DIRECTORY, { recursive: true });

      const filename = `${randomUUID()}.webp`;
      const imageUrl = `/api/hotels/images/${filename}`;

      await fs.writeFile(
        path.join(IMAGE_DIRECTORY, filename),
        output,
        { flag: "wx" }
      );

      const hotel = await Hotel.findByIdAndUpdate(
        req.params.id,
        { $set: { imageUrl } },
        { new: true, runValidators: true }
      );

      if (!hotel) {
        await fs.unlink(path.join(IMAGE_DIRECTORY, filename)).catch(() => {});

        return res.status(404).json({
          success: false,
          message: "Hotel no longer exists.",
        });
      }

      // Previous files are retained to avoid concurrent upload/delete races.
      // Only the image currently referenced by an active hotel is public.
      return res.json({
        success: true,
        message: "Hotel image uploaded successfully.",
        hotel,
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "The image must be 5 MB or smaller.",
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: "A hotel with this code already exists.",
    });
  }

  if (error.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: Object.values(error.errors)
        .map((item) => item.message)
        .join(" "),
    });
  }

  return next(error);
});

module.exports = router;