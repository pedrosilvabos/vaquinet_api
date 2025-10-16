import { sendToToken } from "./fcm.js";

const token = "cZMYYBHhQumDQRcLWrMoWn:APA91bGtSnaJQDBbq9jNElnW1ktQtjimmL93ibbeWch0Y_8AJaywQ1ziMTecCJGxdGkyxbVUeKPTqoPh8A-Iuf59677OW_VVpgnOo4IvaWOHyIaO60284mI";

const res = await sendToToken(token, "Test Push", "Hello from oPastor backend");
console.log(res);
