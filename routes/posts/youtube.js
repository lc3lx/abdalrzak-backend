import express from "express";
import multer from "multer";
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/youtube";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `youtube-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/wmv",
      "video/flv",
      "video/webm",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only video files are allowed."), false);
    }
  },
});

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  "http://localhost:5000/api/youtube/callback"
);

// Upload video to YouTube
router.post(
  "/youtube/upload",
  authMiddleware,
  upload.single("video"),
  async (req, res) => {
    const { title, description, tags, privacyStatus = "private" } = req.body;
    const videoFile = req.file;

    if (!videoFile) {
      return res.status(400).json({ error: "No video file provided" });
    }

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    try {
      // Get YouTube account
      const account = await Account.findOne({
        userId: req.userId,
        platform: "YouTube",
      });

      if (!account) {
        return res.status(404).json({ error: "YouTube account not connected" });
      }

      // Set up OAuth2 client
      oauth2Client.setCredentials({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
      });

      // Initialize YouTube API
      const youtube = google.youtube({ version: "v3", auth: oauth2Client });

      // Prepare video metadata
      const videoMetadata = {
        snippet: {
          title: title,
          description: description || "",
          tags: tags ? tags.split(",").map((tag) => tag.trim()) : [],
          categoryId: "22", // People & Blogs category
        },
        status: {
          privacyStatus: privacyStatus, // private, public, unlisted
        },
      };

      console.log("Uploading video to YouTube:", title);

      // Upload video
      const response = await youtube.videos.insert({
        part: "snippet,status",
        requestBody: videoMetadata,
        media: {
          body: fs.createReadStream(videoFile.path),
        },
      });

      const videoId = response.data.id;
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // Save to database
      await Post.create({
        userId: req.userId,
        platform: "YouTube",
        platformPostId: videoId,
        content: title,
        description: description,
        imageUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
        status: "published",
        videoUrl: videoUrl,
      });

      // Clean up uploaded file
      fs.unlinkSync(videoFile.path);

      console.log("Video uploaded successfully:", videoId);

      res.json({
        success: true,
        videoId: videoId,
        videoUrl: videoUrl,
        title: title,
        message: "Video uploaded successfully to YouTube",
      });
    } catch (error) {
      console.error("YouTube upload error:", error.message);

      // Clean up uploaded file on error
      if (videoFile && fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }

      res.status(500).json({
        error: "Failed to upload video to YouTube",
        details: error.message,
      });
    }
  }
);

// Get video upload status
router.get(
  "/youtube/upload-status/:videoId",
  authMiddleware,
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const account = await Account.findOne({
        userId: req.userId,
        platform: "YouTube",
      });

      if (!account) {
        return res.status(404).json({ error: "YouTube account not connected" });
      }

      oauth2Client.setCredentials({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
      });

      const youtube = google.youtube({ version: "v3", auth: oauth2Client });

      const response = await youtube.videos.list({
        part: "status,snippet",
        id: videoId,
      });

      const video = response.data.items[0];
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }

      res.json({
        videoId: videoId,
        title: video.snippet.title,
        status: video.status.uploadStatus,
        privacyStatus: video.status.privacyStatus,
        publishedAt: video.snippet.publishedAt,
      });
    } catch (error) {
      console.error("YouTube upload status error:", error.message);
      res.status(500).json({ error: "Failed to get upload status" });
    }
  }
);

// Update video metadata
router.put("/youtube/update/:videoId", authMiddleware, async (req, res) => {
  const { videoId } = req.params;
  const { title, description, tags, privacyStatus } = req.body;

  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "YouTube",
    });

    if (!account) {
      return res.status(404).json({ error: "YouTube account not connected" });
    }

    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    // Get current video details
    const currentVideo = await youtube.videos.list({
      part: "snippet,status",
      id: videoId,
    });

    if (!currentVideo.data.items[0]) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = currentVideo.data.items[0];

    // Update video metadata
    const updateResponse = await youtube.videos.update({
      part: "snippet,status",
      requestBody: {
        id: videoId,
        snippet: {
          ...video.snippet,
          title: title || video.snippet.title,
          description: description || video.snippet.description,
          tags: tags
            ? tags.split(",").map((tag) => tag.trim())
            : video.snippet.tags,
        },
        status: {
          ...video.status,
          privacyStatus: privacyStatus || video.status.privacyStatus,
        },
      },
    });

    res.json({
      success: true,
      message: "Video metadata updated successfully",
      videoId: videoId,
    });
  } catch (error) {
    console.error("YouTube update error:", error.message);
    res.status(500).json({ error: "Failed to update video" });
  }
});

// Delete video
router.delete("/youtube/delete/:videoId", authMiddleware, async (req, res) => {
  const { videoId } = req.params;

  try {
    const account = await Account.findOne({
      userId: req.userId,
      platform: "YouTube",
    });

    if (!account) {
      return res.status(404).json({ error: "YouTube account not connected" });
    }

    oauth2Client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
    });

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    await youtube.videos.delete({
      id: videoId,
    });

    // Remove from database
    await Post.findOneAndDelete({
      userId: req.userId,
      platform: "YouTube",
      platformPostId: videoId,
    });

    res.json({
      success: true,
      message: "Video deleted successfully",
    });
  } catch (error) {
    console.error("YouTube delete error:", error.message);
    res.status(500).json({ error: "Failed to delete video" });
  }
});

export default router;
