import express from 'express';
import { requireBearerToken } from '../../middleware/auth.js';
import { getRegistry, putRegistryEntry } from '../../services/oPastor/collarRegistryService.js';

const router = express.Router();

// A Base reads its own replica; provisioning remains an authenticated service/admin action.
router.get('/:baseId/collar-registry', requireBearerToken, getRegistry);
router.put('/:baseId/collar-registry', requireBearerToken, putRegistryEntry);

export default router;
