import express from 'express';
import nodeService from '../../services/oPastor/nodeService.js';
import { batchTelemetry } from '../../services/oPastor/telemetryService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

//router.get('/latest/:id',requireBearerToken, nodeService.getLatestNodeEventById);
// router.get('/', requireBearerToken, nodeService.getAllNodes);
// router.get('/:id/events', requireBearerToken, nodeService.getNodeEventsById);
// router.get('/:id', requireBearerToken, nodeService.getNodeById);
// router.put('/:id', requireBearerToken, nodeService.updateNode);
// router.delete('/:id', requireBearerToken, nodeService.deleteNode);


router.get('/latest/:id', nodeService.getLatestNodeEventById);
router.get('/',  nodeService.getAllNodes);
router.get('/:id/events', nodeService.getNodeEventsById);
router.get('/:id', nodeService.getNodeById);
router.put('/:id', requireBearerToken, nodeService.updateNode);
router.delete('/:id', requireBearerToken, nodeService.deleteNode);

router.post('/', requireBearerToken, nodeService.createNode);
router.post('/batch', requireBearerToken, nodeService.batchInsertNodes);
router.post('/sensors', requireBearerToken, nodeService.processSensorData);
router.post('/telemetry/batch', requireBearerToken, batchTelemetry);

export default router;
