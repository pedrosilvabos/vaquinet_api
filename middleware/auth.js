// middleware/auth.js
import { opastorDb as supabase } from '../config/supabase.js';

export async function requireBearerToken(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }

  const token = auth.split(' ')[1];

  const { data, error } = await supabase
    .from('api_tokens')
    .select('id, is_active, expires_at')
    .eq('token', token)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  if (!data.is_active) {
    return res.status(403).json({ error: 'Token disabled' });
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Token expired' });
  }

  req.tokenInfo = data;
  next();
}
