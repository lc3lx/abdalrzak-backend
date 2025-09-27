import express from "express";
import AutoReplyFlow from "../../models/AutoReplyFlow.js";
import AutoReplyExecution from "../../models/AutoReplyExecution.js";
import Message from "../../models/Message.js";
import Account from "../../models/Account.js";
import { TwitterApi } from "twitter-api-v2";
import FB from "fb";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Process incoming message for auto replies
router.post("/auto-reply/process", authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.body;

    const message = await Message.findOne({
      _id: messageId,
      userId: req.userId,
    });

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Find applicable auto reply flows
    const flows = await AutoReplyFlow.find({
      userId: req.userId,
      platform: { $in: [message.platform, "All"] },
      isActive: true,
    });

    const triggeredFlows = [];

    for (const flow of flows) {
      if (shouldTriggerFlow(flow, message)) {
        const execution = await createFlowExecution(flow, message);
        triggeredFlows.push({
          flowId: flow._id,
          flowName: flow.name,
          executionId: execution._id,
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

  // Check keyword triggers
  if (triggerKeywords && triggerKeywords.length > 0) {
    const messageText = message.content.toLowerCase();
    const hasKeyword = triggerKeywords.some((keyword) =>
      messageText.includes(keyword.toLowerCase())
    );
    if (hasKeyword) return true;
  }

  // Check other conditions
  if (triggerConditions.type === "message_type") {
    return message.messageType === triggerConditions.value;
  }

  if (triggerConditions.type === "sender") {
    return message.senderId === triggerConditions.value;
  }

  if (triggerConditions.type === "time") {
    // Time-based triggers would be implemented here
    return false;
  }

  return false;
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

  const execution = new AutoReplyExecution({
    flowId: flow._id,
    userId: flow.userId,
    originalMessageId: message._id,
    platform: message.platform,
    senderId: message.senderId,
    senderName: message.senderName,
    nextExecutionTime: new Date(), // Execute immediately for first step
  });

  await execution.save();

  // Update flow statistics
  await AutoReplyFlow.findByIdAndUpdate(flow._id, {
    $inc: { "statistics.totalTriggers": 1 },
    $set: { "statistics.lastTriggered": new Date() },
  });

  return execution;
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

  // Check if step should execute based on condition
  if (!shouldExecuteStep(currentStep, execution)) {
    // Move to next step
    execution.currentStep = currentStep.nextStep || execution.currentStep + 1;
    execution.nextExecutionTime = new Date();
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
  }

  // Set next execution time
  if (currentStep.stepType === "delayed_reply" && currentStep.delay > 0) {
    execution.nextExecutionTime = new Date(
      Date.now() + currentStep.delay * 60 * 1000
    );
  } else {
    execution.nextExecutionTime = new Date();
  }

  // Move to next step or complete
  if (currentStep.isEndStep) {
    execution.status = "completed";
  } else {
    execution.currentStep = currentStep.nextStep || execution.currentStep + 1;
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
function shouldExecuteStep(step, execution) {
  if (step.condition === "always") return true;
  if (step.condition === "contains_keyword") {
    // This would check if the original message contains the keyword
    return true; // Simplified for now
  }
  if (step.condition === "time_based") {
    // Check if current time matches the condition
    return true; // Simplified for now
  }
  if (step.condition === "sender_based") {
    // Check if sender matches the condition
    return true; // Simplified for now
  }
  return false;
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
    FB.setAccessToken(account.accessToken);

    const replyData = {
      message: step.replyContent,
    };

    if (step.replyImage) {
      replyData.attachment = {
        type: "image",
        payload: {
          url: step.replyImage,
        },
      };
    }

    const response = await new Promise((resolve, reject) => {
      FB.api(
        `/${execution.originalMessageId}/messages`,
        "POST",
        replyData,
        (res) => {
          res.error ? reject(res.error) : resolve(res);
        }
      );
    });

    return {
      success: true,
      messageId: response.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
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
    if (!account.accessToken || !account.pageId) {
      throw new Error("WhatsApp account not properly configured");
    }

    // Get the original message to find the recipient
    const originalMessage = await Message.findById(execution.originalMessageId);
    if (!originalMessage) {
      throw new Error("Original message not found");
    }

    const recipientPhoneNumber = originalMessage.senderId; // In WhatsApp, senderId is the phone number
    const messageData = {
      messaging_product: "whatsapp",
      to: recipientPhoneNumber,
      type: "text",
      text: { body: step.replyContent },
    };

    // Add image if provided
    if (step.replyImage) {
      messageData.type = "image";
      messageData.image = {
        link: step.replyImage,
        caption: step.replyContent,
      };
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${account.pageId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageData),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error?.message || "Failed to send WhatsApp message"
      );
    }

    return {
      success: true,
      messageId: result.messages?.[0]?.id || `whatsapp_${Date.now()}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default router;
