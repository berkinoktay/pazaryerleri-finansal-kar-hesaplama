export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

export function formatDateRange(
  start: Date | string,
  end: Date | string,
): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

export function getDateRange(
  period: "today" | "week" | "month" | "quarter",
): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();

  switch (period) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "week":
      from.setDate(from.getDate() - 7);
      break;
    case "month":
      from.setMonth(from.getMonth() - 1);
      break;
    case "quarter":
      from.setMonth(from.getMonth() - 3);
      break;
  }

  return { from, to };
}
