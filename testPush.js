import { sendToToken } from "./fcm.js";

const token = "ejE4Zoc_RpCmlxNy_EkjQF:APA91bEiLD8Fd2d4yoEixesNAJRxB08COcwgbwriZGzsGCJg_kHj_cRK9abl6-AzwfyOMmsUgSumEvtpxorsvVj2kqhC-f_C6e-BS4S7ga4GWN8C4dBsUDg";

const res = await sendToToken(token, "Test Push", "Hello from oPastor backend");
console.log(res);
