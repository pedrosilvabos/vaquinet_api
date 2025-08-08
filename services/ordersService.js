// File: /services/ordersService.js
import supabase from '../utils/supabaseClient.js';

// GET /orders
export async function getAllOrders(req, res) {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[ORDERS] Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    res.json(data);
  } catch (err) {
    console.error('[ORDERS] Server error:', err.message);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}

// POST /orders
export async function createOrder(req, res) {
  try {
    const { price, amount, type } = req.body;

    if (!price || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('orders')
      .insert([{ price, amount, type }])
      .single();

    if (error) {
      console.error('[ORDERS] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('[ORDERS] Server error:', err.message);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}
