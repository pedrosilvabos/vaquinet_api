// routes/nodeRoutes.js
import express from 'express';
import nodeService from '../services/nodeService.js';
import { batchTelemetry } from '../services/telemetryService.js';

const router = express.Router();

// Specific before generic
router.get('/latest/:id', nodeService.getLatestNodeEventById);

router.get('/', nodeService.getAllNodes);
router.get('/:id/events', nodeService.getNodeEventsById);
router.get('/:id', nodeService.getNodeById);

router.post('/', nodeService.createNode);
router.put('/:id', nodeService.updateNode);
router.delete('/:id', nodeService.deleteNode);
router.post('/batch', nodeService.batchInsertNodes);
router.post('/sensors', nodeService.processSensorData);
router.post('/telemetry/batch', batchTelemetry);

export default router;
