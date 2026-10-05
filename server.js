"use strict";

require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");

/* ---------- Config ---------- */

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const NOTIFY_EMAIL = process.env.SUBMISSION_EMAIL || "foilhousetcg@gmail.com";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data", "submissions"));

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_EMAIL_ATTACH_BYTES = 20 * 1024 * 1024;
const PHOTO_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
};
const ALLOWED_KINDS = ["Common / uncommon", "Holo / reverse holo", "EX / V / GX"];

fs.mkdirSync(DATA_DIR, { recursive: true });

class UserError extends Error {}

/* ---------- Email (optional) ---------- */

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function notify(record, files) {
  const dir = path.join(DATA_DIR, record.id);
  if (!mailer) {
    console.log(`[${record.id}] saved to ${dir} (SMTP not configured, no email sent)`);
    return;
  }
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const attach = totalBytes <= MAX_EMAIL_ATTACH_BYTES;

  const text = [
    "NEW BULK SUBMISSION",
    `ID: ${record.id}`,
    "",
    `Name: ${record.name}`,
    `Email: ${record.email}`,
    `Phone: ${record.phone || "-"}`,
    "",
    `Ship from: ${record.street}, ${record.city}, ${record.state} ${record.zip}`,
    "",
    `Approx. cards: ${record.count}`,
    `Est. weight (lbs): ${record.weight}`,
    `Contents: ${record.kinds.join(", ") || "not specified"}`,
    `Condition: ${record.condition || "-"}`,
    `Hoping for: ${record.ask || "-"}`,
    `Notes: ${record.notes || "-"}`,
    "",
    attach
      ? `${files.length} photo(s) attached.`
      : `${files.length} photo(s) were too large to attach. They are saved in ${dir}.`,
  ].join("\n");

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: NOTIFY_EMAIL,
    replyTo: record.email,
    subject: `New bulk submission: ${record.name.replace(/\s+/g, " ")} (${record.count} cards)`,
    text,
    attachments: attach ? files.map((f) => ({ filename: f.filename, path: f.path })) : [],
  });
}

/* ---------- Validation ---------- */

const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseSubmission(body) {
  const data = {
    name: clean(body.name, 120),
    email: clean(body.email, 200).toLowerCase(),
    phone: clean(body.phone, 40),
    street: clean(body.street, 200),
    city: clean(body.city, 100),
    state: clean(body.state, 2).toUpperCase(),
    zip: clean(body.zip, 10),
    count: Number.parseInt(body.count, 10),
    weight: clean(body.weight, 40),
    kinds: [].concat(body.kind || []).map((k) => clean(k, 40)).filter((k) => ALLOWED_KINDS.includes(k)),
    condition: clean(body.condition),
    ask: clean(body.ask, 200),
    notes: clean(body.notes),
  };

  let error = null;
  if (!data.name) error = "Please enter your name.";
  else if (!EMAIL_RE.test(data.email)) error = "Please enter a valid email address.";
  else if (!data.phone) error = "Please enter your phone number.";
  else if (!data.street || !data.city) error = "Please enter your full ship-from address.";
  else if (!/^[A-Z]{2}$/.test(data.state)) error = "Please enter a two-letter state code.";
  else if (!/^\d{5}(-\d{4})?$/.test(data.zip)) error = "Please enter a valid ZIP code.";
  else if (!Number.isInteger(data.count) || data.count < 1 || data.count > 1000000) {
    error = "Please enter how many cards you have.";
  } else if (!body.confirmOwner || !body.confirmPolicy) {
    error = "Please confirm the checkboxes at the bottom of the form.";
  }
  return { data, error };
}

/* ---------- Upload handling ---------- */

const removeDir = (dir) => fs.rmSync(dir, { recursive: true, force: true });

function assignId(req, res, next) {
  const day = new Date().toISOString().slice(0, 10);
  req.submissionId = `${day}-${crypto.randomBytes(4).toString("hex")}`;
  req.submissionDir = path.join(DATA_DIR, req.submissionId);
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(req.submissionDir, { recursive: true });
      cb(null, req.submissionDir);
    },
    filename(req, file, cb) {
      req.photoCount = (req.photoCount || 0) + 1;
      cb(null, `photo-${req.photoCount}${PHOTO_TYPES[file.mimetype]}`);
    },
  }),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 30 },
  fileFilter(req, file, cb) {
    if (PHOTO_TYPES[file.mimetype]) return cb(null, true);
    cb(new UserError("Only JPG, PNG, WebP or HEIC photos are allowed."));
  },
});

function receiveUpload(req, res, next) {
  upload.array("photos", MAX_PHOTOS)(req, res, (err) => {
    if (!err) return next();
    removeDir(req.submissionDir);
    const messages = {
      LIMIT_FILE_SIZE: `Each photo must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
      LIMIT_FILE_COUNT: `Please add no more than ${MAX_PHOTOS} photos.`,
      LIMIT_UNEXPECTED_FILE: `Please add no more than ${MAX_PHOTOS} photos.`,
    };
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: messages[err.code] || "The upload failed. Please try again." });
    }
    next(err);
  });
}

/* ---------- App ---------- */

const app = express();
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "upgrade-insecure-requests": IS_PROD ? [] : null,
      },
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please try again later." },
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/api/submissions", submissionLimiter, assignId, receiveUpload, (req, res) => {
  const files = req.files || [];

  // Hidden honeypot field: bots fill it in, people never see it.
  if (req.body.website) {
    removeDir(req.submissionDir);
    return res.json({ ok: true });
  }

  const { data, error } = parseSubmission(req.body);
  if (error || files.length === 0) {
    removeDir(req.submissionDir);
    return res.status(400).json({ error: error || "Please add at least one photo." });
  }

  const record = {
    id: req.submissionId,
    receivedAt: new Date().toISOString(),
    status: "pending",
    ...data,
    photos: files.map((f) => f.filename),
  };
  fs.writeFileSync(path.join(req.submissionDir, "submission.json"), JSON.stringify(record, null, 2));

  res.json({ ok: true, id: record.id });
  notify(record, files).catch((err) => console.error(`[${record.id}] email failed:`, err.message));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

app.listen(PORT, () => {
  console.log(`Foil House bulk site running at http://localhost:${PORT}`);
  console.log(`Submissions are saved to ${DATA_DIR}`);
});
