import express from "express";
import crypto from "crypto";
import { authMiddleware } from "../../middleware/auth.js";
import Wallet from "../../models/Wallet.js";
import User from "../../models/User.js";

const router = express.Router();

// إنشاء طلب شحن
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { method, amount } = req.body;
    const userId = req.userId;

    // التحقق من صحة البيانات
    if (!method || !amount || amount <= 0) {
      return res.status(400).json({ error: "بيانات غير صحيحة" });
    }

    // التحقق من طرق الدفع المسموحة
    const allowedMethods = ["sham_cash", "payeer", "usdt"];
    if (!allowedMethods.includes(method)) {
      return res.status(400).json({ error: "طريقة دفع غير مدعومة" });
    }

    // الحصول على محفظة المستخدم
    let wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ error: "المحفظة غير موجودة" });
    }

    // إنشاء طلب الشحن
    const rechargeRequest = {
      method,
      amount,
      status: method === "sham_cash" ? "pending" : "processing",
      createdAt: new Date(),
      userId,
    };

    // إضافة طلب الشحن إلى المحفظة
    wallet.rechargeRequests = wallet.rechargeRequests || [];
    wallet.rechargeRequests.push(rechargeRequest);

    // إضافة transaction للطلب
    const transaction = {
      transactionId: `RECHARGE_${Date.now()}_${userId}`,
      type: "deposit",
      amount,
      description: `طلب شحن محفظة عبر ${
        method === "sham_cash"
          ? "شام كاش"
          : method === "payeer"
          ? "Payeer"
          : "USDT"
      }`,
      status: method === "sham_cash" ? "pending" : "processing",
      paymentMethod: method,
      reference: `RECHARGE_${rechargeRequest._id}`,
      createdAt: new Date(),
    };

    wallet.transactions = wallet.transactions || [];
    wallet.transactions.push(transaction);

    await wallet.save();

    // Process referral commission if this is user's first recharge
    const user = await User.findById(userId);
    if (user && !user.isFirstRechargeCompleted) {
      try {
        const referralResponse = await fetch(
          `${req.protocol}://${req.get(
            "host"
          )}/api/referral/process-commission`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: userId,
              rechargeAmount: amount,
            }),
          }
        );

        if (referralResponse.ok) {
          console.log(
            "Referral commission processed successfully for user:",
            userId
          );
        }
      } catch (referralError) {
        console.error(
          "Referral commission processing error:",
          referralError.message
        );
        // Don't fail recharge if commission processing fails
      }
    }

    // معالجة كل طريقة دفع
    if (method === "sham_cash") {
      // شام كاش - يحتاج موافقة الإدارة
      return res.json({
        success: true,
        message: "تم إرسال طلب الشحن بنجاح. سيتم مراجعته من قبل الإدارة.",
        requestId: rechargeRequest._id,
      });
    } else if (method === "payeer") {
      // Payeer - إنشاء رابط دفع
      const paymentUrl = await createPayeerPayment(amount, userId);
      return res.json({
        success: true,
        paymentUrl,
        requestId: rechargeRequest._id,
      });
    } else if (method === "usdt") {
      // USDT - إنشاء عنوان محفظة
      const usdtAddress = await generateUSDTAddress(userId);
      return res.json({
        success: true,
        address: usdtAddress,
        amount: amount,
        requestId: rechargeRequest._id,
      });
    }
  } catch (error) {
    console.error("Error creating recharge request:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// إنشاء رابط دفع Payeer
async function createPayeerPayment(amount, userId) {
  // هنا يمكنك إضافة تكامل مع Payeer API
  // هذا مثال بسيط
  const merchantId = process.env.PAYEER_MERCHANT_ID;
  const secretKey = process.env.PAYEER_SECRET_KEY;
  const orderId = `recharge_${userId}_${Date.now()}`;

  // إنشاء رابط الدفع (المبلغ بالدولار)
  const paymentUrl = `https://payeer.com/merchant/?m_shop=${merchantId}&m_orderid=${orderId}&m_amount=${amount}&m_curr=USD&m_desc=Wallet+Recharge&m_sign=${generatePayeerSignature(
    merchantId,
    orderId,
    amount,
    secretKey
  )}`;

  return paymentUrl;
}

// إنشاء عنوان USDT
async function generateUSDTAddress(userId) {
  // هنا يمكنك إضافة تكامل مع Tron API
  // هذا عنوان مثال
  const addresses = [
    "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
    "TLyqzVGLV1srkB7dToTAEqg3fZ5CNixUVR",
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  ];

  // اختيار عنوان عشوائي (في التطبيق الحقيقي، يجب إنشاء عنوان فريد)
  const randomAddress = addresses[Math.floor(Math.random() * addresses.length)];

  return randomAddress;
}

// إنشاء توقيع Payeer
function generatePayeerSignature(merchantId, orderId, amount, secretKey) {
  const data = `${merchantId}:${orderId}:${amount}:USD:${secretKey}`;
  return crypto.createHash("sha256").update(data).digest("hex").toUpperCase();
}

// الحصول على طلبات الشحن للمستخدم
router.get("/requests", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ error: "المحفظة غير موجودة" });
    }

    res.json({
      requests: wallet.rechargeRequests || [],
    });
  } catch (error) {
    console.error("Error fetching recharge requests:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// الحصول على معاملات الشحن للمستخدم
router.get("/transactions", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const wallet = await Wallet.findOne({ userId });

    if (!wallet) {
      return res.status(404).json({ error: "المحفظة غير موجودة" });
    }

    // تصفية معاملات الشحن فقط
    const rechargeTransactions = wallet.transactions.filter(
      (tx) =>
        tx.paymentMethod === "sham_cash" ||
        tx.paymentMethod === "payeer" ||
        tx.paymentMethod === "usdt"
    );

    // ترتيب حسب التاريخ (الأحدث أولاً)
    rechargeTransactions.sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      transactions: rechargeTransactions,
    });
  } catch (error) {
    console.error("Error fetching recharge transactions:", error);
    res.status(500).json({ error: "خطأ في الخادم" });
  }
});

