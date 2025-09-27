import express from "express";
import AutoReplyFlow from "../../models/AutoReplyFlow.js";
import AutoReplyExecution from "../../models/AutoReplyExecution.js";
import Message from "../../models/Message.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

// Get all auto reply flows for user
router.get("/auto-reply/flows", authMiddleware, async (req, res) => {
  try {
    const flows = await AutoReplyFlow.find({ userId: req.userId }).sort({
      createdAt: -1,
    });

    res.json(flows);
  } catch (error) {
    console.error("Error fetching auto reply flows:", error);
    res.status(500).json({ error: "Failed to fetch auto reply flows" });
  }
});

// Get single auto reply flow
router.get("/auto-reply/flows/:flowId", authMiddleware, async (req, res) => {
  try {
    const flow = await AutoReplyFlow.findOne({
      _id: req.params.flowId,
      userId: req.userId,
    });

    if (!flow) {
      return res.status(404).json({ error: "Auto reply flow not found" });
    }

    res.json(flow);
  } catch (error) {
    console.error("Error fetching auto reply flow:", error);
    res.status(500).json({ error: "Failed to fetch auto reply flow" });
  }
});

// Create new auto reply flow
router.post("/auto-reply/flows", authMiddleware, async (req, res) => {
  try {
    const {
      name,
      description,
      platform,
      triggerKeywords,
      triggerConditions,
      flowSteps,
      settings,
    } = req.body;

    const flow = new AutoReplyFlow({
      userId: req.userId,
      name,
      description,
      platform,
      triggerKeywords,
      triggerConditions,
      flowSteps,
      settings,
    });

    await flow.save();
    res.status(201).json(flow);
  } catch (error) {
    console.error("Error creating auto reply flow:", error);
    res.status(500).json({ error: "Failed to create auto reply flow" });
  }
});

// Update auto reply flow
router.put("/auto-reply/flows/:flowId", authMiddleware, async (req, res) => {
  try {
    const flow = await AutoReplyFlow.findOneAndUpdate(
      { _id: req.params.flowId, userId: req.userId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!flow) {
      return res.status(404).json({ error: "Auto reply flow not found" });
    }

    res.json(flow);
  } catch (error) {
    console.error("Error updating auto reply flow:", error);
    res.status(500).json({ error: "Failed to update auto reply flow" });
  }
});

// Delete auto reply flow
router.delete("/auto-reply/flows/:flowId", authMiddleware, async (req, res) => {
  try {
    const flow = await AutoReplyFlow.findOneAndDelete({
      _id: req.params.flowId,
      userId: req.userId,
    });

    if (!flow) {
      return res.status(404).json({ error: "Auto reply flow not found" });
    }

    // Also delete related executions
    await AutoReplyExecution.deleteMany({ flowId: flow._id });

    res.json({
      success: true,
      message: "Auto reply flow deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting auto reply flow:", error);
    res.status(500).json({ error: "Failed to delete auto reply flow" });
  }
});

// Toggle flow active status
router.patch(
  "/auto-reply/flows/:flowId/toggle",
  authMiddleware,
  async (req, res) => {
    try {
      const flow = await AutoReplyFlow.findOneAndUpdate(
        { _id: req.params.flowId, userId: req.userId },
        { isActive: req.body.isActive },
        { new: true }
      );

      if (!flow) {
        return res.status(404).json({ error: "Auto reply flow not found" });
      }

      res.json(flow);
    } catch (error) {
      console.error("Error toggling auto reply flow:", error);
      res.status(500).json({ error: "Failed to toggle auto reply flow" });
    }
  }
);

// Get flow executions
router.get(
  "/auto-reply/flows/:flowId/executions",
  authMiddleware,
  async (req, res) => {
    try {
      const executions = await AutoReplyExecution.find({
        flowId: req.params.flowId,
        userId: req.userId,
      })
        .sort({ createdAt: -1 })
        .limit(50);

      res.json(executions);
    } catch (error) {
      console.error("Error fetching flow executions:", error);
      res.status(500).json({ error: "Failed to fetch flow executions" });
    }
  }
);

// Get flow statistics
router.get(
  "/auto-reply/flows/:flowId/stats",
  authMiddleware,
  async (req, res) => {
    try {
      const flow = await AutoReplyFlow.findOne({
        _id: req.params.flowId,
        userId: req.userId,
      });

      if (!flow) {
        return res.status(404).json({ error: "Auto reply flow not found" });
      }

      const executions = await AutoReplyExecution.find({
        flowId: flow._id,
      });

      const stats = {
        totalExecutions: executions.length,
        activeExecutions: executions.filter((e) => e.status === "active")
          .length,
        completedExecutions: executions.filter((e) => e.status === "completed")
          .length,
        failedExecutions: executions.filter((e) => e.status === "failed")
          .length,
        totalReplies: executions.reduce((sum, e) => sum + e.totalReplies, 0),
        lastExecution: executions.length > 0 ? executions[0].createdAt : null,
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching flow statistics:", error);
      res.status(500).json({ error: "Failed to fetch flow statistics" });
    }
  }
);

// Test flow (simulate execution)
router.post(
  "/auto-reply/flows/:flowId/test",
  authMiddleware,
  async (req, res) => {
    try {
      const { testMessage } = req.body;
      const flow = await AutoReplyFlow.findOne({
        _id: req.params.flowId,
        userId: req.userId,
      });

      if (!flow) {
        return res.status(404).json({ error: "Auto reply flow not found" });
      }

      // Simulate flow execution
      const simulation = {
        flowId: flow._id,
        flowName: flow.name,
        testMessage,
        steps: [],
      };

      for (const step of flow.flowSteps) {
        const stepResult = {
          stepNumber: step.stepNumber,
          stepType: step.stepType,
          condition: step.condition,
          conditionValue: step.conditionValue,
          replyContent: step.replyContent,
          wouldExecute: true, // Simplified for testing
          delay: step.delay,
        };

        simulation.steps.push(stepResult);
      }

      res.json(simulation);
    } catch (error) {
      console.error("Error testing auto reply flow:", error);
      res.status(500).json({ error: "Failed to test auto reply flow" });
    }
  }
);

export default router;
