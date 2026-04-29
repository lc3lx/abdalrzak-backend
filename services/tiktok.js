import axios from "axios";
import fs from "fs";
import Account from "../models/Account.js";

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";
const MAX_CHUNK_SIZE = 64 * 1024 * 1024;

export function getTikTokApiError(error) {
  const apiError = error.response?.data?.error;
  return (
    apiError?.message ||
    apiError?.code ||
    error.response?.data?.message ||
    error.message ||
    "TikTok API request failed"
  );
}

export function getUnsupportedTikTokCommentsMessage() {
  return "TikTok comments are not available through the public TikTok Content Posting API used by this app.";
}

export function getUnsupportedTikTokMessagesMessage() {
  return "TikTok direct messages are not available through the public TikTok API used by this app.";
}

export async function refreshTikTokTokenIfNeeded(account, userId) {
  if (!account?.expiresAt || new Date() <= account.expiresAt) {
    return account;
  }

  if (!account.refreshToken) {
    throw new Error("TikTok token expired and no refresh token is available");
  }

  const refreshResponse = await axios.post(
    `${TIKTOK_API_BASE}/oauth/token/`,
    new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, refresh_token, expires_in } = refreshResponse.data;

  await Account.findOneAndUpdate(
    { userId, platform: "TikTok" },
    {
      accessToken: access_token,
      refreshToken: refresh_token || account.refreshToken,
      expiresAt: new Date(Date.now() + expires_in * 1000),
    }
  );

  account.accessToken = access_token;
  account.refreshToken = refresh_token || account.refreshToken;
  account.expiresAt = new Date(Date.now() + expires_in * 1000);
  return account;
}

export async function queryTikTokCreatorInfo(accessToken) {
  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/creator_info/query/`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );

  if (response.data?.error?.code && response.data.error.code !== "ok") {
    throw new Error(response.data.error.message || response.data.error.code);
  }

  return response.data.data || {};
}

export function pickTikTokPrivacyLevel(creatorInfo, requestedPrivacy) {
  const options = creatorInfo?.privacy_level_options || [];
  if (requestedPrivacy && options.includes(requestedPrivacy)) {
    return requestedPrivacy;
  }
  if (options.includes("PUBLIC_TO_EVERYONE")) {
    return "PUBLIC_TO_EVERYONE";
  }
  return options[0] || "SELF_ONLY";
}

function buildTikTokPostInfo({
  title,
  privacyLevel,
  disableComment = false,
  disableDuet = false,
  disableStitch = false,
  videoCoverTimestampMs = 1000,
  isAigc = false,
}) {
  return {
    title: title || "Video Post",
    privacy_level: privacyLevel,
    disable_duet: Boolean(disableDuet),
    disable_comment: Boolean(disableComment),
    disable_stitch: Boolean(disableStitch),
    video_cover_timestamp_ms: Number(videoCoverTimestampMs) || 1000,
    is_aigc: Boolean(isAigc),
  };
}

export function getTikTokVideoUploadPlan(videoSize) {
  if (!videoSize || videoSize <= 0) {
    throw new Error("Video file is empty or unreadable");
  }

  const chunkSize =
    videoSize <= MAX_CHUNK_SIZE ? videoSize : MAX_CHUNK_SIZE;

  return {
    chunkSize,
    totalChunkCount: Math.ceil(videoSize / chunkSize),
  };
}

export async function initTikTokVideoPostFromFile({
  accessToken,
  title,
  videoSize,
  privacyLevel,
  disableComment,
  disableDuet,
  disableStitch,
  videoCoverTimestampMs,
  isAigc,
}) {
  const { chunkSize, totalChunkCount } = getTikTokVideoUploadPlan(videoSize);

  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/video/init/`,
    {
      post_info: buildTikTokPostInfo({
        title,
        privacyLevel,
        disableComment,
        disableDuet,
        disableStitch,
        videoCoverTimestampMs,
        isAigc,
      }),
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );

  if (response.data?.error?.code && response.data.error.code !== "ok") {
    throw new Error(response.data.error.message || response.data.error.code);
  }

  return {
    ...response.data.data,
    chunkSize,
    totalChunkCount,
  };
}

export async function initTikTokVideoPostFromUrl({
  accessToken,
  title,
  videoUrl,
  privacyLevel,
  disableComment,
  disableDuet,
  disableStitch,
  videoCoverTimestampMs,
  isAigc,
}) {
  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/video/init/`,
    {
      post_info: buildTikTokPostInfo({
        title,
        privacyLevel,
        disableComment,
        disableDuet,
        disableStitch,
        videoCoverTimestampMs,
        isAigc,
      }),
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );

  if (response.data?.error?.code && response.data.error.code !== "ok") {
    throw new Error(response.data.error.message || response.data.error.code);
  }

  return response.data.data;
}

export async function uploadTikTokVideoFile({
  uploadUrl,
  filePath,
  mimeType = "video/mp4",
  videoSize,
  chunkSize,
}) {
  let start = 0;

  while (start < videoSize) {
    const end = Math.min(start + chunkSize, videoSize) - 1;
    const currentChunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });

    await axios.put(uploadUrl, stream, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": currentChunkSize,
        "Content-Range": `bytes ${start}-${end}/${videoSize}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (status) => status === 201 || status === 206,
    });

    start = end + 1;
  }
}

export async function initTikTokPhotoPost({
  accessToken,
  title,
  description,
  photoUrls,
  privacyLevel,
  disableComment = false,
  autoAddMusic = true,
  postMode = "DIRECT_POST",
  photoCoverIndex = 0,
}) {
  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/content/init/`,
    {
      post_info: {
        title: title || "Photo Post",
        description: description || title || "",
        privacy_level: privacyLevel,
        disable_comment: Boolean(disableComment),
        auto_add_music: Boolean(autoAddMusic),
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: photoCoverIndex,
        photo_images: photoUrls,
      },
      post_mode: postMode,
      media_type: "PHOTO",
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );

  if (response.data?.error?.code && response.data.error.code !== "ok") {
    throw new Error(response.data.error.message || response.data.error.code);
  }

  return response.data.data;
}

export async function fetchTikTokPublishStatus(accessToken, publishId) {
  const response = await axios.post(
    `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
    { publish_id: publishId },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
    }
  );

  if (response.data?.error?.code && response.data.error.code !== "ok") {
    throw new Error(response.data.error.message || response.data.error.code);
  }

  return response.data.data;
}
