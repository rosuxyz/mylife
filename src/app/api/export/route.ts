import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/server";

type ExportRow = Record<string, unknown>;

const backupTables = [
  "profiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "jobs",
  "hourly_rates",
  "work_sessions",
  "work_breaks",
  "pay_periods",
  "income_records",
  "income_payments",
  "savings_goals",
  "goal_contributions",
  "audit_events",
] as const;

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvResponse(filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(`\uFEFF${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function fetchAll(
  supabase: NonNullable<Awaited<ReturnType<typeof getAuthenticatedUser>>["supabase"]>,
  table: (typeof backupTables)[number],
) {
  const allRows: ExportRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select("*").range(offset, offset + 999);
    if (error) throw new Error(`Backup export failed for ${table}: ${error.message}`);
    const rows = (data ?? []) as ExportRow[];
    allRows.push(...rows);
    if (rows.length < 1000) return allRows;
  }
}

export async function GET(request: NextRequest) {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const type = request.nextUrl.searchParams.get("type");
  if (!["transactions", "income", "work", "backup"].includes(type ?? "")) {
    return NextResponse.json({ error: "Choose transactions, income, work, or backup export." }, { status: 400 });
  }

  if (type === "backup") {
    try {
      const entries = await Promise.all(backupTables.map(async (table) => [
        table,
        await fetchAll(supabase, table),
      ] as const));
      const backup = {
        format: "mylife-json-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        records: Object.fromEntries(entries),
      };
      return new Response(JSON.stringify(backup, null, 2), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="mylife-backup.json"',
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("Full account backup failed:", error);
      return NextResponse.json({ error: "Unable to complete the backup. Try again after checking your connection." }, { status: 500 });
    }
  }

  if (type === "transactions") {
    const { data, error } = await supabase.from("transactions").select("*").order("occurred_at", { ascending: true });
    if (error) {
      console.error("Transaction CSV export failed:", error.message);
      return NextResponse.json({ error: "Transaction export failed." }, { status: 500 });
    }
    const rows = (data ?? []).map((item) => [
      item.occurred_at, item.kind, item.description, item.amount_minor,
      item.currency_code, item.account_id, item.from_account_id, item.to_account_id,
      item.category_id, item.payment_method, item.notes,
    ]);
    return csvResponse("mylife-transactions.csv", [
      "occurred_at_utc", "kind", "description", "amount_minor_units",
      "currency_code", "account_id", "from_account_id", "to_account_id",
      "category_id", "payment_method", "notes",
    ], rows);
  }

  if (type === "income") {
    const { data, error } = await supabase.from("income_records").select("*").order("expected_date", { ascending: true });
    if (error) {
      console.error("Income CSV export failed:", error.message);
      return NextResponse.json({ error: "Income export failed." }, { status: 500 });
    }
    const rows = (data ?? []).map((item) => [
      item.source, item.frequency, item.status, item.expected_date, item.actual_date,
      item.hours_worked_minutes, item.hourly_rate_minor, item.regular_earnings_minor,
      item.overtime_earnings_minor, item.additional_payments_minor, item.deductions_minor,
      item.gross_minor, item.net_expected_minor, item.actual_received_minor,
      item.currency_code, item.notes,
    ]);
    return csvResponse("mylife-income.csv", [
      "source", "frequency", "status", "expected_date", "actual_date",
      "hours_worked_minutes", "hourly_rate_minor", "regular_earnings_minor",
      "overtime_earnings_minor", "additional_payments_minor", "deductions_minor",
      "gross_minor", "net_expected_minor", "actual_received_minor", "currency_code", "notes",
    ], rows);
  }

  const { data, error } = await supabase.from("work_sessions").select("*").order("started_at", { ascending: true });
  if (error) {
    console.error("Work CSV export failed:", error.message);
    return NextResponse.json({ error: "Work history export failed." }, { status: 500 });
  }
  const rows = (data ?? []).map((item) => [
    item.local_work_date, item.timezone, item.started_at, item.ended_at, item.job_id,
    item.regular_minutes, item.overtime_minutes, item.hourly_rate_minor,
    item.estimated_gross_minor, item.currency_code, item.notes,
  ]);
  return csvResponse("mylife-work-history.csv", [
    "local_work_date", "timezone", "started_at_utc", "ended_at_utc", "job_id",
    "regular_minutes", "overtime_minutes", "hourly_rate_minor",
    "estimated_gross_minor", "currency_code", "notes",
  ], rows);
}
