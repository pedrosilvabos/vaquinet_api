// routes/oPastor/index.js
import express from 'express';
import nodeRoutes from './nodeRoutes.js';
import alertRoutes from './alertRoutes.js';
import ordersRoutes from './ordersRoutes.js';
import fenceRoutes from './fenceRoutes.js';
import configRoutes from './configRoutes.js';
import phonebookRoutes from './phonebookRoutes.js';

const router = express.Router();

// Everything here will live under /opastor/...
router.use('/nodes', nodeRoutes);
router.use('/alerts', alertRoutes);
router.use('/orders', ordersRoutes);
router.use('/fences', fenceRoutes);
router.use('/config', configRoutes);
router.use('/phonebook', phonebookRoutes);

export default router;