// webhook لـ Payeer
router.post("/webhook/payeer", async (req, res) => {
  try {
    const {
      m_operation_id,
      m_operation_ps,
      m_operation_date,
      m_operation_pay_date,
      m_shop,
      m_orderid,
      m_amount,
      m_curr,
      m_desc,
      m_status,
      m_sign,
    } = req.body;

    // التحقق من التوقيع
    const secretKey = process.env.PAYEER_SECRET_KEY;
    const calculatedSign = generatePayeerSignature(
      m_shop,
      m_orderid,
      m_amount,
      secretKey
    );

    if (m_sign !== calculatedSign) {
      return res.status(400).json({ error: "توقيع غير صحيح" });
    }

    // معالجة الدفع
    if (m_status === "success") {
      // البحث عن طلب الشحن
      const orderId = m_orderid;
      const userId = orderId.split("_")[1];

      const wallet = await Wallet.findOne({ userId });
      if (wallet) {
        // العثور على طلب الشحن وتحديثه
        const rechargeRequest = wallet.rechargeRequests.find(
          (req) => req._id.toString() === orderId
        );
        if (rechargeRequest) {
          rechargeRequest.status = "completed";
          rechargeRequest.completedAt = new Date();

          // إضافة المبلغ إلى المحفظة
          wallet.balance = (wallet.balance || 0) + parseFloat(m_amount);

          // إضافة معاملة
          wallet.transactions = wallet.transactions || [];
          wallet.transactions.push({
            type: "deposit",
            amount: parseFloat(m_amount),
            description: "شحن المحفظة عبر Payeer",
            status: "completed",
            createdAt: new Date(),
          });

          await wallet.save();
        }
      }
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("Payeer webhook error:", error);
    res.status(500).json({ error: "خطأ في webhook" });
  }
});

// webhook لـ USDT (Tron)
router.post("/webhook/usdt", async (req, res) => {
  try {
    const { address, amount, txHash, blockNumber } = req.body;

    // التحقق من صحة المعاملة
    if (!address || !amount || !txHash) {
      return res.status(400).json({ error: "بيانات غير كاملة" });
    }

    // البحث عن طلب الشحن المرتبط بهذا العنوان
    const wallet = await Wallet.findOne({
      "rechargeRequests.address": address,
      "rechargeRequests.status": "processing",
    });

    if (wallet) {
      const rechargeRequest = wallet.rechargeRequests.find(
        (req) => req.address === address
      );
      if (rechargeRequest) {
        rechargeRequest.status = "completed";
        rechargeRequest.completedAt = new Date();
        rechargeRequest.txHash = txHash;

        // إضافة المبلغ إلى المحفظة
        wallet.balance = (wallet.balance || 0) + parseFloat(amount);

        // إضافة معاملة
        wallet.transactions = wallet.transactions || [];
        wallet.transactions.push({
          type: "deposit",
          amount: parseFloat(amount),
          description: "شحن المحفظة عبر USDT",
          status: "completed",
          txHash: txHash,
          createdAt: new Date(),
        });

        await wallet.save();
      }
    }

    res.json({ status: "ok" });
  } catch (error) {
    console.error("USDT webhook error:", error);
    res.status(500).json({ error: "خطأ في webhook" });
  }
});

export default router;
