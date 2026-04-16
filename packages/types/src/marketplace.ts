export interface MarketplaceOrder {
  platformOrderId: string;
  orderDate: string;
  status: string;
  totalAmount: string;
  commissionAmount: string;
  shippingCost: string;
  items: MarketplaceOrderItem[];
}

export interface MarketplaceOrderItem {
  platformProductId: string;
  barcode?: string;
  quantity: number;
  unitPrice: string;
  commissionRate: string;
}

export interface MarketplaceProduct {
  platformProductId: string;
  barcode?: string;
  title: string;
  category?: string;
}

export interface MarketplaceSettlement {
  platformSettlementId?: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  netAmount: string;
  items: MarketplaceSettlementItem[];
}

export interface MarketplaceSettlementItem {
  orderId?: string;
  amount: string;
  type: string;
}
