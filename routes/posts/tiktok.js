import express from "express";
import multer from "multer";
import axios from "axios";
import fs from "fs";
import path from "path";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/tiktok";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `tiktok-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for TikTok videos
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo", // AVI
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only MP4, MOV, and AVI files are allowed."), false);
    }
  },
});

// Upload video to TikTok
router.post(
  "/tiktok/upload",
  authMiddleware,
  upload.single("video"),
  async (req, res) => {
    const { title, privacy_level = "PUBLIC_TO_EVERYONE", disable_duet = false, disable_comment = false, disable_stitch = false } = req.body;
    const videoFile = req.file;

    if (!videoFile) {
      return res.status(400).json({ error: "No video file provided" });
    }

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    try {
      // Get TikTok account
      const account = await Account.findOne({
        userId: req.userId,
        platform: "TikTok",
      });

      if (!account) {
        return res.status(404).json({ error: "TikTok account not connected" });
      }

      // Check if token needs refresh
      if (account.expiresAt && new Date() > account.expiresAt) {
        console.log("TikTok token expired, refreshing...");
        const refreshResponse = await axios.post(
          "https://open.tiktokapis.com/v2/oauth/token/",
          {
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: account.refreshToken,
          },
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );

        const { access_token, refresh_token, expires_in } = refreshResponse.data;

        await Account.findOneAndUpdate(
          { userId: req.userId, platform: "TikTok" },
          {
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt: new Date(Date.now() + expires_in * 1000),
          }
        );

        account.accessToken = access_token;
      }

      console.log("Uploading video to TikTok:", title);

      // Step 1: Initialize video upload
      const initResponse = await axios.post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        {
          post_info: {
            title: title,
            privacy_level: privacy_level,
            disable_duet: disable_duet,
            disable_comment: disable_comment,
            disable_stitch: disable_stitch,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: "FILE_UPLOAD",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const { publish_id, upload_url } = initResponse.data.data;

      // Step 2: Upload video file
      const videoStream = fs.createReadStream(videoFile.path);
      await axios.put(upload_url, videoStream, {
        headers: {
          "Content-Type": "video/mp4",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      // Step 3: Check publish status
      let publishStatus = "PROCESSING";
      let attempts = 0;
      const maxAttempts = 30; // Wait up to 5 minutes (30 * 10 seconds)

      while (publishStatus === "PROCESSING" && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

        const statusResponse = await axios.post(
          `https://open.tiktokapis.com/v2/post/publish/status/fetch/?publish_id=${publish_id}`,
          {},
          {
            headers: {
              Authorization: `Bearer ${account.accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        publishStatus = statusResponse.data.data.status;
        attempts++;

        if (publishStatus === "PUBLISHED") {
          const videoId = statusResponse.data.data.publish_id;

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "TikTok",
            platformPostId: videoId,
            content: title,
            videoUrl: `/uploads/tiktok/${videoFile.filename}`,
            status: "published",
          });

          // Clean up uploaded file
          fs.unlinkSync(videoFile.path);

          return res.json({
            success: true,
            message: "Video uploaded successfully to TikTok",
            videoId: videoId,
            publishId: publish_id,
            status: publishStatus,
          });
        } else if (publishStatus === "FAILED") {
          throw new Error("Video upload failed on TikTok");
        }
      }

      // If still processing, return with processing status
      return res.json({
        success: true,
        message: "Video is being processed",
        publishId: publish_id,
        status: publishStatus,
        note: "Video is still processing. Check status later.",
      });
    } catch (error) {
      console.error("TikTok upload error:", error.response?.data || error.message);
      
      // Clean up uploaded file on error
      if (videoFile && fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }

      return res.status(500).json({
        error: "Failed to upload video to TikTok",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  }
);

// Get TikTok video upload status
router.get(
  "/tiktok/upload-status/:publishId",
  authMiddleware,
  async (req, res) => {
    try {
      const { publishId } = req.params;

      const account = await Account.findOne({
        userId: req.userId,
        platform: "TikTok",
      });

      if (!account) {
        return res.status(404).json({ error: "TikTok account not connected" });
      }

      const statusResponse = await axios.post(
        `https://open.tiktokapis.com/v2/post/publish/status/fetch/?publish_id=${publishId}`,
        {},
        {
          headers: {
            Authorization: `Bearer ${account.accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const status = statusResponse.data.data.status;
      const videoId = statusResponse.data.data.publish_id;

      res.json({
        publishId: publishId,
        status: status,
        videoId: videoId,
        message: status === "PUBLISHED" ? "Video published successfully" : "Video is still processing",
      });
    } catch (error) {
      console.error("TikTok upload status error:", error.message);
      res.status(500).json({ error: "Failed to get upload status" });
    }
  }
);

export default router;
