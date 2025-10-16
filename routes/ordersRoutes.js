// File: routes/ordersRoutes.js
import express from 'express';
import {
  getAllOrders,
  createOrder,
  markOrderComplete,
  markOrdersDeliveredByCow,
} from '../services/ordersService.js';

const router = express.Router();

router.get('/', getAllOrders);
router.post('/', createOrder);
router.get('/mark/:id', markOrderComplete);
router.get('/mark-delivered/:cowId', async (req, res) => {
  try {
    const result = await markOrdersDeliveredByCow(req.params.cowId);
    res.json(result); // always 200
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


export default router;
