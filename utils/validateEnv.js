// // Environment Variables Validation
// export const validateEnvironment = () => {
// //   const requiredEnvVars = ["MONGODB_URI", "JWT_SECRET", "SESSION_SECRET"];

// //   const optionalEnvVars = {
// //     // Social Media APIs
// //     TWITTER_API_KEY: "Twitter integration",
// //     TWITTER_API_SECRET: "Twitter integration",
// //     FACEBOOK_APP_ID: "Facebook integration",
// //     FACEBOOK_APP_SECRET: "Facebook integration",
// //     INSTAGRAM_CLIENT_ID: "Instagram integration",
// //     INSTAGRAM_CLIENT_SECRET: "Instagram integration",
// //     LINKEDIN_CLIENT_ID: "LinkedIn integration",
// //     LINKEDIN_CLIENT_SECRET: "LinkedIn integration",
// //     YOUTUBE_CLIENT_ID: "YouTube integration",
// //     YOUTUBE_CLIENT_SECRET: "YouTube integration",
// //     TIKTOK_CLIENT_KEY: "TikTok integration",
// //     TIKTOK_CLIENT_SECRET: "TikTok integration",

// //     // Messaging Platforms
// //     TELEGRAM_BOT_TOKEN: "Telegram bot functionality",
// //     TELEGRAM_BOT_USERNAME: "Telegram bot functionality",
// //     WHATSAPP_PHONE_NUMBER_ID: "WhatsApp integration",
// //     WHATSAPP_ACCESS_TOKEN: "WhatsApp integration",
// //     WHATSAPP_VERIFY_TOKEN: "WhatsApp integration",

// //     // Webhook Verification
// //     FACEBOOK_VERIFY_TOKEN: "Facebook webhooks",
// //     INSTAGRAM_VERIFY_TOKEN: "Instagram webhooks",

// //     // AI Services
// //     HUGGINGFACE_API_KEY: "AI content generation",

// //     // Server Configuration
// //     BASE_URL: "Webhook callbacks",
// //     FRONTEND_URL: "CORS and redirects",
// //     INTERNAL_API_TOKEN: "Internal API calls",
// //   };

// //   const missing = [];
// //   const warnings = [];

// //   // Check required variables
// //   for (const envVar of requiredEnvVars) {
// //     if (!process.env[envVar]) {
// //       missing.push(envVar);
// //     }
// //   }

// //   // Check optional variables
// //   for (const [envVar, feature] of Object.entries(optionalEnvVars)) {
// //     if (!process.env[envVar]) {
// //       warnings.push(`${envVar} - Required for: ${feature}`);
// //     }
// //   }

// //   // Log results
// //   console.log("\n🔍 Environment Variables Validation:");
// //   console.log("=====================================");

// //   if (missing.length === 0) {
// //     console.log("✅ All required environment variables are set");
// //   } else {
// //     console.log("❌ Missing required environment variables:");
// //     missing.forEach((envVar) => console.log(`   - ${envVar}`));
// //   }

// //   if (warnings.length > 0) {
// //     console.log(
// //       "\n⚠️  Optional environment variables (features may be disabled):"
// //     );
// //     warnings.forEach((warning) => console.log(`   - ${warning}`));
// //   }

// //   console.log(`\n📊 Status: ${missing.length === 0 ? "READY" : "INCOMPLETE"}`);
// //   console.log("=====================================\n");

// //   // Throw error if critical variables are missing
// //   if (missing.length > 0) {
// //     throw new Error(
// //       `Missing required environment variables: ${missing.join(", ")}`
// //     );
// //   }

// //   return {
// //     valid: missing.length === 0,
// //     missing,
// //     warnings,
// //   };
// // };

// // // Check specific platform configuration
// // export const checkPlatformConfig = (platform) => {
// //   const platformConfigs = {
// //     twitter: ["TWITTER_API_KEY", "TWITTER_API_SECRET"],
// //     facebook: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
// //     instagram: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
// //     linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
// //     youtube: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
// //     tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
// //     telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"],
// //     whatsapp: [
// //       "WHATSAPP_PHONE_NUMBER_ID",
// //       "WHATSAPP_ACCESS_TOKEN",
// //       "WHATSAPP_VERIFY_TOKEN",
// //     ],
// //   };

// //   const requiredVars = platformConfigs[platform.toLowerCase()];

// //   if (!requiredVars) {
// //     return { configured: false, error: "Unknown platform" };
// //   }

// //   const missing = requiredVars.filter((envVar) => !process.env[envVar]);

// //   return {
// //     configured: missing.length === 0,
// //     missing,
// //     platform: platform.charAt(0).toUpperCase() + platform.slice(1),
// //   };
// // };

// // Generate environment template
// export const generateEnvTemplate = () => {
//   const template = `# Social Media Management Platform - Environment Variables
// # Copy this file to .env and fill in your values

// # ==========================================
// # REQUIRED - Application will not start without these
// # ==========================================

// # Database
// MONGODB_URI=mongodb://localhost:27017/smart-social

// # Security
// JWT_SECRET=your-super-secure-jwt-secret-here-min-32-chars
// SESSION_SECRET=your-super-secure-session-secret-here-min-32-chars

// # Server Configuration
// PORT=5000
// NODE_ENV=development
// BASE_URL=http://localhost:5000
// FRONTEND_URL=http://localhost:5173

// # ==========================================
// # SOCIAL MEDIA PLATFORMS - Optional but required for specific features
// # ==========================================

// # Twitter API v2
// TWITTER_API_KEY=your-twitter-api-key
// TWITTER_API_SECRET=your-twitter-api-secret

// # Facebook Graph API
// FACEBOOK_APP_ID=your-facebook-app-id
// FACEBOOK_APP_SECRET=your-facebook-app-secret
// FACEBOOK_VERIFY_TOKEN=your-facebook-webhook-verify-token

// # Instagram Basic Display API
// INSTAGRAM_CLIENT_ID=your-instagram-client-id
// INSTAGRAM_CLIENT_SECRET=your-instagram-client-secret
// INSTAGRAM_VERIFY_TOKEN=your-instagram-webhook-verify-token

// # LinkedIn API
// LINKEDIN_CLIENT_ID=your-linkedin-client-id
// LINKEDIN_CLIENT_SECRET=your-linkedin-client-secret

// # YouTube Data API v3
// YOUTUBE_CLIENT_ID=your-youtube-client-id
// YOUTUBE_CLIENT_SECRET=your-youtube-client-secret

// # TikTok for Developers
// TIKTOK_CLIENT_KEY=your-tiktok-client-key
// TIKTOK_CLIENT_SECRET=your-tiktok-client-secret

// # ==========================================
// # MESSAGING PLATFORMS
// # ==========================================

// # Telegram Bot API
// TELEGRAM_BOT_TOKEN=your-telegram-bot-token
// TELEGRAM_BOT_USERNAME=your-telegram-bot-username

// # WhatsApp Business API
// WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
// WHATSAPP_ACCESS_TOKEN=your-whatsapp-access-token
// WHATSAPP_VERIFY_TOKEN=your-whatsapp-verify-token

// # ==========================================
// # AI SERVICES
// # ==========================================

// # Hugging Face API
// HUGGINGFACE_API_KEY=your-huggingface-api-key

// # ==========================================
// # INTERNAL CONFIGURATION
// # ==========================================

// # Internal API calls
// INTERNAL_API_TOKEN=internal-secure-token-for-webhooks

// # Logging Level
// LOG_LEVEL=info
// `;

//   return template;
// };
