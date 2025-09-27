import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "USD",
      enum: ["USD", "EUR", "GBP", "SAR", "AED", "JOD", "EGP"],
    },
    cards: [
      {
        cardId: {
          type: String,
          required: true,
        },
        cardNumber: {
          type: String,
          required: true,
        },
        cardType: {
          type: String,
          enum: ["visa", "mastercard", "amex", "discover"],
          required: true,
        },
        holderName: {
          type: String,
          required: true,
        },
        expiryMonth: {
          type: Number,
          required: true,
          min: 1,
          max: 12,
        },
        expiryYear: {
          type: Number,
          required: true,
          min: new Date().getFullYear(),
        },
        cvv: {
          type: String,
          required: true,
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    transactions: [
      {
        transactionId: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: [
            "deposit",
            "payment",
            "refund",
            "bonus",
            "gift_sent",
            "gift_received",
          ],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        description: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "processing", "completed", "failed", "cancelled"],
          default: "pending",
        },
        paymentMethod: {
          type: String,
          enum: [
            "card",
            "bank_transfer",
            "paypal",
            "stripe",
            "internal",
            "sham_cash",
            "payeer",
            "usdt",
            "gift",
            "referral",
            "admin",
            "package",
          ],
          required: true,
        },
        reference: {
          type: String,
        },
        metadata: {
          type: mongoose.Schema.Types.Mixed,
        },
        processedAt: {
          type: Date,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    settings: {
      autoRecharge: {
        enabled: {
          type: Boolean,
          default: false,
        },
        threshold: {
          type: Number,
          default: 10,
        },
        amount: {
          type: Number,
          default: 50,
        },
      },
      notifications: {
        lowBalance: {
          type: Boolean,
          default: true,
        },
        transaction: {
          type: Boolean,
          default: true,
        },
        weekly: {
          type: Boolean,
          default: true,
        },
      },
      spendingLimits: {
        daily: {
          type: Number,
          default: 1000,
        },
        monthly: {
          type: Number,
          default: 10000,
        },
      },
    },
    rechargeRequests: [
      {
        method: {
          type: String,
          enum: ["sham_cash", "payeer", "usdt"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        status: {
          type: String,
          enum: ["pending", "processing", "completed", "failed", "cancelled"],
          default: "pending",
        },
        address: String, // For USDT
        txHash: String, // For USDT
        paymentUrl: String, // For Payeer
        createdAt: {
          type: Date,
          default: Date.now,
        },
        completedAt: Date,
        adminNotes: String, // For sham_cash
      },
    ],
    statistics: {
      totalDeposits: {
        type: Number,
        default: 0,
      },
      totalWithdrawals: {
        type: Number,
        default: 0,
      },
      totalSpent: {
        type: Number,
        default: 0,
      },
      lastTransactionAt: Date,
      transactionCount: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for better performance
walletSchema.index({ userId: 1 });
walletSchema.index({ "transactions.createdAt": -1 });
walletSchema.index({ "transactions.status": 1 });

// Virtual for masked card number
walletSchema.virtual("cards.maskedNumber").get(function () {
  return this.cards.map((card) => {
    const lastFour = card.cardNumber.slice(-4);
    return `**** **** **** ${lastFour}`;
  });
});

// Method to add transaction
walletSchema.methods.addTransaction = function (transactionData) {
  this.transactions.push(transactionData);
  this.statistics.transactionCount += 1;
  this.statistics.lastTransactionAt = new Date();
  return this.save();
};

// Method to update balance
walletSchema.methods.updateBalance = function (amount, type) {
  if (
    type === "deposit" ||
    type === "refund" ||
    type === "bonus" ||
    type === "gift_received"
  ) {
    this.balance += amount;
    this.statistics.totalDeposits += amount;
  } else if (type === "payment" || type === "gift_sent") {
    this.balance -= amount;
    this.statistics.totalWithdrawals += amount;
    this.statistics.totalSpent += amount;
  }
  return this.save();
};

// Method to get spending summary
walletSchema.methods.getSpendingSummary = function (period = "month") {
  const now = new Date();
  let startDate;

  switch (period) {
    case "day":
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "week":
      startDate = new Date(now.setDate(now.getDate() - 7));
      break;
    case "month":
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case "year":
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const transactions = this.transactions.filter(
    (tx) => tx.createdAt >= startDate && tx.status === "completed"
  );

  const summary = {
    totalSpent: transactions
      .filter((tx) => tx.type === "payment" || tx.type === "gift_sent")
      .reduce((sum, tx) => sum + tx.amount, 0),
    totalDeposits: transactions
      .filter((tx) => tx.type === "deposit" || tx.type === "gift_received")
      .reduce((sum, tx) => sum + tx.amount, 0),
    totalGiftsSent: transactions
      .filter((tx) => tx.type === "gift_sent")
      .reduce((sum, tx) => sum + tx.amount, 0),
    totalGiftsReceived: transactions
      .filter((tx) => tx.type === "gift_received")
      .reduce((sum, tx) => sum + tx.amount, 0),
    transactionCount: transactions.length,
    period,
  };

  return summary;
};

export default mongoose.model("Wallet", walletSchema);
