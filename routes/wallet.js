import express from "express";
import Wallet from "../models/Wallet.js";
import { authMiddleware } from "../middleware/auth.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// Get wallet information
router.get("/wallet", authMiddleware, async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.userId });

    if (!wallet) {
      // Create wallet if it doesn't exist
      wallet = new Wallet({
        userId: req.userId,
        balance: 0,
        currency: "USD",
        cards: [],
        transactions: [],
      });
      await wallet.save();
    }

    res.json(wallet);
  } catch (error) {
    console.error("Error fetching wallet:", error);
    res.status(500).json({ error: "Failed to fetch wallet information" });
  }
});

// Add a new card
router.post("/wallet/cards", authMiddleware, async (req, res) => {
  try {
    const { cardNumber, cardType, holderName, expiryMonth, expiryYear, cvv } =
      req.body;

    // Validate card number (basic validation)
    const cleanCardNumber = cardNumber.replace(/\s/g, "");
    if (!/^\d{13,19}$/.test(cleanCardNumber)) {
      return res.status(400).json({ error: "Invalid card number" });
    }

    // Validate expiry date
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1;

    if (
      expiryYear < currentYear ||
      (expiryYear === currentYear && expiryMonth < currentMonth)
    ) {
      return res.status(400).json({ error: "Card has expired" });
    }

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Check if card already exists
    const existingCard = wallet.cards.find(
      (card) => card.cardNumber === cleanCardNumber
    );
    if (existingCard) {
      return res.status(400).json({ error: "Card already exists" });
    }

    const newCard = {
      cardId: uuidv4(),
      cardNumber: cleanCardNumber,
      cardType,
      holderName,
      expiryMonth,
      expiryYear,
      cvv,
      isDefault: wallet.cards.length === 0, // First card is default
    };

    wallet.cards.push(newCard);
    await wallet.save();

    res.json({ message: "Card added successfully", card: newCard });
  } catch (error) {
    console.error("Error adding card:", error);
    res.status(500).json({ error: "Failed to add card" });
  }
});

// Update card
router.put("/wallet/cards/:cardId", authMiddleware, async (req, res) => {
  try {
    const { cardId } = req.params;
    const updates = req.body;

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const cardIndex = wallet.cards.findIndex((card) => card.cardId === cardId);
    if (cardIndex === -1) {
      return res.status(404).json({ error: "Card not found" });
    }

    // Update card
    wallet.cards[cardIndex] = { ...wallet.cards[cardIndex], ...updates };
    await wallet.save();

    res.json({
      message: "Card updated successfully",
      card: wallet.cards[cardIndex],
    });
  } catch (error) {
    console.error("Error updating card:", error);
    res.status(500).json({ error: "Failed to update card" });
  }
});

// Delete card
router.delete("/wallet/cards/:cardId", authMiddleware, async (req, res) => {
  try {
    const { cardId } = req.params;

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const cardIndex = wallet.cards.findIndex((card) => card.cardId === cardId);
    if (cardIndex === -1) {
      return res.status(404).json({ error: "Card not found" });
    }

    // Don't allow deleting the last card
    if (wallet.cards.length === 1) {
      return res.status(400).json({ error: "Cannot delete the last card" });
    }

    wallet.cards.splice(cardIndex, 1);
    await wallet.save();

    res.json({ message: "Card deleted successfully" });
  } catch (error) {
    console.error("Error deleting card:", error);
    res.status(500).json({ error: "Failed to delete card" });
  }
});

// Set default card
router.patch(
  "/wallet/cards/:cardId/default",
  authMiddleware,
  async (req, res) => {
    try {
      const { cardId } = req.params;

      const wallet = await Wallet.findOne({ userId: req.userId });
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      // Remove default from all cards
      wallet.cards.forEach((card) => {
        card.isDefault = false;
      });

      // Set new default
      const cardIndex = wallet.cards.findIndex(
        (card) => card.cardId === cardId
      );
      if (cardIndex === -1) {
        return res.status(404).json({ error: "Card not found" });
      }

      wallet.cards[cardIndex].isDefault = true;
      await wallet.save();

      res.json({ message: "Default card updated successfully" });
    } catch (error) {
      console.error("Error setting default card:", error);
      res.status(500).json({ error: "Failed to set default card" });
    }
  }
);

// Add money to wallet
router.post("/wallet/deposit", authMiddleware, async (req, res) => {
  try {
    const { amount, cardId, description } = req.body;

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Find the card
    const card = wallet.cards.find((c) => c.cardId === cardId);
    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }

    // Create transaction
    const transaction = {
      transactionId: uuidv4(),
      type: "deposit",
      amount,
      description: description || "Wallet deposit",
      status: "completed",
      paymentMethod: "card",
      reference: `DEP_${Date.now()}`,
      processedAt: new Date(),
    };

    // Update wallet
    await wallet.addTransaction(transaction);
    await wallet.updateBalance(amount, "deposit");

    res.json({
      message: "Deposit successful",
      transaction,
      newBalance: wallet.balance,
    });
  } catch (error) {
    console.error("Error processing deposit:", error);
    res.status(500).json({ error: "Failed to process deposit" });
  }
});

