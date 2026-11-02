"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { formatMinorUnits } from "@/lib/money";

export const chartColors = {
  income: "#69c99a",
  expense: "#d48a82",
  balance: "#83a7e8",
  savings: "#a790de",
  hours: "#83a7e8",
  lent: "#69c99a",
  borrowed: "#d48a82",
  target: "#727987",
  muted: "#8993a5",
};

export function useChartAnimation() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return enabled;
}

type TooltipPoint = {
  color?: string;
  name?: string;
  value?: number | string;
};

export function VisualizationCard({
  title,
  subtitle,
  children,
  className = "",
  headerAction,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
}) {
  return (
    <section className={`visualization-card ${className}`.trim()}>
      <header className="visualization-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {headerAction}
      </header>
      {children}
    </section>
  );
}

export function ChartEmpty({ message }: { message: string }) {
  return <p className="chart-empty">{message}</p>;
}

export function MoneyChartTooltip({
  active,
  payload,
  label,
  currencyCode,
}: {
  active?: boolean;
  payload?: TooltipPoint[];
  label?: string;
  currencyCode: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((point) => (
        <span className="chart-tooltip-row" key={point.name}>
          <i style={{ backgroundColor: point.color }} />
          {point.name}: {formatMinorUnits(Number(point.value ?? 0), currencyCode)}
        </span>
      ))}
    </div>
  );
}

export function HoursChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPoint[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((point) => (
        <span className="chart-tooltip-row" key={point.name}>
          <i style={{ backgroundColor: point.color }} />
          {point.name}: {Number(point.value ?? 0).toFixed(2).replace(/\.?0+$/, "")} hrs
        </span>
      ))}
    </div>
  );
}
