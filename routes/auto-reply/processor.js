import express from "express";
import AutoReplyFlow from "../../models/AutoReplyFlow.js";
import AutoReplyExecution from "../../models/AutoReplyExecution.js";
import Message from "../../models/Message.js";
import Account from "../../models/Account.js";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import { authMiddleware } from "../../middleware/auth.js";
import {
  getUnsupportedTikTokCommentsMessage,
  getUnsupportedTikTokMessagesMessage,
} from "../../services/tiktok.js";
import {
  getWhatsAppApiError,
  sendWhatsAppMessage,
} from "../../services/whatsapp.js";

const router = express.Router();

let isAutoReplyWorkerRunning = false;

async function runDueAutoReplies() {
  if (isAutoReplyWorkerRunning) return;
  isAutoReplyWorkerRunning = true;

  try {
    const pendingExecutions = await AutoReplyExecution.find({
      status: "active",
      nextExecutionTime: { $lte: new Date() },
    }).limit(50);

    for (const execution of pendingExecutions) {
      try {
        await executeDueSteps(execution);
      } catch (error) {
        console.error(
          `Auto-reply worker failed for execution ${execution._id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error("Auto-reply worker error:", error.message);
  } finally {
    isAutoReplyWorkerRunning = false;
  }
}

if (!globalThis.__smartSocialAutoReplyWorker) {
  globalThis.__smartSocialAutoReplyWorker = setInterval(
    runDueAutoReplies,
    60 * 1000
  );
  globalThis.__smartSocialAutoReplyWorker.unref?.();
}

async function autoReplyProcessAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  const internalToken = process.env.INTERNAL_API_TOKEN || "internal";

  if (token === internalToken) {
    try {
      if (req.body.messageId) {
        const message = await Message.findById(req.body.messageId);
        if (!message) {
          return res.status(404).json({ error: "Message not found" });
        }
        req.userId = message.userId;
        return next();
      }

      if (req.body.commentId) {
        const Comment = (await import("../../models/Comment.js")).default;
        const Post = (await import("../../models/Post.js")).default;
        const comment = await Comment.findById(req.body.commentId);
        if (!comment) {
          return res.status(404).json({ error: "Comment not found" });
        }
        const post = await Post.findById(comment.postId);
        if (!post) {
          return res.status(404).json({ error: "Post not found" });
        }
        req.userId = post.userId;
        return next();
      }
    } catch (error) {
      return res.status(500).json({ error: "Failed to authorize auto-reply processing" });
    }
  }

  return authMiddleware(req, res, next);
}

// Process incoming message for auto replies
router.post("/auto-reply/process", autoReplyProcessAuth, async (req, res) => {
  try {
    const { messageId, commentId } = req.body;

    // Support both messages and comments
    let message;
    if (messageId) {
      message = await Message.findOne({
        _id: messageId,
        userId: req.userId,
      });
    } else if (commentId) {
      // Convert comment to message format for processing
      const Comment = (await import("../../models/Comment.js")).default;
      const Post = (await import("../../models/Post.js")).default;
      
      const comment = await Comment.findById(commentId);
      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      const post = await Post.findById(comment.postId);
      if (!post || post.userId.toString() !== req.userId.toString()) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Create message from comment
      message = await Message.findOneAndUpdate(
        {
          platformMessageId: comment.platformCommentId,
          platform: comment.platform,
          messageType: "comment",
        },
        {
          userId: req.userId,
          platform: comment.platform,
          platformMessageId: comment.platformCommentId,
          senderId: comment.authorId,
          senderName: comment.authorName,
          content: comment.content,
          messageType: "comment",
          receivedAt: comment.createdAt,
          isRead: false,
          isArchived: false,
        },
        { upsert: true, new: true }
      );
    }

    if (!message) {
      return res.status(404).json({ error: "Message or comment not found" });
    }

    // Find applicable auto reply flows
    const flows = await AutoReplyFlow.find({
      userId: req.userId,
      platform: { $in: [message.platform, "All"] },
      isActive: true,
    });

    const triggeredFlows = [];

    for (const flow of flows) {
      try {
        if (shouldTriggerFlow(flow, message)) {
          const execution = await createFlowExecution(flow, message);
          const executionResults = await executeDueSteps(execution);
          triggeredFlows.push({
            flowId: flow._id,
            flowName: flow.name,
            executionId: execution._id,
            executionResults,
          });
        }
      } catch (flowError) {
        console.error(`Auto-reply flow ${flow._id} failed:`, flowError.message);
        triggeredFlows.push({
          flowId: flow._id,
          flowName: flow.name,
          error: flowError.message,
        });
      }
    }

    res.json({
      success: true,
      triggeredFlows,
      message: `Processed ${triggeredFlows.length} auto reply flows`,
    });
  } catch (error) {
    console.error("Error processing auto reply:", error);
    res.status(500).json({ error: "Failed to process auto reply" });
  }
});

// Execute pending auto reply steps
router.post("/auto-reply/execute", authMiddleware, async (req, res) => {
  try {
    const now = new Date();
    const pendingExecutions = await AutoReplyExecution.find({
      userId: req.userId,
      status: "active",
      nextExecutionTime: { $lte: now },
    });

    const results = [];

    for (const execution of pendingExecutions) {
      try {
        const result = await executeNextStep(execution);
        results.push(result);
      } catch (error) {
        console.error(`Error executing flow ${execution.flowId}:`, error);
        results.push({
          executionId: execution._id,
          success: false,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      executed: results.length,
      results,
    });
  } catch (error) {
    console.error("Error executing auto replies:", error);
    res.status(500).json({ error: "Failed to execute auto replies" });
  }
});

// Helper function to check if flow should trigger
function shouldTriggerFlow(flow, message) {
  const { triggerConditions, triggerKeywords } = flow;
  const messageText = (message.content || "").toLowerCase();

  if (!isWithinWorkingHours(flow)) {
    return false;
  }

  // Check keyword triggers
  const keywords = [
    ...(triggerKeywords || []),
    ...(triggerConditions?.type === "keyword" && triggerConditions?.value
      ? [triggerConditions.value]
      : []),
  ].filter(Boolean);

  if (keywords.length > 0) {
    return keywords.some((keyword) =>
      messageText.includes(keyword.toLowerCase())
    );
  }

  // Check other conditions
  if (triggerConditions?.type === "message_type") {
    return message.messageType === triggerConditions.value;
  }

  if (triggerConditions?.type === "sender") {
    return message.senderId === triggerConditions.value;
  }

  if (triggerConditions?.type === "time") {
    return true;
  }

  // No trigger configured means this flow applies to all incoming messages
  // for its selected platform.
  return true;
}

// Create flow execution
async function createFlowExecution(flow, message) {
  // Check if user has reached max replies
  const existingExecutions = await AutoReplyExecution.countDocuments({
    flowId: flow._id,
    senderId: message.senderId,
    createdAt: {
      $gte: new Date(
        Date.now() - flow.settings.cooldownPeriod * 60 * 60 * 1000
      ),
    },
  });

  if (existingExecutions >= flow.settings.maxRepliesPerUser) {
    throw new Error("Max replies per user reached");
  }

  const firstStep = getStepByNumber(flow, 1);
  const execution = new AutoReplyExecution({
    flowId: flow._id,
    userId: flow.userId,
    originalMessageId: message._id,
    platform: message.platform,
    senderId: message.senderId,
    senderName: message.senderName,
    nextExecutionTime: firstStep
      ? getNextExecutionTimeForStep(firstStep)
      : new Date(),
  });

  await execution.save();

  // Update flow statistics
  await AutoReplyFlow.findByIdAndUpdate(flow._id, {
    $inc: { "statistics.totalTriggers": 1 },
    $set: { "statistics.lastTriggered": new Date() },
  });

  return execution;
}

async function executeDueSteps(execution, maxSteps = 10) {
  const results = [];
  let guard = 0;

  while (
    execution.status === "active" &&
    execution.nextExecutionTime &&
    execution.nextExecutionTime <= new Date() &&
    guard < maxSteps
  ) {
    const result = await executeNextStep(execution);
    results.push(result);
    guard += 1;

    if (execution.status !== "active" || execution.nextExecutionTime > new Date()) {
      break;
    }
  }

  if (guard >= maxSteps) {
    execution.status = "failed";
    execution.executedSteps.push({
      stepNumber: execution.currentStep,
      executedAt: new Date(),
      success: false,
      error: "Auto-reply flow stopped because it exceeded the step execution limit.",
    });
    await execution.save();
    results.push({
      executionId: execution._id,
      success: false,
      error: "Step execution limit exceeded",
    });
  }

  return results;
}

// Execute next step in flow
async function executeNextStep(execution) {
  const flow = await AutoReplyFlow.findById(execution.flowId);
  if (!flow) {
    throw new Error("Flow not found");
  }

  const currentStep = flow.flowSteps.find(
    (step) => step.stepNumber === execution.currentStep
  );
  if (!currentStep) {
    // Flow completed
    execution.status = "completed";
    await execution.save();
    return { executionId: execution._id, success: true, completed: true };
  }

  if (currentStep.stepType === "end") {
    execution.status = "completed";
    execution.executedSteps.push({
      stepNumber: currentStep.stepNumber,
      executedAt: new Date(),
      replyContent: "",
      success: true,
    });
    await execution.save();
    return { executionId: execution._id, success: true, completed: true };
  }

  const originalMessage = await Message.findById(execution.originalMessageId);
  if (!originalMessage) {
    throw new Error("Original message not found");
  }

  // Check if step should execute based on condition
  if (!shouldExecuteStep(currentStep, execution, originalMessage)) {
    // Move to next step
    execution.currentStep = currentStep.nextStep || execution.currentStep + 1;
    const nextStep = getStepByNumber(flow, execution.currentStep);
    execution.nextExecutionTime = nextStep
      ? getNextExecutionTimeForStep(nextStep)
      : new Date();
    await execution.save();
    return { executionId: execution._id, success: true, skipped: true };
  }

  // Execute the step
  const account = await Account.findOne({
    userId: execution.userId,
    platform: execution.platform,
  });

  if (!account) {
    throw new Error("Account not found for platform");
  }

  let replyResult;
  if (execution.platform === "Twitter") {
    replyResult = await sendTwitterReply(account, execution, currentStep);
  } else if (execution.platform === "Facebook") {
    replyResult = await sendFacebookReply(account, execution, currentStep);
  } else if (execution.platform === "Instagram") {
    replyResult = await sendInstagramReply(account, execution, currentStep);
  } else if (execution.platform === "TikTok") {
    replyResult = await sendTikTokReply(account, execution, currentStep);
  } else if (execution.platform === "LinkedIn") {
    replyResult = await sendLinkedInReply(account, execution, currentStep);
  } else if (execution.platform === "Telegram") {
    replyResult = await sendTelegramReply(account, execution, currentStep);
  } else if (execution.platform === "WhatsApp") {
    replyResult = await sendWhatsAppReply(account, execution, currentStep);
  } else {
    throw new Error("Unsupported platform");
  }

  if (replyResult.success) {
    // Record executed step
    execution.executedSteps.push({
      stepNumber: currentStep.stepNumber,
      executedAt: new Date(),
      replyContent: currentStep.replyContent,
      replyMessageId: replyResult.messageId,
      success: true,
    });

    execution.totalReplies += 1;
    execution.lastActivity = new Date();

    // Update flow statistics
    await AutoReplyFlow.findByIdAndUpdate(flow._id, {
      $inc: { "statistics.totalReplies": 1 },
    });
  } else {
    execution.executedSteps.push({
      stepNumber: currentStep.stepNumber,
      executedAt: new Date(),
      replyContent: currentStep.replyContent,
      success: false,
      error: replyResult.error,
    });
    execution.status = "failed";
  }

  // Move to next step or complete
  if (currentStep.isEndStep) {
    execution.status = "completed";
  } else {
    execution.currentStep = currentStep.nextStep || execution.currentStep + 1;
    const nextStep = getStepByNumber(flow, execution.currentStep);
    execution.nextExecutionTime =
      execution.status === "active" && nextStep
        ? getNextExecutionTimeForStep(nextStep)
        : new Date();
  }

  await execution.save();

  return {
    executionId: execution._id,
    success: replyResult.success,
    stepExecuted: currentStep.stepNumber,
    replyId: replyResult.messageId,
    error: replyResult.error,
  };
}

// Check if step should execute
function shouldExecuteStep(step, execution, originalMessage) {
  if (step.condition === "always") return true;
  if (step.condition === "contains_keyword") {
    const needle = (step.conditionValue || "").toLowerCase();
    if (!needle) return true;
    return (originalMessage.content || "").toLowerCase().includes(needle);
  }
  if (step.condition === "time_based") {
    return isTimeConditionMatched(step.conditionValue);
  }
  if (step.condition === "sender_based") {
    return originalMessage.senderId === step.conditionValue;
  }
  return false;
}

function getStepByNumber(flow, stepNumber) {
  return flow.flowSteps.find((step) => step.stepNumber === stepNumber);
}

function getNextExecutionTimeForStep(step) {
  if (step?.stepType === "delayed_reply" && Number(step.delay) > 0) {
    return new Date(Date.now() + Number(step.delay) * 60 * 1000);
  }

  return new Date();
}

function isTimeConditionMatched(conditionValue) {
  if (!conditionValue) return true;
  const [start, end] = String(conditionValue).split("-").map((part) => part.trim());
  if (!start || !end) return true;

  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  return start <= end
    ? current >= start && current <= end
    : current >= start || current <= end;
}

function isWithinWorkingHours(flow) {
  const workingHours = flow.settings?.workingHours;
  if (!workingHours?.enabled) return true;

  return isTimeConditionMatched(
    `${workingHours.startTime || "00:00"}-${workingHours.endTime || "23:59"}`
  );
}

// Send Twitter reply
async function sendTwitterReply(account, execution, step) {
  try {
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    });

    const response = await twitterClient.v2.sendDm({
      text: step.replyContent,
      direct_message_id: execution.originalMessageId,
    });

    return {
      success: true,
      messageId: response.data.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Send Facebook reply
async function sendFacebookReply(account, execution, step) {
  try {
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) {
      throw new Error("Original message not found");
    }

    if (originalMessage.messageType === "comment") {
      FB.setAccessToken(account.accessToken);
      const response = await new Promise((resolve, reject) => {
        FB.api(
          `/${originalMessage.platformMessageId}/comments`,
          "POST",
          { message: step.replyContent },
          (res) => (res.error ? reject(res.error) : resolve(res))
        );
      });

      return {
        success: true,
        messageId: response.id,
      };
    }

    if (!account.pageId) {
      throw new Error("Facebook page ID is missing");
    }

    const message = step.replyImage
      ? {
          attachment: {
            type: "image",
            payload: { url: step.replyImage },
          },
        }
      : { text: step.replyContent };

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${account.pageId}/messages?access_token=${encodeURIComponent(account.accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: originalMessage.senderId },
          messaging_type: "RESPONSE",
          message,
        }),
      }
    );
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || "Failed to send Facebook message");
    }

    return {
      success: true,
      messageId: result.message_id || result.recipient_id || `facebook_${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
}

// Send LinkedIn reply
async function sendLinkedInReply(account, execution, step) {
  try {
    // LinkedIn implementation would go here
    return {
      success: true,
      messageId: `linkedin_auto_reply_${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Send Telegram reply
async function sendTelegramReply(account, execution, step) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      throw new Error("Telegram bot token not configured");
    }

    // Get the original message to find the chat ID
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) {
      throw new Error("Original message not found");
    }

    const chatId = originalMessage.senderId; // In Telegram, senderId is the chat ID
    const replyData = {
      chat_id: chatId,
      text: step.replyContent,
    };

    // Add reply to message if it's a reply
    if (originalMessage.platformMessageId) {
      replyData.reply_to_message_id = originalMessage.platformMessageId;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replyData),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.description || "Failed to send Telegram message");
    }

    return {
      success: true,
      messageId: result.result.message_id.toString(),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Send WhatsApp reply
async function sendWhatsAppReply(account, execution, step) {
  try {
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) {
      throw new Error("Original message not found");
    }

    const result = await sendWhatsAppMessage({
      phoneNumberId: account.pageId,
      accessToken: account.accessToken,
      to: originalMessage.senderId,
      content: step.replyContent,
      imageUrl: step.replyImage,
    });

    return {
      success: true,
      messageId: result.messageId || `whatsapp_${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: getWhatsAppApiError(error),
    };
  }
}
// Send Instagram reply
async function sendInstagramReply(account, execution, step) {
  try {
    // Determine the correct message original ID or sender
    // For comments, we use the graph API /replies. For DMs, we use /messages.
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) throw new Error("Original message not found");

    if (originalMessage.messageType === "comment") {
      // Reply to an Instagram comment
      const response = await fetch(
        `https://graph.instagram.com/v21.0/${originalMessage.platformMessageId}/replies`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.accessToken}`
          },
          body: JSON.stringify({ message: step.replyContent })
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Failed to reply to Instagram comment");
      return { success: true, messageId: result.id };
    } else {
      if (!account.platformId) {
        throw new Error("Instagram account ID is missing. Reconnect Instagram.");
      }

      // Reply to an Instagram DM
      const response = await fetch(
        `https://graph.instagram.com/v21.0/${account.platformId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.accessToken}`
          },
          body: JSON.stringify({
            recipient: { id: originalMessage.senderId },
            messaging_type: "RESPONSE",
            message: { text: step.replyContent }
          })
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Failed to send Instagram DM reply");
      return { success: true, messageId: result.message_id || result.recipient_id || `ig_reply_${Date.now()}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Send TikTok reply
async function sendTikTokReply(account, execution, step) {
  try {
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) throw new Error("Original message not found");

    const error =
      originalMessage.messageType === "comment"
        ? getUnsupportedTikTokCommentsMessage()
        : getUnsupportedTikTokMessagesMessage();

    return { success: false, error };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default router;
