import Decimal from "decimal.js";

export function formatCurrency(value: Decimal | string | number): string {
  const num = new Decimal(value).toNumber();
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("tr-TR").format(value);
}

export function formatPercent(value: Decimal | number): string {
  const num = typeof value === "number" ? value : value.toNumber();
  return new Intl.NumberFormat("tr-TR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(num / 100);
}
