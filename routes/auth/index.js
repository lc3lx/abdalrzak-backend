import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../../models/User.js";
import { authMiddleware } from "../../middleware/auth.js";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { email, username, password, referralCode } = req.body;
  console.log("Register attempt:", { email, username, referralCode });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ email, username, password: hashedPassword });
    await user.save();

    // Process referral if code is provided
    if (referralCode) {
      try {
        const referralResponse = await fetch(
          `${req.protocol}://${req.get(
            "host"
          )}/api/referral/process-registration`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: user._id,
              referralCode,
            }),
          }
        );

        if (referralResponse.ok) {
          console.log("Referral processed successfully for:", username);
        }
      } catch (referralError) {
        console.error("Referral processing error:", referralError.message);
        // Don't fail registration if referral fails
      }
    }

    console.log("User registered successfully:", username);
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register error:", error.message);
    res.status(400).json({
      error: "Email or username already exists or registration failed",
    });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Login attempt:", { email });
  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.log("User not found:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      console.log("Password mismatch for:", email);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    console.log(
      "Login successful, token generated:",
      token.slice(0, 20) + "..."
    );
    res.json({
      token,
      email: user.email,
      username: user.username,
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/user", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId, "email username role");
    if (!user) {
      console.log("User not found for userId:", req.userId);
      return res.status(404).json({ error: "User not found" });
    }
    console.log("User fetched:", {
      email: user.email,
      username: user.username,
      role: user.role,
    });
    res.json({ email: user.email, username: user.username, role: user.role });
  } catch (error) {
    console.error("User fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
