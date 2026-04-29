import { sendToToken } from "./fcm.js";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.TEST_FCM_TOKEN;

if (!token) {
  throw new Error("Missing TEST_FCM_TOKEN");
}

const res = await sendToToken(token, "Test Push", "Hello from oPastor backend");
console.log(res);
