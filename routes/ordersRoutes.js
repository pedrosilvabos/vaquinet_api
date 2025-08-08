// File: routes/ordersRoutes.js
import express from 'express';
import { getAllOrders, createOrder } from '../services/ordersService.js';

const router = express.Router();

router.get('/', getAllOrders);
router.post('/', createOrder);

export default router;