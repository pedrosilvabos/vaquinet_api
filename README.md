Vaquinet Cows API Documentation

Base URL: https://nzavorpoosmaonbevcmb.supabase.co/rest/v1
Note: This API uses Supabase PostgREST by default, so REST URLs are under /rest/v1.
The HTML client uses Supabase JS client to interact directly.

---

Authentication

- Use the SUPABASE_ANON_KEY as Bearer token in the Authorization header for REST requests.
- The client-side JS uses the anon key for safe access.

---

Table: cows

Field       | Type      | Required | Description
------------|-----------|----------|---------------------------
id          | integer   | Auto     | Unique cow identifier
name        | text      | Yes      | Cow's name
temperature | numeric   | Yes      | Cow's body temperature
location    | text      | Yes      | Cow's current location
created_at  | timestamp | Yes      | Record creation timestamp

---

Endpoints

1. Get all cows

Request:
GET /cows
Authorization: Bearer <SUPABASE_ANON_KEY>

Response Example:
[
  {
    "id": 1,
    "name": "FLORIBELA",
    "temperature": 38.5,
    "location": "Pasture 1",
    "created_at": "2025-05-23T13:19:50.670968+00:00"
  },
  {
    "id": 2,
    "name": "BELA VISTA",
    "temperature": 39.1,
    "location": "Stable 2",
    "created_at": "2025-05-24T09:00:00.000000+00:00"
  }
]

---

2. Add a new cow

Request:
POST /cows
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json

{
  "name": "FLORIBELA",
  "temperature": 38.5,
  "location": "Pasture 1",
  "created_at": "2025-05-23T13:19:50.670968+00:00"
}

Response Example:
{
  "id": 3,
  "name": "FLORIBELA",
  "temperature": 38.5,
  "location": "Pasture 1",
  "created_at": "2025-05-23T13:19:50.670968+00:00"
}

Notes:
- name, temperature, and location are required fields.
- created_at can be omitted, and the server will assign the current timestamp.

---

3. Delete a cow by ID

Request:
DELETE /cows?id=eq.3
Authorization: Bearer <SUPABASE_ANON_KEY>

Or

DELETE /cows/3
Authorization: Bearer <SUPABASE_ANON_KEY>

Response:
204 No Content on success

Example:
Cow with ID 3 deleted.

---

JavaScript (Supabase client) usage examples

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nzavorpoosmaonbevcmb.supabase.co/';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(supabaseUrl, supabaseKey);

// Fetch cows
const { data: cows, error } = await supabase.from('cows').select('*');
if (error) console.error(error);
else console.log(cows);

// Add cow
const { data, error: insertError } = await supabase
  .from('cows')
  .insert([{ name: 'FLORIBELA', temperature: 38.5, location: 'Pasture 1' }])
  .select()
  .single();
if (insertError) console.error(insertError);
else console.log('Added cow:', data);

// Delete cow
const { error: deleteError } = await supabase
  .from('cows')
  .delete()
  .eq('id', 3);
if (deleteError) console.error(deleteError);
else console.log('Deleted cow with ID 3');

---

Notes

- Make sure your Supabase table 'cows' has columns matching the API.
- The anon key allows read/write access depending on your Supabase Row Level Security (RLS) policies.
- Use the Supabase JS client in browser or Node.js for easy integration.
- For REST direct requests, always send Authorization: Bearer <anon_key> header.

---
