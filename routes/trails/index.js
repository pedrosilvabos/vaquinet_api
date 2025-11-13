// routes/trails/index.js
import express from 'express';
import trailRoutes from './trailRoutes.js';

const router = express.Router();

// e.g. /trails/segments, /trails/events, etc.
router.use('/', trailRoutes);

export default router;
