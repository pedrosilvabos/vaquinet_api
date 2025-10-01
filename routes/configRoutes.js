import express from 'express';
import configService from '../services/configService.js';
const router = express.Router();

// FCM first so it doesn't get caught by :key
router.get('/fcm/token', configService.getLatestFcmToken);
router.post('/fcm/token', configService.setFcmToken);

// KV after
router.get('/:key', configService.getByKey);
router.post('/', configService.setByKey);

export default router;
