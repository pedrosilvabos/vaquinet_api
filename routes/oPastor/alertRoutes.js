// File: /routes/alertRoutes.js
import express from 'express';
import { getAllAlerts, createAlert, markAlertSent  } from'../../services/oPastor/alertService.js';

const router = express.Router();

router.get('/', getAllAlerts);
router.post('/', createAlert);
router.patch('/:id/sent', markAlertSent);

export default router;

