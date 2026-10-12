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
const { OAuth2Client } = require("google-auth-library");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

/* ---------- Config ---------- */

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
const NOTIFY_EMAIL = process.env.SUBMISSION_EMAIL || "foilhousetcg@gmail.com";
const ADMIN_EMAIL = NOTIFY_EMAIL.toLowerCase();
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data", "submissions"));
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const AUTH_SESSION_SECRET = process.env.AUTH_SESSION_SECRET || "";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
const FIREBASE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const AUTH_COOKIE = "foilhouse_auth";
const AUTH_SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);
let firestore = null;
const SUBMISSION_STATUSES = [
  "pending review",
  "pending user approval",
  "pending user edit",
  "waiting user shipment",
  "waiting for shipment",
  "Foilhouse card review",
  "paid",
];
const STATUS_PRIORITY = new Map(SUBMISSION_STATUSES.map((status, index) => [status, index]));

if (
  FIREBASE_PROJECT_ID &&
  FIREBASE_CREDENTIALS &&
  fs.existsSync(path.resolve(FIREBASE_CREDENTIALS))
) {
  try {
    initializeApp({
      credential: applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
    });
    firestore = getFirestore();
    firestore.settings({ preferRest: true });
    console.log(`Firestore enabled for project ${FIREBASE_PROJECT_ID}`);
  } catch (error) {
    console.error("Firestore could not be initialized:", error.message);
  }
}

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

function encodeSessionPart(value) {
  return Buffer.from(value).toString("base64url");
}

function signSession(payload) {
  const encodedPayload = encodeSessionPart(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function readAuthUser(req) {
  if (!AUTH_SESSION_SECRET) return null;
  const cookieHeader = req.headers.cookie || "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  if (!cookie) return null;

  const value = cookie.slice(`${AUTH_COOKIE}=`.length);
  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = crypto
    .createHmac("sha256", AUTH_SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload.user : null;
  } catch {
    return null;
  }
}

function setAuthCookie(res, user) {
  const payload = {
    user,
    exp: Date.now() + AUTH_SESSION_MAX_AGE,
  };
  const secure = IS_PROD ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE}=${signSession(payload)}; Max-Age=${AUTH_SESSION_MAX_AGE / 1000}; Path=/; HttpOnly; SameSite=Lax${secure}`,
  );
}

function requireAuth(req, res, next) {
  req.user = readAuthUser(req);
  if (!req.user) return res.status(401).json({ error: "Please sign in before submitting." });
  next();
}

function requireFirestore(req, res, next) {
  if (!firestore) return res.status(503).json({ error: "The submission database is not configured." });
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Administrator access is required." });
  }
  next();
}

function saveUserToFirestore(user) {
  if (!firestore) return Promise.resolve();
  return firestore.collection("users").doc(user.id).set(
    {
      ...user,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function saveSubmissionToFirestore(record) {
  return firestore
    .collection("users")
    .doc(record.submittedBy.id)
    .collection("submissions")
    .doc(record.id)
    .set({ ...record, updatedAt: FieldValue.serverTimestamp() });
}

function submissionFromSnapshot(snapshot) {
  return { ...snapshot.data(), id: snapshot.id };
}

function sortSubmissions(submissions) {
  return submissions.sort((first, second) => {
    const statusDifference =
      (STATUS_PRIORITY.get(first.status) ?? Number.MAX_SAFE_INTEGER) -
      (STATUS_PRIORITY.get(second.status) ?? Number.MAX_SAFE_INTEGER);
    if (statusDifference !== 0) return statusDifference;
    return String(second.receivedAt).localeCompare(String(first.receivedAt));
  });
}

async function getUserSubmissions(userId) {
  const snapshot = await firestore.collection("users").doc(userId).collection("submissions").get();
  return sortSubmissions(snapshot.docs.map(submissionFromSnapshot));
}

async function getAllSubmissions() {
  const snapshot = await firestore.collectionGroup("submissions").get();
  return sortSubmissions(snapshot.docs.map(submissionFromSnapshot));
}

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
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'", "https://accounts.google.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "https://accounts.google.com"],
        "frame-src": ["https://accounts.google.com"],
        "upgrade-insecure-requests": IS_PROD ? [] : null,
      },
    },
  })
);

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this connection. Please try again later." },
});

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.get("/api/auth/config", (req, res) => {
  res.json({ clientId: GOOGLE_CLIENT_ID });
});

app.get("/api/auth/me", (req, res) => {
  const user = readAuthUser(req);
  res.json({ user: user ? { ...user, isAdmin: user.email.toLowerCase() === ADMIN_EMAIL } : null });
});

app.post("/api/auth/google", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !AUTH_SESSION_SECRET) {
    return res.status(503).json({ error: "Google sign-in is not configured yet." });
  }
  const credential = clean(req.body.credential, 10000);
  if (!credential) return res.status(400).json({ error: "Google sign-in did not return a credential." });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      return res.status(401).json({ error: "We could not verify that Google account." });
    }
    const user = {
      id: payload.sub,
      email: payload.email.toLowerCase(),
      name: payload.name || payload.email,
      picture: payload.picture || "",
      isAdmin: payload.email.toLowerCase() === ADMIN_EMAIL,
    };
    setAuthCookie(res, user);
    saveUserToFirestore(user).catch((error) => {
      console.error("User could not be saved to Firestore:", error.message);
    });
    res.json({ user });
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    res.status(401).json({ error: "Google sign-in could not be verified." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.get("/api/submissions", requireAuth, requireFirestore, async (req, res, next) => {
  try {
    res.json({ submissions: await getUserSubmissions(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/submissions", requireAuth, requireAdmin, requireFirestore, async (req, res, next) => {
  try {
    res.json({ submissions: await getAllSubmissions() });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/submissions/:id/status", requireAuth, requireAdmin, requireFirestore, async (req, res, next) => {
  const status = clean(req.body.status, 60);
  if (!SUBMISSION_STATUSES.includes(status)) {
    return res.status(400).json({ error: "That submission status is not valid." });
  }

  try {
    const snapshot = await firestore
      .collectionGroup("submissions")
      .where("id", "==", req.params.id)
      .limit(1)
      .get();
    if (snapshot.empty) return res.status(404).json({ error: "Submission not found." });
    await snapshot.docs[0].ref.update({ status, updatedAt: new Date().toISOString() });
    res.json({ ok: true, status });
  } catch (error) {
    next(error);
  }
});

app.post("/api/submissions", requireAuth, requireFirestore, submissionLimiter, assignId, receiveUpload, async (req, res) => {
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
    status: "pending review",
    submittedBy: req.user,
    ...data,
    photos: files.map((f) => f.filename),
  };
  fs.writeFileSync(path.join(req.submissionDir, "submission.json"), JSON.stringify(record, null, 2));

  try {
    await saveSubmissionToFirestore(record);
  } catch (error) {
    console.error(`[${record.id}] Firestore save failed:`, error.message);
    return res.status(500).json({ error: "The submission could not be saved. Please try again." });
  }
  res.json({ ok: true, id: record.id });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

app.listen(PORT, () => {
  console.log(`Foil House bulk site running at http://localhost:${PORT}`);
  console.log(`Submissions are saved to ${DATA_DIR}`);
});
