/**
 * Repose backend — secure API proxy for pose-transfer generation.
 *
 * Responsibilities:
 *  1. Accept the source photo, prompt, optional reference-pose image, and
 *     strength from the browser (multipart/form-data).
 *  2. Validate everything (type, size, prompt length) before it touches
 *     any paid API or leaves the server.
 *  3. Call the AI image provider server-side, using an API key that is
 *     NEVER sent to the browser.
 *  4. Return a result image URL/base64 to the frontend.
 *
 * This file wires up Replicate (https://replicate.com) as the example
 * provider, using a ControlNet/IP-Adapter-style pose-transfer model that
 * takes a source image + pose reference (or text prompt) and preserves
 * face/identity. Swap `callPoseModel()` for fal.ai, Stability, or your
 * own hosted model — the rest of the server (validation, rate limiting,
 * auth) stays the same.
 */

const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Client, handle_file } = require('@gradio/client');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// Security middleware and Static files serving
// ---------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  methods: ['POST', 'GET'],
}));

// Serve frontend static files (like index.html) directly from workspace root
app.use(express.static(__dirname));

// Limit how often a client can call the generation endpoint.
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                  // Increased to 50 requests per IP per window since API is free
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a bit and try again.' },
});

// ---------------------------------------------------------------------
// Upload handling — memory storage, strict limits, no disk persistence
// ---------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
    }
    cb(null, true);
  },
});

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'reference_pose', maxCount: 1 },
]);

// ---------------------------------------------------------------------
// Helper to upload a buffer to Catbox.moe anonymously
// ---------------------------------------------------------------------
async function uploadToCatbox(buffer, mimeType, filename) {
  const extension = mimeType.split('/')[1] || 'png';
  const name = filename || `upload.${extension}`;
  const blob = new Blob([buffer], { type: mimeType });

  const formData = new FormData();
  formData.append('reqtype', 'fileupload');
  formData.append('fileToUpload', blob, name);

  const res = await fetch('https://catbox.moe/user/api.php', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Failed to upload image to hosting provider (Status ${res.status})`);
  }

  const fileUrl = await res.text();
  return fileUrl.trim();
}

// ---------------------------------------------------------------------
// AI provider call — Free Unlimited image-to-image API (Pollinations.ai)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// AI provider call — True Identity-Preserving Pose-Transfer via Hugging Face Space (InstantID)
// ---------------------------------------------------------------------
async function callPoseModel({ imageBuffer, imageMime, refBuffer, refMime, prompt, strength }) {
  console.log("Connecting to Hugging Face InstantID Space...");
  const app = await Client.connect("InstantX/InstantID");

  console.log("Preparing files...");
  const faceFile = handle_file(imageBuffer);
  
  let poseFile;
  let hasPoseRef = false;
  if (refBuffer) {
    poseFile = handle_file(refBuffer);
    hasPoseRef = true;
  } else {
    // Gradio Space requires a pose image, so we pass the source face image as a placeholder
    poseFile = handle_file(imageBuffer);
  }

  // Map the strength (10 to 100) to controlnet strength ratio (0 to 1.5)
  // Standard default is 0.8. We map it proportionally: strength / 100
  const controlnetStrength = hasPoseRef ? (strength / 100) : 0.0;
  const controlnetSelection = hasPoseRef ? ["depth"] : [];

  console.log("Calling InstantID prediction...");
  const result = await app.predict("/generate_image", {
    face_image_path: faceFile,
    pose_image_path: poseFile,
    prompt: prompt || "a portrait of a person in the new pose",
    negative_prompt: "(lowres, low quality, worst quality:1.2), (text:1.2), watermark, deformed, ugly, blurry, out of focus",
    style_name: "(No style)",
    num_steps: 30,
    identitynet_strength_ratio: 0.8,
    adapter_strength_ratio: 0.8,
    canny_strength: controlnetStrength,
    depth_strength: controlnetStrength,
    controlnet_selection: controlnetSelection,
    guidance_scale: 5,
    seed: Math.floor(Math.random() * 2147483647),
    scheduler: "EulerDiscreteScheduler",
    enable_LCM: false,
    enhance_face_region: true
  });

  console.log("Prediction finished. Processing result...");
  
  if (result && result.data && result.data[0] && result.data[0].url) {
    const generatedUrl = result.data[0].url;
    console.log("Fetching generated image:", generatedUrl);
    const response = await fetch(generatedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image from Hugging Face Space (Status ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get('content-type') || 'image/webp';
    const base64Image = buffer.toString('base64');
    return `data:${mimeType};base64,${base64Image}`;
  } else {
    throw new Error("InstantID model failed to return a valid output image.");
  }
}

// ---------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------
app.post('/api/generate-pose', generateLimiter, uploadFields, async (req, res) => {
  try {
    const sourceFile = req.files?.image?.[0];
    const refFile = req.files?.reference_pose?.[0];
    const prompt = (req.body.prompt || '').trim();
    const strength = Number(req.body.strength) || 70;

    if (!sourceFile) {
      return res.status(400).json({ message: 'A source photo is required.' });
    }
    if (!prompt && !refFile) {
      return res.status(400).json({ message: 'Describe the pose or upload a reference pose image.' });
    }
    if (prompt.length > 600) {
      return res.status(400).json({ message: 'Pose description is too long (max 600 characters).' });
    }
    if (strength < 10 || strength > 100) {
      return res.status(400).json({ message: 'Pose strength must be between 10 and 100.' });
    }

    const resultUrl = await callPoseModel({
      imageBuffer: sourceFile.buffer,
      imageMime: sourceFile.mimetype,
      refBuffer: refFile?.buffer,
      refMime: refFile?.mimetype,
      prompt,
      strength,
    });

    return res.json({ imageUrl: resultUrl });
  } catch (err) {
    console.error('generate-pose error:', err);
    const safeMessage = process.env.NODE_ENV === 'production'
      ? 'The pose model failed to generate a result. Please try again.'
      : (err && err.message ? err.message : 'The pose model failed to generate a result.');
    return res.status(502).json({ message: safeMessage });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Repose backend listening on port ${PORT}`);
});
