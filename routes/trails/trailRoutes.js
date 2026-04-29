// routes/nodeRoutes.js
import express from 'express';
import nodeService from '../../services/oPastor/nodeService.js';
import { batchTelemetry } from '../../services/oPastor/telemetryService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

// Specific before generic
router.get('/latest/:id', nodeService.getLatestNodeEventById);

router.get('/', nodeService.getAllNodes);
router.get('/:id/events', nodeService.getNodeEventsById);
router.get('/:id', nodeService.getNodeById);

router.post('/', requireBearerToken, nodeService.createNode);
router.put('/:id', requireBearerToken, nodeService.updateNode);
router.delete('/:id', requireBearerToken, nodeService.deleteNode);
router.post('/batch', requireBearerToken, nodeService.batchInsertNodes);
router.post('/sensors', requireBearerToken, nodeService.processSensorData);
router.post('/telemetry/batch', requireBearerToken, batchTelemetry);

export default router;
