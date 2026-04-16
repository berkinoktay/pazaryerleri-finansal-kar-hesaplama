export type Platform = "TRENDYOL" | "HEPSIBURADA";

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURNED";

export type SettlementStatus = "PENDING" | "VERIFIED" | "DISCREPANCY";

export type ExpenseCategory =
  | "PRODUCT_COST"
  | "ADVERTISING"
  | "PACKAGING"
  | "SHIPPING_SUPPLY"
  | "SOFTWARE"
  | "PERSONNEL"
  | "RENT"
  | "OTHER";

export type SyncType = "ORDERS" | "PRODUCTS" | "SETTLEMENTS";

export type SyncStatus = "RUNNING" | "COMPLETED" | "FAILED";
