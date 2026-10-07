import express from 'express';
import fieldTransitionService from '../../services/oPastor/fieldTransitionService.js';
import { requireBearerToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/:farmId/field-transitions', requireBearerToken, fieldTransitionService.create);

export default router;
