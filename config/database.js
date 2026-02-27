import mongoose from "mongoose";

export const connectDB = () => {
  const mongoUri =
    process.env.MONGO_URI || "mongodb://localhost:27017/socialmedia";
  console.log("Connecting to MongoDB:", mongoUri);

  mongoose
    .connect(mongoUri)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => {
      console.error("MongoDB connection error:", err);
      console.log("Continuing without MongoDB for now...");
      // process.exit(1);
    });
};
