import { opastorDb as supabase } from '../../config/supabase.js';
// optional: import { publish, TOPICS } from './mqttService.js';

const tableKV = 'app_config';        // columns: key TEXT PK, value JSONB, updated_at TIMESTAMPTZ
const tableTok = 'device_tokens';    // columns: device_id TEXT PK, token TEXT, platform TEXT NULL, updated_at TIMESTAMPTZ

const configService = {
  // GET /config/:key
  async getByKey(req, res) {
    try {
      const { key } = req.params;
      const { data, error } = await supabase
        .from(tableKV)
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json({ key, value: data.value });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read config', details: e.message });
    }
  },

  // POST /config  { key:string, value:any }
  async setByKey(req, res) {
    try {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ error: 'key required' });
      const { data, error } = await supabase
        .from(tableKV)
        .upsert({ key, value, updated_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;

      // publish(TOPICS.CONFIG_UPDATE ?? 'config/update', { key });
      res.status(201).json({ key: data.key, value: data.value });
    } catch (e) {
      res.status(500).json({ error: 'Failed to write config', details: e.message });
    }
  },

  // GET /config/fcm/token/:device_id
  async getFcmToken(req, res) {
    try {
      const { device_id } = req.params;
      const { data, error } = await supabase
        .from(tableTok)
        .select('token, platform, updated_at')
        .eq('device_id', device_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json({ device_id, ...data });
    } catch (e) {
      res.status(500).json({ error: 'Failed to read FCM token', details: e.message });
    }
  },

async getLatestFcmToken(_req, res) {
  try {
    const { data, error } = await supabase
      .from(tableTok) // e.g. 'device_tokens'
      .select('token, platform, device_id, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(); // or .single() if you prefer

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read latest FCM token', details: e.message });
  }
},



  // POST /config/fcm/token  { device_id:string, token:string, platform?:'android'|'ios'|'web' }
  async setFcmToken(req, res) {
    try {
      const { device_id, token, platform } = req.body || {};
      if (!device_id || !token) return res.status(400).json({ error: 'device_id and token required' });

      const { data, error } = await supabase
        .from(tableTok)
        .upsert({
          device_id,
          token,
          platform: platform ?? null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;

      // publish(TOPICS.FCM_TOKEN_UPDATE ?? 'fcm/token/update', { device_id });
      res.status(201).json(data);
    } catch (e) {
      res.status(500).json({ error: 'Failed to store FCM token', details: e.message });
    }
  },
};

export default configService;
