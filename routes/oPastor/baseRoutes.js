import express from 'express';
import { postBaseStatus } from '../../services/oPastor/telemetryService.js';

const router = express.Router();

router.post('/status', postBaseStatus);

export default router;
