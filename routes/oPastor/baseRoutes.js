import express from 'express';
import { postBaseStatus } from '../../services/oPastor/telemetryService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/status', requireBearerToken, postBaseStatus);

export default router;
