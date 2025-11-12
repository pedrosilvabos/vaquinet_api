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

// services/ordersService.js
export async function markOrderComplete(req, res) {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,status,processed_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}


// POST /orders  { type: string, payload?: object, status?: 'pending'|'processed'|'failed' }
export async function createOrder(req, res) {
  try {
    const { type, payload = {}, status = 'pending' } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Missing required field `type`' });

    const { data, error } = await supabase
      .from('orders')
      .insert([{ type, payload, status }])
      .select('*')
      .single();

    if (error) {
      console.error('[ORDERS] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create order' });
    }
    return res.status(201).json(data);
  } catch (err) {
    console.error('[ORDERS] Server error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
}

// Helper for internal callers (no Express req/res)
export async function createOrderDirect({ type, payload = {}, status = 'pending' }) {
  const { data, error } = await supabase
    .from('orders')
    .insert([{ type, payload, status }])
    .select('id,type,payload,status,created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Convenience for fence breach
export async function createFenceBreachOrder({ nodeId, farmId, phone }) {
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  // Check for recent alert
  const { data: recent, error: recentErr } = await supabase
    .from('orders')
    .select('id, created_at')
    .eq('type', 'fenceBreach')
    .eq('payload->>node_id', nodeId)
    .gte('created_at', tenMinutesAgo.toISOString())
    .limit(1)
    .maybeSingle();

  if (recentErr) throw new Error(recentErr.message);
  if (recent) return null; // skip, too soon

  // Otherwise, create new order
  return createOrderDirect({
    type: 'fenceBreach',
    payload: { node_id: nodeId, farm_id: farmId, phone },
    status: 'pending',
  });
}

export async function markOrdersDeliveredByNode(nodeId) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'processed' })
    .eq('payload->>node_id', nodeId)
    .eq('status', 'pending')
    .select('id,type,status,created_at');

  if (error) throw new Error(error.message);
  return data;
}

