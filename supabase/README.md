# Supabase setup

1. Create a new Supabase project.
2. In **SQL Editor**, run `supabase/schema.sql`.
3. In **Authentication -> Users**, create the first administrator account.
4. Run the final `insert` from `schema.sql`, replacing `AUTH_USER_UUID` with the ID of that account.
5. Copy `supabase-config.example.js` to `supabase-config.js` and fill in the project URL and publishable key from **Project Settings -> API**.

`supabase-config.js` is deliberately excluded from Git. Never put a Supabase service-role key in the website or repository.
