=======================================
🐄 Vaquinet API Documentation
=======================================

Overview
--------
This API provides access to cow-related data stored in a Supabase database.
It is designed to be lightweight and suitable for integration with IoT and mobile apps.

Base URL (Local): http://localhost:10000
Base URL (Deployed): (replace with your Render URL)
Format: JSON
Authentication: Uses Supabase anon key internally. No external token required for public endpoints.


Endpoints
---------

GET /cows
---------
Returns all cows stored in the database.

URL: /cows
Method: GET
Auth required: No
Query Params: None

Example Request:
----------------
GET /cows HTTP/1.1
Host: localhost:10000

Example Response:
-----------------
[
  {
    "id": 1,
    "name": "Bessie",
    "location": "Pasture A",
    "status": "healthy"
  },
  {
    "id": 2,
    "name": "Daisy",
    "location": "Pasture B",
    "status": "injured"
  }
]

Error Response:
---------------
{
  "error": "Supabase query failed message"
}


Environment Variables
---------------------
To run the API, set the following in a `.env` file or Render's environment variables panel:

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PORT=10000


Running the API
---------------

Locally:
--------
1. Clone the repo
2. Run `npm install`
3. Create a `.env` file with the correct Supabase keys
4. Start the server:

   node index.js

On Render:
----------
- Set environment variables via the Render dashboard.
- Make sure your `package.json` includes:
  {
    "type": "module"
  }


Notes
-----
- Supabase table name must be exactly `cows`.
- Ensure that the table is marked as publicly readable via Supabase RLS or security policies.
- This is a read-only API for now; POST/PUT/DELETE endpoints can be added later.

=======================================
