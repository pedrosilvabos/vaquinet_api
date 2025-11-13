import express from 'express';
import fenceService from '../../services/oPastor/fenceService.js';

const router = express.Router();
const UUIDv4 = '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

// Specific routes first
router.get('/check', fenceService.checkPoint);

// Collection
router.get('/', fenceService.getAllFences);
router.post('/', fenceService.createFence);

// Item routes with UUID guard
router.get(`/:id${UUIDv4}`, fenceService.getFenceById);
router.put(`/:id${UUIDv4}`, fenceService.updateFence);
router.delete(`/:id${UUIDv4}`, fenceService.deleteFence);

export default router;
