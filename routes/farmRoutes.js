import express from 'express';
import farmService from '../services/oPastor/farmService.js';
import animalIdentityService from '../services/oPastor/animalIdentityService.js';
import { requireBearerToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/overview', farmService.getOverview);
router.get('/:farmId/timezone', animalIdentityService.getFarmTimezone);
router.put(
  '/:farmId/timezone',
  requireBearerToken,
  animalIdentityService.setFarmTimezone,
);

export default router;
