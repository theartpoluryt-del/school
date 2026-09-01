import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://theartpoluryt-del.github.io",
  "https://muzjur.ru",
  "https://www.muzjur.ru",
  "http://muzjur.ru",
  "http://www.muzjur.ru",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);

function configuredKey(singleName: string, collectionName: string) {
  const single = Deno.env.get(singleName);
  if (single) return single;
  try {
    const collection = JSON.parse(Deno.env.get(collectionName) || "{}");
    return collection.default || Object.values(collection)[0] || "";
  } catch {
    return "";
  }
}

function response(origin: string, body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin"
    }
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigins.has(origin)) return response("null", { error: "Origin is not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: response(origin, {}).headers });
  if (request.method !== "POST") return response(origin, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = configuredKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS")
    || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const secretKey = configuredKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS")
    || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!supabaseUrl || !publishableKey || !secretKey || !authorization.startsWith("Bearer ")) {
    return response(origin, { error: "Server authentication is not configured" }, 500);
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const token = authorization.slice("Bearer ".length);
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return response(origin, { error: "Authentication required" }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from("school_profiles")
    .select("is_admin")
    .eq("id", callerData.user.id)
    .single();
  if (profileError || !callerProfile?.is_admin) return response(origin, { error: "Administrator access required" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return response(origin, { error: "Invalid JSON" }, 400);
  }

  const currentUsername = String(body.currentUsername || "").trim().toLowerCase();
  const newUsername = String(body.newUsername || "").trim().toLowerCase();
  const newPassword = String(body.newPassword || "");
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(currentUsername) || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(newUsername)) {
    return response(origin, { error: "Login must contain 3-32 Latin letters, digits, dots, underscores or hyphens" }, 400);
  }
  if (newPassword && newPassword.length < 12) {
    return response(origin, { error: "Password must contain at least 12 characters" }, 400);
  }
  if (currentUsername === newUsername && !newPassword) {
    return response(origin, { error: "No credential changes were requested" }, 400);
  }

  const { data: targetProfile, error: targetError } = await adminClient
    .from("school_profiles")
    .select("id, username, display_name")
    .eq("username", currentUsername)
    .single();
  if (targetError || !targetProfile) return response(origin, { error: "Employee profile was not found" }, 404);

  const nextEmail = `${newUsername}@journal.local`;
  const { data: usersData, error: usersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) return response(origin, { error: "Unable to check authentication users" }, 500);
  const targetUser = usersData.users.find((user) => user.id === targetProfile.id);
  if (!targetUser) return response(origin, { error: "Authentication account was not found" }, 404);
  if (usersData.users.some((user) => user.id !== targetProfile.id && user.email?.toLowerCase() === nextEmail)) {
    return response(origin, { error: "This login is already in use" }, 409);
  }

  let updatedAt: string | null = null;
  if (currentUsername !== newUsername) {
    const { data, error } = await adminClient.rpc("admin_sync_employee_username", {
      target_profile_id: targetProfile.id,
      new_username: newUsername
    });
    if (error) return response(origin, { error: error.message }, 409);
    updatedAt = data;
  }

  const attributes: Record<string, unknown> = {};
  if (currentUsername !== newUsername) {
    attributes.email = nextEmail;
    attributes.email_confirm = true;
  }
  if (newPassword) attributes.password = newPassword;
  const { error: updateError } = await adminClient.auth.admin.updateUserById(targetProfile.id, attributes);

  if (updateError) {
    if (currentUsername !== newUsername) {
      await adminClient.rpc("admin_sync_employee_username", {
        target_profile_id: targetProfile.id,
        new_username: currentUsername
      });
    }
    return response(origin, { error: updateError.message }, 409);
  }

  return response(origin, {
    ok: true,
    profileId: targetProfile.id,
    username: newUsername,
    passwordChanged: Boolean(newPassword),
    updatedAt
  });
});
