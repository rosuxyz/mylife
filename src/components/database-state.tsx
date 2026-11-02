import Link from "next/link";

export function DatabaseSetup() {
  return (
    <section className="connection-state">
      <span className="connection-mark">!</span>
      <h1>Connect your private database</h1>
      <p>
        This feature needs a Supabase project. Add its project URL and publishable
        key to <code>.env.local</code>, then apply the migrations in <code>supabase/migrations</code>.
      </p>
      <div className="connection-steps">
        <span><b>1</b> Copy <code>.env.example</code> to <code>.env.local</code>.</span>
        <span><b>2</b> Set the Supabase project URL and publishable key.</span>
        <span><b>3</b> Apply the migrations; RLS protects each user’s data.</span>
      </div>
      <Link href="/login">Go to sign in</Link>
    </section>
  );
}

export function DatabaseError({
  message,
  schemaMissing = false,
}: {
  message: string;
  schemaMissing?: boolean;
}) {
  return (
    <section className="connection-state connection-error">
      <span className="connection-mark">!</span>
      <h1>{schemaMissing ? "Finish setting up MyLife’s database" : "We couldn’t load your records"}</h1>
      {schemaMissing ? (
        <>
          <p>Supabase is connected, but MyLife’s tables or database functions are missing. Your account is not broken; finance and work features need the project migrations first.</p>
          <div className="connection-steps">
            <span><b>1</b> Open your Supabase project and go to <strong>SQL Editor</strong>.</span>
            <span><b>2</b> Run all six files in <code>supabase/migrations</code>, in filename order: <code>20261101130000</code> through <code>20261101132500</code>.</span>
            <span><b>3</b> Return here and refresh. If the schema cache is stale, use <strong>Project Settings → API → Reload schema</strong>.</span>
          </div>
          <p className="connection-help">Do not delete or recreate your account to fix a missing database schema.</p>
        </>
      ) : (
        <>
          <p>{message}</p>
          <p className="connection-help">Check the database connection and migration status, then refresh.</p>
        </>
      )}
    </section>
  );
}
