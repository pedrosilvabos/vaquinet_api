// File: routes/cowRoutes.js
import express from 'express';
import cowService from '../services/cowService.js'; // ✅ Correct default import
import { batchTelemetry } from '../services/telemetryController.js';

const router = express.Router();

router.get('/', cowService.getAllCows);
router.get('/:id', cowService.getCowById);
router.post('/', cowService.createCow);
router.put('/:id', cowService.updateCow);
router.delete('/:id', cowService.deleteCow);
router.post('/batch', cowService.batchInsertCows);
router.post('/sensors', cowService.processSensorData);
router.post('/telemetry/batch', batchTelemetry);
export default router;
