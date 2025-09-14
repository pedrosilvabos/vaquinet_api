import supabase from '../utils/supabaseClient.js';
import { publish, TOPICS } from './mqttService.js';

const fenceService = {
  // GET /fences?farm_id=...
  async getAllFences(req, res) {
    try {
      const farmId = req.query.farm_id || null;
      // Returns rows with geom_geojson + bbox_geojson + centroid_geojson
      const { data, error } = await supabase
        .rpc('get_fences_geojson', { p_farm_id: farmId });

      if (error) throw error;
      res.status(200).json(data); // array of { id, farm_id, name, geom_geojson, bbox_geojson, centroid_geojson, props, version, ... }
    } catch (err) {
      console.error('[GET] Error fetching fences:', err.message);
      res.status(500).json({ error: 'Failed to fetch fences', details: err.message });
    }
  },

  // GET /fences/:id
  async getFenceById(req, res) {
    const { id } = req.params;
    try {
      const { data, error } = await supabase
        .rpc('get_fence_geojson_by_id', { p_id: id });
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Fence not found' });
      res.status(200).json(data);
    } catch (err) {
      console.warn(`[GET] Fence not found: ${id}`, err.message);
      res.status(404).json({ error: 'Fence not found', details: err.message });
    }
  },

  // POST /fences  (accepts either body.geojson OR body.points [[lat,lon],...])
  async createFence(req, res) {
    const { farm_id, name, geojson, points, props, version } = req.body;

    if (!farm_id || !name) {
      return res.status(400).json({ error: 'farm_id and name are required' });
    }
    if (!geojson && !Array.isArray(points)) {
      return res.status(400).json({ error: 'Provide either geojson or points [[lat,lon],...]' });
    }

    try {
      let upsert;
      if (geojson) {
        upsert = await supabase.rpc('upsert_fence_geojson', {
          p_id: null,
          p_farm_id: farm_id,
          p_name: name,
          p_geojson: geojson,
          p_props: props || {},
          p_version: version || 1,
        });
      } else {
        upsert = await supabase.rpc('upsert_fence_latlon', {
          p_id: null,
          p_farm_id: farm_id,
          p_name: name,
          p_points: points,
          p_props: props || {},
          p_version: version || 1,
        });
      }

      if (upsert.error) throw upsert.error;
      const createdId = upsert.data;

      // fetch created fence as GeoJSON to return and to publish
      const { data, error } = await supabase
        .rpc('get_fence_geojson_by_id', { p_id: createdId });
      if (error) throw error;

      publish(TOPICS.FENCE_CREATE ?? 'fences/create', data);
      res.status(201).json(data);
    } catch (err) {
      console.error('[POST] Fence creation failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  },

  // PUT /fences/:id  (same payload shape; upsert by id)
  async updateFence(req, res) {
    const { id } = req.params;
    const { farm_id, name, geojson, points, props, version } = req.body;

    if (!id) return res.status(400).json({ error: 'Missing fence id' });
    if (!farm_id || !name) return res.status(400).json({ error: 'farm_id and name are required' });

    try {
      let upsert;
      if (geojson) {
        upsert = await supabase.rpc('upsert_fence_geojson', {
          p_id: id,
          p_farm_id: farm_id,
          p_name: name,
          p_geojson: geojson,
          p_props: props || {},
          p_version: version || 1,
        });
      } else if (Array.isArray(points)) {
        upsert = await supabase.rpc('upsert_fence_latlon', {
          p_id: id,
          p_farm_id: farm_id,
          p_name: name,
          p_points: points,
          p_props: props || {},
          p_version: version || 1,
        });
      } else {
        return res.status(400).json({ error: 'Provide geojson or points [[lat,lon],...]' });
      }

      if (upsert.error) throw upsert.error;

      const { data, error } = await supabase
        .rpc('get_fence_geojson_by_id', { p_id: id });
      if (error) throw error;

      publish(TOPICS.FENCE_UPDATE ?? 'fences/update', data);
      res.status(200).json(data);
    } catch (err) {
      console.error(`[PUT] Error updating fence ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },

  // DELETE /fences/:id
  async deleteFence(req, res) {
    const { id } = req.params;
    try {
      const { error } = await supabase.from('fences').delete().eq('id', id);
      if (error) throw error;
      publish(TOPICS.FENCE_DELETE ?? 'fences/delete', { id });
      res.status(204).send();
    } catch (err) {
      console.error(`[DELETE] Failed to remove fence ${id}:`, err.message);
      res.status(400).json({ error: err.message });
    }
  },
};

export default fenceService;
