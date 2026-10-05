import express from 'express';
import activityBaselineService from '../../services/oPastor/activityBaselineService.js';

const router = express.Router();

router.get('/:animalId/activity-baseline', activityBaselineService.getAnimalBaseline);

export default router;
