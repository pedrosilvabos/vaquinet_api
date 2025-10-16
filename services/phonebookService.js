// File: services/phonebookService.js
import supabase from '../utils/supabaseClient.js';
export async function getAllContacts(req, res) {
  const { data, error } = await supabase.from('phonebook').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

export async function addContact(req, res) {
  const { name, contact } = req.body;
  if (!name || !contact)
    return res.status(400).json({ error: 'name and contact required' });

  const { data, error } = await supabase
    .from('phonebook')
    .insert([{ name, contact }])
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

export async function deleteContactById(req, res) {
  const { id } = req.params;
  const { error } = await supabase.from('phonebook').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
}
