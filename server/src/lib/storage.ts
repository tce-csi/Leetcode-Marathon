import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { errors } from "@/lib/errors";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!env.isStorageConfigured) {
    throw errors.unavailable(
      "Screenshot storage is not configured. Add NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY, or submit a URL/note instead.",
    );
  }
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function isStorageConfigured(): boolean {
  return env.isStorageConfigured;
}

const SAFE_PATH = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function isValidEvidencePath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.includes("..") && path.length <= 400;
}

export interface UploadEvidenceInput {
  studentId: string;
  levelId: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

/** Uploads screenshot evidence and returns the stored object path. */
export async function uploadEvidence(input: UploadEvidenceInput): Promise<string> {
  const supabase = getClient();
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const objectPath = `${input.studentId}/${input.levelId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage
    .from(env.supabaseStorageBucket)
    .upload(objectPath, input.data, { contentType: input.contentType, upsert: false });
  if (error) {
    throw errors.unavailable(`Could not store screenshot: ${error.message}`);
  }
  return objectPath;
}

/** Returns a short-lived signed URL for stored evidence. */
export async function getEvidenceSignedUrl(path: string, expiresInSeconds = 60 * 60): Promise<string | null> {
  if (!env.isStorageConfigured || !isValidEvidencePath(path)) return null;
  try {
    const supabase = getClient();
    const { data, error } = await supabase.storage
      .from(env.supabaseStorageBucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
