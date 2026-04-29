import express from "express";
import axios from "axios";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import Account from "../../models/Account.js";
import Post from "../../models/Post.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  getTikTokApiError,
  initTikTokPhotoPost,
  initTikTokVideoPostFromUrl,
  pickTikTokPrivacyLevel,
  queryTikTokCreatorInfo,
  refreshTikTokTokenIfNeeded,
} from "../../services/tiktok.js";
import {
  getWhatsAppApiError,
  sendWhatsAppMessage,
} from "../../services/whatsapp.js";

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
  let { content, platforms, imageUrl, videoUrl, whatsappTo, phoneNumber, to } = req.body;
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
      } else if (!imageUrl && !videoUrl) {
        results.Instagram = { error: "Image or video required for Instagram posting" };
      } else {
        let igPublished = false;
        const apiVersion = "v21.0";
        const instagramVideoUrl =
          videoUrl || (imageUrl && isVideoUrl(imageUrl) ? imageUrl : null);
        const instagramImageUrl =
          imageUrl && !isVideoUrl(imageUrl) ? imageUrl : null;

        // ——— 1) Try Instagram Login API (graph.instagram.com) ———
        const accessToken = (instagramAccount.accessToken || "").toString().trim();
        const igUserId =
          instagramAccount.platformId ||
          instagramAccount.pageId ||
          instagramAccount.channelId;

        if (igUserId && accessToken) {
          try {
            console.log("Posting to Instagram via Instagram Login API (graph.instagram.com)...");
            const mediaPayload = instagramVideoUrl
              ? {
                  media_type: "REELS",
                  video_url: instagramVideoUrl,
                  caption: content || "",
                }
              : { image_url: instagramImageUrl, caption: content || "" };
            const mediaRes = await axios.post(
              `https://graph.instagram.com/${apiVersion}/${igUserId}/media`,
              mediaPayload,
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
              imageUrl: instagramImageUrl,
              videoUrl: instagramVideoUrl,
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
              const mediaParams = instagramVideoUrl
                ? {
                    media_type: "REELS",
                    video_url: instagramVideoUrl,
                    caption: content || "",
                    access_token: pageToken,
                  }
                : {
                    image_url: instagramImageUrl,
                    caption: content || "",
                    access_token: pageToken,
                  };
              const mediaRes = await axios.post(
                `https://graph.facebook.com/${apiVersion}/${igBusinessId}/media`,
                null,
                {
                  params: mediaParams,
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
                imageUrl: instagramImageUrl,
                videoUrl: instagramVideoUrl,
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

          await refreshTikTokTokenIfNeeded(tiktokAccount, req.userId);
          const creatorInfo = await queryTikTokCreatorInfo(tiktokAccount.accessToken);
          const privacyLevel = pickTikTokPrivacyLevel(creatorInfo);

          if (videoUrl) {
            try {
              console.log("Posting video to TikTok from URL...");
              const initData = await initTikTokVideoPostFromUrl({
                accessToken: tiktokAccount.accessToken,
                title: content || "Video Post",
                videoUrl,
                privacyLevel,
              });

              // Save to database with processing status
              await Post.create({
                userId: req.userId,
                platform: "TikTok",
                platformPostId: initData.publish_id,
                content: content,
                videoUrl: videoUrl,
                status: "processing",
              });

              results.TikTok = {
                message: "TikTok video upload initiated",
                publishId: initData.publish_id,
                privacyLevel,
                note: "Video is being processed. Check status using /api/tiktok/upload-status/:publishId",
              };
            } catch (videoError) {
              console.error("TikTok video posting error:", videoError.response?.data || videoError.message);
              results.TikTok = {
                error: `Video upload failed: ${getTikTokApiError(videoError)}`,
                note: "TikTok PULL_FROM_URL requires a public HTTPS URL from a verified domain. For local files, use /api/tiktok/upload.",
              };
            }
          } else if (imageUrl) {
            try {
              console.log("Posting photo to TikTok from URL...");
              const initData = await initTikTokPhotoPost({
                accessToken: tiktokAccount.accessToken,
                title: content?.slice(0, 90) || "Photo Post",
                description: content || "",
                photoUrls: [imageUrl],
                privacyLevel,
              });

              await Post.create({
                userId: req.userId,
                platform: "TikTok",
                platformPostId: initData.publish_id,
                content: content,
                imageUrl: imageUrl,
                status: "processing",
              });

              results.TikTok = {
                message: "TikTok photo post initiated",
                publishId: initData.publish_id,
                privacyLevel,
                note: "Photo is being processed. Check status using /api/tiktok/upload-status/:publishId",
              };
            } catch (photoError) {
              console.error("TikTok photo posting error:", photoError.response?.data || photoError.message);
              results.TikTok = {
                error: `Photo upload failed: ${getTikTokApiError(photoError)}`,
                note: "TikTok photo posting requires public HTTPS image URLs from a verified domain.",
              };
            }
          } else {
            console.log("TikTok text post - TikTok requires video for publishing");
            results.TikTok = {
              error: "TikTok does not support text-only posting through the Content Posting API.",
              note: "Attach a video or image URL, or use /api/tiktok/upload for a local video file.",
            };
          }
        } catch (error) {
          console.error("TikTok posting error:", error.message);
          results.TikTok = { error: getTikTokApiError(error) };
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
          const recipient = whatsappTo || phoneNumber || to;
          if (!recipient) {
            throw new Error("WhatsApp recipient phone number is required");
          }

          const sendResult = await sendWhatsAppMessage({
            phoneNumberId: whatsappAccount.pageId,
            accessToken: whatsappAccount.accessToken,
            to: recipient,
            content,
            imageUrl,
          });

          // Save to database
          await Post.create({
            userId: req.userId,
            platform: "WhatsApp",
            platformPostId: sendResult.messageId || `whatsapp-${Date.now()}`,
            content: content,
            imageUrl: imageUrl,
            status: "published",
          });

          results.WhatsApp = {
            message: "WhatsApp message sent",
            messageId: sendResult.messageId,
            recipient: sendResult.recipient,
          };
        } catch (error) {
          console.error("WhatsApp posting error:", error.message);
          results.WhatsApp = { error: getWhatsAppApiError(error) };
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
