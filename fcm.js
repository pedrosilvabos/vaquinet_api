// fcm.js
import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./service-account.json", "utf8")
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export async function sendToToken(token, title, body, data = {}) {
  return admin.messaging().send({
    token,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: {
      priority: "high",
      notification: {
        channelId: "high_importance_channel", // must match the channel you created in Flutter
        priority: "max",
        defaultSound: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          alert: { title, body },
        },
      },
    },
  });
}

export async function sendToTopic(topic, title, body, data = {}) {
  return admin.messaging().send({
    topic,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    android: {
      priority: "high",
      notification: {
        channelId: "high_importance_channel",
        priority: "max",
        defaultSound: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          alert: { title, body },
        },
      },
    },
  });
}
