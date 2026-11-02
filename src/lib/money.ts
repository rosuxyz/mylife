import { z } from "zod";

export const moneyInputSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "Enter an amount with up to two decimal places.")
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  })
  .refine((value) => Number.isSafeInteger(value) && value > 0, "Enter an amount greater than zero.");

export function formatMinorUnits(amount: number, currencyCode = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
  }).format(amount / 100);
}

export function currencySymbol(currencyCode: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currencyCode;
}
