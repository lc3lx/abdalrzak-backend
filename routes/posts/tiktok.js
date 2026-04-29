import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  fetchTikTokPublishStatus,
  getTikTokApiError,
  initTikTokVideoPostFromFile,
  pickTikTokPrivacyLevel,
  queryTikTokCreatorInfo,
  refreshTikTokTokenIfNeeded,
  uploadTikTokVideoFile,
} from "../../services/tiktok.js";

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

function asBoolean(value) {
  return value === true || value === "true" || value === "1";
}

// Upload video to TikTok
router.post(
  "/tiktok/upload",
  authMiddleware,
  upload.single("video"),
  async (req, res) => {
    const {
      title,
      privacy_level,
      disable_duet = false,
      disable_comment = false,
      disable_stitch = false,
      is_aigc = false,
    } = req.body;
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

      await refreshTikTokTokenIfNeeded(account, req.userId);
      const creatorInfo = await queryTikTokCreatorInfo(account.accessToken);
      const privacyLevel = pickTikTokPrivacyLevel(creatorInfo, privacy_level);

      console.log("Uploading video to TikTok:", title);

      const videoSize = videoFile.size || fs.statSync(videoFile.path).size;
      const initData = await initTikTokVideoPostFromFile({
        accessToken: account.accessToken,
        title,
        videoSize,
        privacyLevel,
        disableDuet: asBoolean(disable_duet),
        disableComment: asBoolean(disable_comment),
        disableStitch: asBoolean(disable_stitch),
        isAigc: asBoolean(is_aigc),
      });

      const { publish_id, upload_url, chunkSize } = initData;

      await uploadTikTokVideoFile({
        uploadUrl: upload_url,
        filePath: videoFile.path,
        mimeType: videoFile.mimetype,
        videoSize,
        chunkSize,
      });

      // Step 3: Check publish status
      let publishStatus = "PROCESSING_UPLOAD";
      let statusData = {};
      let attempts = 0;
      const maxAttempts = 30; // Wait up to 5 minutes (30 * 10 seconds)

      while (
        ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD"].includes(publishStatus) &&
        attempts < maxAttempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Wait 10 seconds

        statusData = await fetchTikTokPublishStatus(account.accessToken, publish_id);
        publishStatus = statusData.status;
        attempts++;

        if (publishStatus === "PUBLISH_COMPLETE") {
          const videoId =
            statusData.publicaly_available_post_id?.[0]?.toString() ||
            publish_id;

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
            privacyLevel,
          });
        } else if (publishStatus === "FAILED") {
          throw new Error(statusData.fail_reason || "Video upload failed on TikTok");
        }
      }

      // If still processing, return with processing status
      return res.json({
        success: true,
        message: "Video is being processed",
        publishId: publish_id,
        status: publishStatus,
        privacyLevel,
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
        details: getTikTokApiError(error),
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

      await refreshTikTokTokenIfNeeded(account, req.userId);
      const statusData = await fetchTikTokPublishStatus(
        account.accessToken,
        publishId
      );

      const status = statusData.status;
      const videoId =
        statusData.publicaly_available_post_id?.[0]?.toString() || publishId;

      res.json({
        publishId: publishId,
        status: status,
        videoId: videoId,
        uploadedBytes: statusData.uploaded_bytes,
        downloadedBytes: statusData.downloaded_bytes,
        failReason: statusData.fail_reason,
        message:
          status === "PUBLISH_COMPLETE"
            ? "Video published successfully"
            : "Video is still processing",
      });
    } catch (error) {
      console.error("TikTok upload status error:", error.message);
      res.status(500).json({
        error: "Failed to get upload status",
        details: getTikTokApiError(error),
      });
    }
  }
);

export default router;
