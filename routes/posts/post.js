import express from "express";
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Build full URL for relative paths (Facebook/Twitter/LinkedIn require absolute URLs)
function toAbsoluteUrl(pathOrUrl, req) {
  if (!pathOrUrl || typeof pathOrUrl !== "string") return pathOrUrl;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://"))
    return pathOrUrl;
  const base =
    process.env.BASE_URL ||
    process.env.API_BASE_URL ||
    `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "") + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
}

// Detect if URL is a video (frontend often sends both image and video as imageUrl)
function isVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.toLowerCase();
  return (
    u.includes("/uploads/videos/") ||
    /\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?|$)/i.test(u)
  );
}

router.post("/post", authMiddleware, async (req, res) => {
  let { content, platforms, imageUrl, videoUrl } = req.body;
  imageUrl = toAbsoluteUrl(imageUrl, req);
  videoUrl = toAbsoluteUrl(videoUrl, req);
  console.log("Post request received:", { content, platforms, imageUrl, videoUrl });

  if (!content || !platforms || platforms.length === 0) {
    console.error("Post validation failed: Missing content or platforms");
    return res
      .status(400)
      .json({ error: "Content and platforms are required" });
  }

  const results = {};
  try {
    const accounts = await Account.find({
      userId: req.userId,
      platform: { $in: platforms },
    });
    console.log(
      "Fetched accounts for posting:",
      accounts.map((a) => a.platform)
    );

    if (platforms.includes("Twitter") && imageUrl) {
      const twitterAccount = accounts.find((acc) => acc.platform === "Twitter");
      if (!twitterAccount) {
        console.warn("Twitter not connected for userId:", req.userId);
        results.Twitter = { error: "Twitter not connected" };
      } else {
        try {
          console.log("Posting to Twitter with image...");
          if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
            throw new Error("Twitter API is not configured on server (missing TWITTER_API_KEY or TWITTER_API_SECRET)");
          }
          const isFetchableUrl = imageUrl && (imageUrl.startsWith("http://") || imageUrl.startsWith("https://"));
          if (!isFetchableUrl) {
            throw new Error("Image URL must be a full http(s) URL the server can fetch (e.g. after upload). Got: " + (imageUrl ? imageUrl.slice(0, 50) + "..." : "empty"));
          }
          const twitterClient = new TwitterApi({
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: twitterAccount.accessToken,
            accessSecret: twitterAccount.accessSecret,
          }).readWrite;

          const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
            validateStatus: () => true,
          });
          if (imageResponse.status !== 200) {
            throw new Error("Failed to fetch image: " + (imageResponse.statusText || imageResponse.status));
          }
          const mediaId = await twitterClient.v1.uploadMedia(
            Buffer.from(imageResponse.data),
            { mimeType: "image/jpeg" }
          );
          const response = await twitterClient.v2.tweet({
            text: content,
            media: { media_ids: [mediaId] },
          });
          console.log("Tweet with image posted:", response.data.id);

          await Post.create({
            userId: req.userId,
            platform: "Twitter",
            platformPostId: response.data.id,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.Twitter = {
            message: "Tweet posted",
            tweetId: response.data.id,
          };
        } catch (err) {
          console.error("Twitter (with image) error:", err.message);
          results.Twitter = { error: err.message || "Failed to post to Twitter" };
        }
      }
    } else if (platforms.includes("Twitter")) {
      const twitterAccount = accounts.find((acc) => acc.platform === "Twitter");
      if (!twitterAccount) {
        console.warn("Twitter not connected for userId:", req.userId);
        results.Twitter = { error: "Twitter not connected" };
      } else {
        try {
          console.log("Posting to Twitter (text only)...");
          if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
            throw new Error("Twitter API is not configured on server");
          }
          const twitterClient = new TwitterApi({
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: twitterAccount.accessToken,
            accessSecret: twitterAccount.accessSecret,
          }).readWrite;
          const response = await twitterClient.v2.tweet(content);
          console.log("Tweet posted:", response.data.id);

          await Post.create({
            userId: req.userId,
            platform: "Twitter",
            platformPostId: response.data.id,
            content: content,
            status: "published",
          });

          results.Twitter = {
            message: "Tweet posted",
            tweetId: response.data.id,
          };
        } catch (err) {
          console.error("Twitter (text) error:", err.message);
          results.Twitter = { error: err.message || "Failed to post to Twitter" };
        }
      }
    }

    const facebookVideoUrl = videoUrl || (imageUrl && isVideoUrl(imageUrl) ? imageUrl : null);
    const facebookImageUrl = imageUrl && !isVideoUrl(imageUrl) ? imageUrl : null;

    if (platforms.includes("Facebook") && facebookVideoUrl) {
      const facebookAccount = accounts.find(
        (acc) => acc.platform === "Facebook"
      );
      if (!facebookAccount || !facebookAccount.pageId) {
        console.warn(
          "Facebook not connected or page ID missing for userId:",
          req.userId
        );
        results.Facebook = {
          error: "Facebook not connected or page ID missing",
        };
      } else {
        try {
          console.log("Posting to Facebook with video...");
          FB.setAccessToken(facebookAccount.accessToken);
          const response = await new Promise((resolve, reject) => {
            FB.api(
              `/${facebookAccount.pageId}/videos`,
              "POST",
              { file_url: facebookVideoUrl, description: content },
              (res) => (res.error ? reject(res.error) : resolve(res))
            );
          });
          const videoPostId = response.post_id || response.id;
          console.log("Facebook video posted:", videoPostId, "(post_id:", response.post_id, ")");

          await Post.create({
            userId: req.userId,
            platform: "Facebook",
            platformPostId: videoPostId,
            content: content,
            videoUrl: facebookVideoUrl,
            status: "published",
          });

          results.Facebook = { message: "Video posted", postId: videoPostId };
        } catch (err) {
          console.error("Facebook (with video) error:", err.message);
          results.Facebook = { error: err.message || "Failed to post video to Facebook" };
        }
      }
    } else if (platforms.includes("Facebook") && facebookImageUrl) {
      const facebookAccount = accounts.find(
        (acc) => acc.platform === "Facebook"
      );
      if (!facebookAccount || !facebookAccount.pageId) {
        console.warn(
          "Facebook not connected or page ID missing for userId:",
          req.userId
        );
        results.Facebook = {
          error: "Facebook not connected or page ID missing",
        };
      } else {
        try {
          console.log("Posting to Facebook with image...");
          FB.setAccessToken(facebookAccount.accessToken);
          const response = await new Promise((resolve, reject) => {
            FB.api(
              `/${facebookAccount.pageId}/photos`,
              "POST",
              { url: facebookImageUrl, caption: content },
              (res) => (res.error ? reject(res.error) : resolve(res))
            );
          });
          const photoPostId = response.post_id || response.id;
          console.log("Facebook photo posted:", photoPostId, "(post_id:", response.post_id, ")");

          await Post.create({
            userId: req.userId,
            platform: "Facebook",
            platformPostId: photoPostId,
            content: content,
            imageUrl: facebookImageUrl,
            status: "published",
          });

          results.Facebook = { message: "Photo posted", postId: photoPostId };
        } catch (err) {
          console.error("Facebook (with image) error:", err.message);
          results.Facebook = { error: err.message || "Failed to post to Facebook" };
        }
      }
    } else if (platforms.includes("Facebook")) {
      const facebookAccount = accounts.find(
        (acc) => acc.platform === "Facebook"
      );
      if (!facebookAccount || !facebookAccount.pageId) {
        console.warn(
          "Facebook not connected or page ID missing for userId:",
          req.userId
        );
        results.Facebook = {
          error: "Facebook not connected or page ID missing",
        };
      } else {
        try {
          console.log("Posting to Facebook (text only)...");
          FB.setAccessToken(facebookAccount.accessToken);
          const response = await new Promise((resolve, reject) => {
            FB.api(
              `/${facebookAccount.pageId}/feed`,
              "POST",
              { message: content },
              (res) => (res.error ? reject(res.error) : resolve(res))
            );
          });
          console.log("Facebook post created:", response.id);

          await Post.create({
            userId: req.userId,
            platform: "Facebook",
            platformPostId: response.id,
            content: content,
            status: "published",
          });

          results.Facebook = { message: "Post created", postId: response.id };
        } catch (err) {
          console.error("Facebook (text) error:", err.message);
          results.Facebook = { error: err.message || "Failed to post to Facebook" };
        }
      }
    }

    if (platforms.includes("Instagram")) {
      const instagramAccount = accounts.find(
        (acc) => acc.platform === "Instagram"
      );
      const facebookAccount = accounts.find(
        (acc) => acc.platform === "Facebook"
      );
      if (!instagramAccount) {
        console.warn("Instagram not connected for userId:", req.userId);
        results.Instagram = { error: "Instagram not connected" };
      } else if (!imageUrl) {
        results.Instagram = { error: "Image required for Instagram posting" };
      } else {
        let igPublished = false;
        const apiVersion = "v21.0";

        // ——— 1) Try Instagram Login API (graph.instagram.com) ———
        const accessToken = (instagramAccount.accessToken || "").toString().trim();
        const igUserId =
          instagramAccount.platformId ||
          instagramAccount.pageId ||
          instagramAccount.channelId;

        if (igUserId && accessToken) {
          try {
            console.log("Posting to Instagram via Instagram Login API (graph.instagram.com)...");
            const mediaRes = await axios.post(
              `https://graph.instagram.com/${apiVersion}/${igUserId}/media`,
              { image_url: imageUrl, caption: content || "" },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            const creationId = mediaRes.data.id;
            const publishRes = await axios.post(
              `https://graph.instagram.com/${apiVersion}/${igUserId}/media_publish`,
              { creation_id: creationId },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );
            const igPostId = publishRes.data.id;
            console.log("Instagram post published (Instagram Login):", igPostId);
            await Post.create({
              userId: req.userId,
              platform: "Instagram",
              platformPostId: igPostId,
              content: content,
              imageUrl: imageUrl,
              status: "published",
            });
            results.Instagram = { message: "Instagram post published", postId: igPostId };
            igPublished = true;
          } catch (err) {
            const code = err.response?.data?.error?.code;
            const msg = err.response?.data?.error?.message || err.message;
            console.error("Instagram (Login API) error:", code, msg);
            if (code !== 100 && !/unsupported request/i.test(msg || "")) {
              if (code === 190 || /invalid.*token|expired|parse access token/i.test(msg || "")) {
                results.Instagram = {
                  error: "انتهت صلاحية ربط إنستغرام. ادخل إلى Integrations وأعد ربط إنستغرام ثم جرّب النشر مرة أخرى.",
                };
              } else {
                results.Instagram = { error: msg || "Failed to post to Instagram" };
              }
            }
          }
        }

        // ——— 2) Fallback: publish via Facebook Page (Instagram Business linked to Page) ———
        if (!igPublished && facebookAccount?.accessToken && facebookAccount?.pageId) {
          try {
            const pageToken = (facebookAccount.accessToken || "").toString().trim();
            const pageId = facebookAccount.pageId;
            const pageInfo = await axios.get(
              `https://graph.facebook.com/${apiVersion}/${pageId}`,
              {
                params: {
                  fields: "instagram_business_account",
                  access_token: pageToken,
                },
              }
            );
            const igBusinessId = pageInfo.data?.instagram_business_account?.id;
            if (igBusinessId) {
              console.log("Posting to Instagram via Facebook Page (graph.facebook.com)...");
              const mediaRes = await axios.post(
                `https://graph.facebook.com/${apiVersion}/${igBusinessId}/media`,
                null,
                {
                  params: {
                    image_url: imageUrl,
                    caption: content || "",
                    access_token: pageToken,
                  },
                }
              );
              const creationId = mediaRes.data.id;
              const publishRes = await axios.post(
                `https://graph.facebook.com/${apiVersion}/${igBusinessId}/media_publish`,
                null,
                {
                  params: {
                    creation_id: creationId,
                    access_token: pageToken,
                  },
                }
              );
              const igPostId = publishRes.data.id;
              console.log("Instagram post published (via Facebook Page):", igPostId);
              await Post.create({
                userId: req.userId,
                platform: "Instagram",
                platformPostId: igPostId,
                content: content,
                imageUrl: imageUrl,
                status: "published",
              });
              results.Instagram = { message: "Instagram post published", postId: igPostId };
              igPublished = true;
            }
          } catch (fbErr) {
            const msg = fbErr.response?.data?.error?.message || fbErr.message;
            console.error("Instagram (via Facebook Page) error:", msg);
            if (!results.Instagram) {
              results.Instagram = { error: msg || "Failed to post to Instagram" };
            }
          }
        }

        if (!igPublished && !results.Instagram?.error) {
          results.Instagram = {
            error: "تطبيق ميتا لا يدعم النشر من ربط إنستغرام الحالي. إمّا أن تربط إنستغرام عبر تطبيق من نوع Instagram API with Instagram Login، أو تربط صفحة فيسبوك مرتبطة بحساب إنستغرام تجاري ثم جرّب النشر مرة أخرى.",
          };
        }
      }
    }

    if (platforms.includes("TikTok")) {
      const tiktokAccount = accounts.find((acc) => acc.platform === "TikTok");
      if (!tiktokAccount) {
        console.warn("TikTok not connected for userId:", req.userId);
        results.TikTok = { error: "TikTok not connected" };
      } else {
        try {
          console.log("Posting to TikTok...");

          // Check if token needs refresh
          if (tiktokAccount.expiresAt && new Date() > tiktokAccount.expiresAt) {
            console.log("TikTok token expired, refreshing...");
            const refreshResponse = await axios.post(
              "https://open.tiktokapis.com/v2/oauth/token/",
              {
                client_key: process.env.TIKTOK_CLIENT_KEY,
                client_secret: process.env.TIKTOK_CLIENT_SECRET,
                grant_type: "refresh_token",
                refresh_token: tiktokAccount.refreshToken,
              },
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }
            );

            const { access_token, refresh_token, expires_in } =
              refreshResponse.data;

            await Account.findOneAndUpdate(
              { userId: req.userId, platform: "TikTok" },
              {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: new Date(Date.now() + expires_in * 1000),
              }
            );

            tiktokAccount.accessToken = access_token;
          }

          // TikTok video posting
          // Note: TikTok requires video for publishing. Use /api/tiktok/upload endpoint for video uploads
          if (videoUrl) {
            try {
              console.log("Posting video to TikTok from URL...");
              
              // Step 1: Initialize video upload
              const initResponse = await axios.post(
                "https://open.tiktokapis.com/v2/post/publish/video/init/",
                {
                  post_info: {
                    title: content || "Video Post",
                    privacy_level: "PUBLIC_TO_EVERYONE",
                    disable_duet: false,
                    disable_comment: false,
                    disable_stitch: false,
                    video_cover_timestamp_ms: 1000,
                  },
                  source_info: {
                    source: "FILE_UPLOAD",
                  },
                },
                {
                  headers: {
                    Authorization: `Bearer ${tiktokAccount.accessToken}`,
                    "Content-Type": "application/json",
                  },
                }
              );

              const { publish_id, upload_url } = initResponse.data.data;

              // Step 2: Download and upload video file
              const videoResponse = await axios.get(videoUrl, {
                responseType: "stream",
              });

              await axios.put(upload_url, videoResponse.data, {
                headers: {
                  "Content-Type": "video/mp4",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
              });

              // Step 3: Check publish status (async, will be processed by TikTok)
              const publishId = publish_id;

              // Save to database with processing status
              await Post.create({
                userId: req.userId,
                platform: "TikTok",
                platformPostId: publishId,
                content: content,
                videoUrl: videoUrl,
                status: "processing",
              });

              results.TikTok = {
                message: "TikTok video upload initiated",
                publishId: publishId,
                note: "Video is being processed. Check status using /api/tiktok/upload-status/:publishId",
              };
            } catch (videoError) {
              console.error("TikTok video posting error:", videoError.response?.data || videoError.message);
              results.TikTok = {
                error: `Video upload failed: ${videoError.response?.data?.error?.message || videoError.message}`,
                note: "For better video upload support, use /api/tiktok/upload endpoint with file upload",
              };
            }
          } else {
            // Text-only post (TikTok doesn't support text-only posts)
            console.log("TikTok text post - TikTok requires video for publishing");

            // Save to database as draft
            await Post.create({
              userId: req.userId,
              platform: "TikTok",
              platformPostId: `tiktok-draft-${Date.now()}`,
              content: content,
              imageUrl: imageUrl,
              status: "draft",
            });

            results.TikTok = {
              message: "TikTok post saved as draft",
              postId: `tiktok-draft-${Date.now()}`,
              note: "TikTok requires video for publishing. Use /api/tiktok/upload endpoint to upload a video.",
            };
          }
        } catch (error) {
          console.error("TikTok posting error:", error.message);
          results.TikTok = { error: "Failed to post to TikTok" };
        }
      }
    }

    if (platforms.includes("LinkedIn")) {
      const linkedinAccount = accounts.find(
        (acc) => acc.platform === "LinkedIn"
      );
      if (!linkedinAccount) {
        console.warn("LinkedIn not connected for userId:", req.userId);
        results.LinkedIn = { error: "LinkedIn not connected" };
      } else {
        try {
          const accessToken = linkedinAccount.accessToken;
          const personUrn =
            linkedinAccount.displayName === "LinkedIn User"
              ? "urn:li:person:your-linkedin-id"
              : linkedinAccount.displayName;

          if (imageUrl) {
            console.log("Posting to LinkedIn with image...");
            const initResponse = await axios.post(
            "https://api.linkedin.com/v2/assets?action=registerUpload",
            {
              registerUploadRequest: {
                owner: personUrn,
                recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
                serviceRelationships: [
                  {
                    identifier: "urn:li:userGeneratedContent",
                    relationshipType: "OWNER",
                  },
                ],
              },
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
          const uploadUrl =
            initResponse.data.value.uploadMechanism[
              "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
            ].uploadUrl;
          const assetUrn = initResponse.data.value.asset;
          console.log("LinkedIn image upload initialized:", {
            uploadUrl,
            assetUrn,
          });

          const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
          });
          await axios.put(uploadUrl, Buffer.from(imageResponse.data), {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "image/jpeg",
            },
          });
          console.log("Image uploaded to LinkedIn");

          const postResponse = await axios.post(
            "https://api.linkedin.com/v2/ugcPosts",
            {
              author: personUrn,
              lifecycleState: "PUBLISHED",
              specificContent: {
                "com.linkedin.ugc.ShareContent": {
                  shareCommentary: { text: content },
                  shareMediaCategory: "IMAGE",
                  media: [
                    {
                      status: "READY",
                      media: assetUrn,
                    },
                  ],
                },
              },
              visibility: {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
              },
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
          console.log(
            "LinkedIn post with image created:",
            postResponse.data.id
          );

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "LinkedIn",
            platformPostId: postResponse.data.id,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.LinkedIn = {
            message: "Post created",
            postId: postResponse.data.id,
          };
        } else {
          console.log("Posting to LinkedIn (text only)...");
          const postResponse = await axios.post(
            "https://api.linkedin.com/v2/ugcPosts",
            {
              author: personUrn,
              lifecycleState: "PUBLISHED",
              specificContent: {
                "com.linkedin.ugc.ShareContent": {
                  shareCommentary: { text: content },
                  shareMediaCategory: "NONE",
                },
              },
              visibility: {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
              },
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            }
          );
          console.log("LinkedIn text post created:", postResponse.data.id);

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "LinkedIn",
            platformPostId: postResponse.data.id,
            content: content,
            status: "published",
          });

          results.LinkedIn = {
            message: "Post created",
            postId: postResponse.data.id,
          };
        }
        } catch (err) {
          console.error("LinkedIn error:", err.message);
          results.LinkedIn = { error: err.message || "Failed to post to LinkedIn" };
        }
      }
    }

    // YouTube posting (text only - for video uploads use dedicated endpoint)
    if (platforms.includes("YouTube")) {
      const youtubeAccount = accounts.find((acc) => acc.platform === "YouTube");
      if (!youtubeAccount) {
        console.warn("YouTube not connected for userId:", req.userId);
        results.YouTube = { error: "YouTube not connected" };
      } else {
        try {
          console.log("Posting to YouTube (text only)...");
          // For now, we'll create a mock post since YouTube requires video upload
          // In a real implementation, you would need to handle video file uploads
          console.log("YouTube post created (mock for demo)");

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "YouTube",
            platformPostId: `youtube-${Date.now()}`,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.YouTube = {
            message: "YouTube post created (demo mode)",
            postId: `youtube-${Date.now()}`,
            note: "For video uploads, use the dedicated YouTube upload endpoint",
          };
        } catch (error) {
          console.error("YouTube posting error:", error.message);
          results.YouTube = { error: "Failed to post to YouTube" };
        }
      }
    }

    // WhatsApp posting
    if (platforms.includes("WhatsApp")) {
      const whatsappAccount = accounts.find(
        (acc) => acc.platform === "WhatsApp"
      );
      if (!whatsappAccount) {
        console.warn("WhatsApp not connected for userId:", req.userId);
        results.WhatsApp = { error: "WhatsApp not connected" };
      } else {
        try {
          console.log("Posting to WhatsApp...");
          // Mock WhatsApp posting - in real implementation, you would use WhatsApp Business API
          console.log("WhatsApp message sent (mock for demo)");

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "WhatsApp",
            platformPostId: `whatsapp-${Date.now()}`,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.WhatsApp = {
            message: "WhatsApp message sent (demo mode)",
            messageId: `whatsapp-${Date.now()}`,
            note: "This is a demo implementation",
          };
        } catch (error) {
          console.error("WhatsApp posting error:", error.message);
          results.WhatsApp = { error: "Failed to send WhatsApp message" };
        }
      }
    }

    // Telegram posting
    if (platforms.includes("Telegram")) {
      const telegramAccount = accounts.find(
        (acc) => acc.platform === "Telegram"
      );
      if (!telegramAccount) {
        console.warn("Telegram not connected for userId:", req.userId);
        results.Telegram = { error: "Telegram not connected" };
      } else {
        try {
          console.log("Posting to Telegram...");
          // Mock Telegram posting - in real implementation, you would use Telegram Bot API
          console.log("Telegram message sent (mock for demo)");

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "Telegram",
            platformPostId: `telegram-${Date.now()}`,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.Telegram = {
            message: "Telegram message sent (demo mode)",
            messageId: `telegram-${Date.now()}`,
            note: "This is a demo implementation",
          };
        } catch (error) {
          console.error("Telegram posting error:", error.message);
          results.Telegram = { error: "Failed to send Telegram message" };
        }
      }
    }

    console.log("Posting completed:", results);
    res.json(results);
  } catch (error) {
    console.error(
      "General posting error:",
      error.response?.data || error.message,
      error.stack
    );
    res.status(500).json({
      error: "Failed to post",
      message: error.message || "Unknown error",
      ...(process.env.NODE_ENV !== "production" && {
        details: error.response?.data,
        stack: error.stack,
      }),
    });
  }
});

export default router;
