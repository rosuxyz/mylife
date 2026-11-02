type SupabaseError = {
  code?: string;
  message?: string;
};

const missingSchemaCodes = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

export function isSupabaseSchemaMissing(error: SupabaseError | null | undefined) {
  if (!error) return false;
  if (error.code && missingSchemaCodes.has(error.code)) return true;
  return /could not find the (table|function).*schema cache|relation .* does not exist|function .* does not exist/i
    .test(error.message ?? "");
}
