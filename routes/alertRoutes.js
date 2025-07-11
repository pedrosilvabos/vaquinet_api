// File: /routes/alertRoutes.js
import express from 'express';
import * as alertService from '../services/alertService.js';

const router = express.Router();

// GET /alerts — fetch all alerts
router.get('/', alertService.getAllAlerts);

export default router;
