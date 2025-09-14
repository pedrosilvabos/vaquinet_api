import express from 'express';
import fenceService from '../services/fenceService.js';

const router = express.Router();

// GET /fences?farm_id=...
router.get('/', fenceService.getAllFences);

// GET /fences/:id
router.get('/:id', fenceService.getFenceById);

// POST /fences
router.post('/', fenceService.createFence);

// PUT /fences/:id
router.put('/:id', fenceService.updateFence);

// DELETE /fences/:id
router.delete('/:id', fenceService.deleteFence);

export default router;
