import express from 'express';
import accelCalibrationService from '../../services/oPastor/accelCalibrationService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/accelerometer/batch', requireBearerToken, accelCalibrationService.postAccelerometerBatch);

export default router;
