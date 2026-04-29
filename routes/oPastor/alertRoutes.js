// File: /routes/alertRoutes.js
import express from 'express';
import { getAllAlerts, createAlert, markAlertSent  } from'../../services/oPastor/alertService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

router.get('/', getAllAlerts);
router.post('/', requireBearerToken, createAlert);
router.patch('/:id/sent', requireBearerToken, markAlertSent);

export default router;