// Gift money to another user via email
router.post("/wallet/gift", authMiddleware, async (req, res) => {
  try {
    const { amount, recipientEmail, message } = req.body;

    if (amount <= 0) {
      return res.status(400).json({ error: "المبلغ يجب أن يكون موجباً" });
    }

    if (!recipientEmail) {
      return res.status(400).json({ error: "يرجى إدخال إيميل المستلم" });
    }

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "المحفظة غير موجودة" });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ error: "الرصيد غير كافي" });
    }

    // Find recipient user by email
    const recipient = await User.findOne({ email: recipientEmail });
    if (!recipient) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    // Check if user is trying to gift themselves
    if (recipient._id.toString() === req.userId) {
      return res.status(400).json({ error: "لا يمكنك إهداء المال لنفسك" });
    }

    // Get recipient's wallet
    let recipientWallet = await Wallet.findOne({ userId: recipient._id });
    if (!recipientWallet) {
      // Create wallet if it doesn't exist
      recipientWallet = new Wallet({
        userId: recipient._id,
        balance: 0,
        currency: "USD",
        cards: [],
        transactions: [],
      });
      await recipientWallet.save();
    }

    // Create gift transaction for sender
    const giftTransaction = {
      transactionId: `GIFT_OUT_${Date.now()}_${req.userId}`,
      type: "gift_sent",
      amount,
      description: `إهداء إلى ${recipient.username} - ${message || "هدية"}`,
      status: "completed",
      paymentMethod: "gift",
      reference: `GIFT_${recipient._id}`,
      recipientEmail,
      createdAt: new Date(),
    };

    // Create gift transaction for recipient
    const receiveTransaction = {
      transactionId: `GIFT_IN_${Date.now()}_${recipient._id}`,
      type: "gift_received",
      amount,
      description: `هدية من ${req.user?.username || "مستخدم"} - ${
        message || "هدية"
      }`,
      status: "completed",
      paymentMethod: "gift",
      reference: `GIFT_${req.userId}`,
      senderEmail: req.user?.email,
      createdAt: new Date(),
    };

    // Update sender's wallet
    wallet.transactions.push(giftTransaction);
    wallet.balance -= amount;
    wallet.statistics.totalSpent += amount;
    wallet.statistics.transactionCount += 1;
    wallet.statistics.lastTransactionAt = new Date();
    await wallet.save();

    // Update recipient's wallet
    recipientWallet.transactions.push(receiveTransaction);
    recipientWallet.balance += amount;
    recipientWallet.statistics.totalDeposits += amount;
    recipientWallet.statistics.transactionCount += 1;
    recipientWallet.statistics.lastTransactionAt = new Date();
    await recipientWallet.save();

    res.json({
      message: "تم إرسال الهدية بنجاح",
      transaction: giftTransaction,
      newBalance: wallet.balance,
      recipientName: recipient.username,
    });
  } catch (error) {
    console.error("Error processing gift:", error);
    res.status(500).json({ error: "فشل في إرسال الهدية" });
  }
});

// Get transactions
router.get("/wallet/transactions", authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;
    const skip = (page - 1) * limit;

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    let transactions = wallet.transactions;

    // Filter by type
    if (type) {
      transactions = transactions.filter((tx) => tx.type === type);
    }

    // Filter by status
    if (status) {
      transactions = transactions.filter((tx) => tx.status === status);
    }

    // Sort by date (newest first)
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Paginate
    const paginatedTransactions = transactions.slice(
      skip,
      skip + parseInt(limit)
    );

    res.json({
      transactions: paginatedTransactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: transactions.length,
        pages: Math.ceil(transactions.length / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Get spending summary
router.get("/wallet/summary", authMiddleware, async (req, res) => {
  try {
    const { period = "month" } = req.query;

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const summary = wallet.getSpendingSummary(period);

    res.json({
      summary,
      wallet: {
        balance: wallet.balance,
        currency: wallet.currency,
        totalCards: wallet.cards.length,
        activeCards: wallet.cards.filter((card) => card.isActive).length,
      },
    });
  } catch (error) {
    console.error("Error fetching wallet summary:", error);
    res.status(500).json({ error: "Failed to fetch wallet summary" });
  }
});

// Update wallet settings
router.put("/wallet/settings", authMiddleware, async (req, res) => {
  try {
    const { settings } = req.body;

    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    wallet.settings = { ...wallet.settings, ...settings };
    await wallet.save();

    res.json({
      message: "Settings updated successfully",
      settings: wallet.settings,
    });
  } catch (error) {
    console.error("Error updating wallet settings:", error);
    res.status(500).json({ error: "Failed to update wallet settings" });
  }
});

// Get recharge requests
router.get("/wallet/recharge-requests", authMiddleware, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.userId });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Get recharge transactions
    const rechargeTransactions = wallet.transactions.filter(
      (tx) =>
        tx.paymentMethod === "sham_cash" ||
        tx.paymentMethod === "payeer" ||
        tx.paymentMethod === "usdt"
    );

    // Sort by date (newest first)
    rechargeTransactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      rechargeRequests: rechargeTransactions,
    });
  } catch (error) {
    console.error("Error fetching recharge requests:", error);
    res.status(500).json({ error: "Failed to fetch recharge requests" });
  }
});

// Import recharge routes
import rechargeRoutes from "./wallet/recharge.js";

// Use recharge routes
router.use("/wallet/recharge", rechargeRoutes);

export default router;
