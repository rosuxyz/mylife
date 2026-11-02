import { redirect } from "next/navigation";
import { connection } from "next/server";
import { DatabaseError, DatabaseSetup } from "@/components/database-state";
import { LendBorrowClient } from "@/components/lend-borrow-client";
import { getProfileForUser } from "@/lib/supabase/profile";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { isSupabaseSchemaMissing } from "@/lib/supabase/schema-status";

export const instant = false;

export default async function LendBorrowPage() {
  await connection();
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) return <DatabaseSetup />;
  if (!user) redirect("/login");

  const loadRecords = async () => {
    const records: {
      id: string;
      person_name: string;
      direction: "lent" | "borrowed";
      amount_minor: number;
      occurred_at: string;
      note: string;
      status: string;
    }[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const result = await supabase
        .from("debt_records")
        .select("id,person_name,direction,amount_minor,occurred_at,note,status")
        .order("occurred_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = result.data ?? [];
      records.push(...page.map((record) => ({ ...record, amount_minor: Number(record.amount_minor) })));
      if (page.length < pageSize) return { data: records, error: null };
      offset += pageSize;
    }
  };
  const loadPayments = async () => {
    const payments: {
      id: string;
      debt_id: string;
      amount_minor: number;
      paid_at: string;
      note: string;
    }[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const result = await supabase
        .from("debt_payments")
        .select("id,debt_id,amount_minor,paid_at,note")
        .order("paid_at", { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      const page = result.data ?? [];
      payments.push(...page.map((payment) => ({ ...payment, amount_minor: Number(payment.amount_minor) })));
      if (page.length < pageSize) return { data: payments, error: null };
      offset += pageSize;
    }
  };

  const [recordsResult, paymentsResult, profileResult] = await Promise.all([
    loadRecords(),
    loadPayments(),
    getProfileForUser(supabase, user, "currency_code,timezone"),
  ]);

  const failure = recordsResult.error ?? paymentsResult.error;
  if (failure) {
    console.error("Lend & Borrow page data load failed:", failure.message);
    return <DatabaseError message="Your lend and borrow records could not be loaded." schemaMissing={isSupabaseSchemaMissing(failure)} />;
  }
  if (!profileResult) {
    return <DatabaseError message="Your profile is missing. Refresh and try again before saving debts." />;
  }
  const asOf = new Date().toISOString();

  const paymentsByDebt = new Map<string, typeof paymentsResult.data>();
  for (const payment of paymentsResult.data ?? []) {
    const existing = paymentsByDebt.get(payment.debt_id) ?? [];
    existing.push(payment);
    paymentsByDebt.set(payment.debt_id, existing);
  }

  const records = (recordsResult.data ?? []).map((record) => ({
    ...record,
    payments: paymentsByDebt.get(record.id) ?? [],
  }));

  return (
    <LendBorrowClient
      currencyCode={profileResult.currency_code ?? "GBP"}
      asOf={asOf}
      records={records}
      timezone={profileResult.timezone ?? "Europe/London"}
    />
  );
}
