// File: routes/ordersRoutes.js
import express from 'express';
import {
  getAllOrders,
  createOrder,
  markOrderComplete,
  markOrdersDeliveredByNode,
} from '../../services/oPastor/ordersService.js';

const router = express.Router();

router.get('/', getAllOrders);
router.post('/', createOrder);
router.get('/mark/:id', markOrderComplete);
router.get('/mark-delivered/:odeId', async (req, res) => {
  try {
    const result = await markOrdersDeliveredByNode(req.params.odeId);
    res.json(result); // always 200
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


export default router;
