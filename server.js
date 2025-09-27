import dotenv from "dotenv";
// import { validateEnvironment } from "./utils/validateEnv.js";
import { connectDB } from "./config/database.js";
import app from "./app.js";

// Load environment variables first
dotenv.config();

// Validate environment variables
// try {
//   validateEnvironment();
// } catch (error) {
//   console.error("❌ Environment validation failed:", error.message);
//   console.log("\n💡 To fix this:");
//   console.log("1. Copy .env.example to .env");
//   console.log("2. Fill in the required values");
//   console.log("3. Restart the server\n");
//   process.exit(1);
// }

// Connect to MongoDB
connectDB();

app.listen(5000, () => console.log("Backend running on port 5000"));
