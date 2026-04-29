import express from 'express';
import farmService from '../services/oPastor/farmService.js';

const router = express.Router();

router.get('/overview', farmService.getOverview);

export default router;
