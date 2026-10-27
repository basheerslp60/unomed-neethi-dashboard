/// <reference types="https://deno.land/x/deno/cli/types/d deno.ns.d.ts" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      return response({ error: "Server configuration is incomplete. Ask the administrator to check Edge Function secrets." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return response({ error: "Sign in is required." }, 401);

    // Validate the caller's access token using Supabase Auth.
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
    if (callerError || !callerData.user) return response({ error: "Your session is invalid or expired." }, 401);

    // Service-role client is server-only; never put this key in browser code.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("user_id,role,active")
      .eq("user_id", callerData.user.id)
      .maybeSingle();

    if (profileError) return response({ error: "Could not verify administrator permissions." }, 500);
    if (!callerProfile || callerProfile.active !== true || callerProfile.role !== "admin") {
      return response({ error: "Only an active Super Admin can manage portal users." }, 403);
    }

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "list") {
      const [{ data: profiles, error: listError }, { data: authUsers, error: authError }, { data: branches, error: branchError }] =
        await Promise.all([
          admin.from("profiles").select("user_id,full_name,role,branch_id,active").order("full_name"),
          admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
          admin.from("branches").select("id,branch_name,network"),
        ]);
      if (listError || authError || branchError) return response({ error: "Could not load user list. Check the profiles and branches schema." }, 500);
      const authById = new Map((authUsers.users || []).map((u: any) => [u.id, u.email || ""]));
      const branchById = new Map((branches || []).map((b: any) => [Number(b.id), b]));
      const users = (profiles || []).map((p: any) => {
        const b = p.branch_id == null ? null : branchById.get(Number(p.branch_id));
        return {
          user_id: p.user_id,
          full_name: p.full_name,
          role: p.role,
          branch_id: p.branch_id,
          active: p.active === true,
          email: authById.get(p.user_id) || "",
          branch_name: b?.branch_name || null,
          network: b?.network || null,
        };
      });
      return response({ users });
    }

    if (action === "create") {
      const fullName = String(body?.full_name || "").trim();
      const email = String(body?.email || "").trim().toLowerCase();
      const password = String(body?.password || "");
      const role = String(body?.role || "");
      const branchId = body?.branch_id == null ? null : Number(body.branch_id);

      if (!fullName || fullName.length > 120) return response({ error: "Enter a valid full name (maximum 120 characters)." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return response({ error: "Enter a valid login email." }, 400);
      if (password.length < 8 || password.length > 128) return response({ error: "Password must be 8–128 characters." }, 400);
      if (!["branch_staff", "management"].includes(role)) return response({ error: "Only Branch Staff or Management roles can be created here." }, 400);

      if (role === "branch_staff") {
        if (!Number.isInteger(branchId)) return response({ error: "Choose a branch for branch staff." }, 400);
        const { data: branch, error: branchError } = await admin.from("branches")
          .select("id,active").eq("id", branchId).maybeSingle();
        if (branchError || !branch || branch.active !== true) return response({ error: "Selected branch is invalid or inactive." }, 400);
      } else if (branchId !== null) {
        return response({ error: "Management accounts must not be assigned to one branch." }, 400);
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError || !created.user) {
        return response({ error: createError?.message || "Could not create the authentication account." }, 400);
      }

      const { error: insertError } = await admin.from("profiles").insert({
        user_id: created.user.id,
        full_name: fullName,
        role,
        branch_id: branchId,
        active: true,
      });
      if (insertError) {
        // Avoid leaving an orphaned Auth account if the profile cannot be created.
        await admin.auth.admin.deleteUser(created.user.id);
        return response({ error: `Account was not completed because the profile could not be saved: ${insertError.message}` }, 400);
      }
      return response({ user: { user_id: created.user.id, email, full_name: fullName, role, branch_id: branchId, active: true } }, 201);
    }

    if (action === "set_active") {
      const userId = String(body?.user_id || "");
      const active = body?.active;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || typeof active !== "boolean") {
        return response({ error: "Invalid account or status." }, 400);
      }
      if (userId === callerData.user.id) return response({ error: "You cannot deactivate your own Super Admin account." }, 400);
      const { data: target, error: targetError } = await admin.from("profiles")
        .select("user_id,role").eq("user_id", userId).maybeSingle();
      if (targetError || !target) return response({ error: "User profile not found." }, 404);
      if (target.role === "admin") return response({ error: "Administrator accounts are protected from this screen." }, 403);

      const { error: updateError } = await admin.from("profiles").update({ active }).eq("user_id", userId);
      if (updateError) return response({ error: "Could not update the profile status." }, 500);
      return response({ user_id: userId, active });
    }

    return response({ error: "Unsupported action." }, 400);
  } catch (error) {
    console.error("admin-manage-user failed", error);
    return response({ error: "Unexpected server error. Check Edge Function logs for details." }, 500);
  }
});
