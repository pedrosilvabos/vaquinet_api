// routes/cowRoutes.js
import express from 'express';
import cowService from '../services/cowService.js';
import { batchTelemetry } from '../services/telemetryService.js';

const router = express.Router();

// Specific before generic
router.get('/latest/:id', cowService.getLatestCowEventById);

router.get('/', cowService.getAllCows);
router.get('/:id/events', cowService.getCowEventsById);
router.get('/:id', cowService.getCowById);

router.post('/', cowService.createCow);
router.put('/:id', cowService.updateCow);
router.delete('/:id', cowService.deleteCow);
router.post('/batch', cowService.batchInsertCows);
router.post('/sensors', cowService.processSensorData);
router.post('/telemetry/batch', batchTelemetry);

export default router;
