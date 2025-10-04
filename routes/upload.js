import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Configure multer for media uploads (images and videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadDir;
    if (file.mimetype.startsWith("image/")) {
      uploadDir = "uploads/images";
    } else if (file.mimetype.startsWith("video/")) {
      uploadDir = "uploads/videos";
    } else {
      uploadDir = "uploads/media";
    }

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileType = file.mimetype.startsWith("image/")
      ? "image"
      : file.mimetype.startsWith("video/")
      ? "video"
      : "media";
    cb(null, `${fileType}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for media files
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      // Images
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      // Videos
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/wmv",
      "video/flv",
      "video/webm",
      "video/quicktime",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only image and video files are allowed."),
        false
      );
    }
  },
});

// Upload single media file (image or video)
router.post(
  "/upload/media",
  authMiddleware,
  upload.single("media"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No media file provided" });
      }

      // Determine the correct path based on file type
      const fileType = req.file.mimetype.startsWith("image/")
        ? "images"
        : req.file.mimetype.startsWith("video/")
        ? "videos"
        : "media";
      const mediaUrl = `/uploads/${fileType}/${req.file.filename}`;

      res.json({
        success: true,
        mediaUrl: mediaUrl,
        imageUrl: mediaUrl, // For backward compatibility
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype.startsWith("image/") ? "image" : "video",
        message: `${
          req.file.mimetype.startsWith("image/") ? "Image" : "Video"
        } uploaded successfully`,
      });
    } catch (error) {
      console.error("Media upload error:", error);
      res.status(500).json({
        error: "Failed to upload media",
        details: error.message,
      });
    }
  }
);

// Upload single image (for backward compatibility)
router.post(
  "/upload/image",
  authMiddleware,
  upload.single("image"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      // Generate the public URL for the uploaded image
      const imageUrl = `/uploads/images/${req.file.filename}`;

      res.json({
        success: true,
        imageUrl: imageUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        message: "Image uploaded successfully",
      });
    } catch (error) {
      console.error("Image upload error:", error);
      res.status(500).json({
        error: "Failed to upload image",
        details: error.message,
      });
    }
  }
);

// Upload multiple images
router.post(
  "/upload/images",
  authMiddleware,
  upload.array("images", 5),
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No image files provided" });
      }

      const imageUrls = req.files.map((file) => ({
        imageUrl: `/uploads/images/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
      }));

      res.json({
        success: true,
        images: imageUrls,
        count: req.files.length,
        message: "Images uploaded successfully",
      });
    } catch (error) {
      console.error("Images upload error:", error);
      res.status(500).json({
        error: "Failed to upload images",
        details: error.message,
      });
    }
  }
);

// Delete uploaded image
router.delete("/upload/image/:filename", authMiddleware, (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join("uploads/images", filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({
        success: true,
        message: "Image deleted successfully",
      });
    } else {
      res.status(404).json({ error: "Image not found" });
    }
  } catch (error) {
    console.error("Image delete error:", error);
    res.status(500).json({
      error: "Failed to delete image",
      details: error.message,
    });
  }
});

// Get list of uploaded images for user
router.get("/upload/images", authMiddleware, (req, res) => {
  try {
    const uploadDir = "uploads/images";
    if (!fs.existsSync(uploadDir)) {
      return res.json({ images: [] });
    }

    const files = fs.readdirSync(uploadDir);
    const images = files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase();
        return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
      })
      .map((file) => ({
        filename: file,
        imageUrl: `/uploads/images/${file}`,
        uploadDate: fs.statSync(path.join(uploadDir, file)).mtime,
      }))
      .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    res.json({ images });
  } catch (error) {
    console.error("Get images error:", error);
    res.status(500).json({
      error: "Failed to get images",
      details: error.message,
    });
  }
});

export default router;
