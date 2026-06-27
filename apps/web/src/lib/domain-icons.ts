import {
  Add01Icon,
  Alert02Icon,
  Analytics01Icon,
  Award01Icon,
  Building06Icon,
  Calculator01Icon,
  Calendar03Icon,
  CancelCircleIcon,
  ChartBarLineIcon,
  ChartLineData01Icon,
  Clock01Icon,
  ComputerIcon,
  Delete02Icon,
  DeliveryTruck01Icon,
  FileExportIcon,
  GlobalIcon,
  Image01Icon,
  Invoice01Icon,
  KeyboardIcon,
  LanguageSkillIcon,
  Logout01Icon,
  Mail01Icon,
  Megaphone01Icon,
  PackageIcon,
  PaintBoardIcon,
  PercentIcon,
  QrCodeIcon,
  ReceiptDollarIcon,
  RefreshIcon,
  ReturnRequestIcon,
  RocketIcon,
  Shield01Icon,
  ShieldUserIcon,
  SmartPhone01Icon,
  SquareLock02Icon,
  Store01Icon,
  Tag01Icon,
  TradeDownIcon,
  UserAdd01Icon,
  UserIcon,
  UserMultipleIcon,
} from 'hugeicons-react';

type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * Single source of truth mapping domain concepts → Hugeicons. Settings rows
 * and section headers reference these so iconography stays consistent and
 * meaningful across the product instead of being chosen ad hoc per call site.
 * Render with `<DOMAIN_ICONS.x />`; the consuming pattern (SettingsRow /
 * SettingsSection / SoftSquareIcon) sizes and tones the chip.
 *
 * Keys are concept-named, not icon-named, so an icon swap is one edit here and
 * never touches a feature component.
 */
export const DOMAIN_ICONS = {
  // Notifications
  notifEmail: Mail01Icon,
  notifDailySummary: Calendar03Icon,
  notifWeeklyReport: ChartLineData01Icon,
  notifSyncError: Alert02Icon,
  notifLowMargin: TradeDownIcon,
  notifPrice: Tag01Icon,
  notifReturn: ReturnRequestIcon,
  notifStock: PackageIcon,
  notifSystem: Shield01Icon,
  notifAnnouncement: Megaphone01Icon,

  // Security
  password: SquareLock02Icon,
  twoFactor: ShieldUserIcon,
  twoFactorSms: SmartPhone01Icon,
  twoFactorApp: QrCodeIcon,
  sessions: ComputerIcon,
  signOut: Logout01Icon,
  dangerZone: Alert02Icon,
  deleteAccount: Delete02Icon,

  // Preferences
  theme: PaintBoardIcon,
  currency: ReceiptDollarIcon,
  numberFormat: PercentIcon,
  dateFormat: Calendar03Icon,
  timezone: Clock01Icon,
  language: LanguageSkillIcon,
  shortcuts: KeyboardIcon,

  // Profile / account
  profile: UserIcon,
  region: GlobalIcon,
  avatar: Image01Icon,
  role: Shield01Icon,
  membership: Calendar03Icon,
  stores: Store01Icon,

  // Organization
  orgGeneral: Building06Icon,
  logo: Image01Icon,
  accounting: Calculator01Icon,
  vat: PercentIcon,
  withholding: ReceiptDollarIcon,

  // Subscription & billing
  plan: RocketIcon,
  usage: ChartBarLineIcon,
  autoRenew: RefreshIcon,
  billingInfo: Invoice01Icon,
  invoiceHistory: FileExportIcon,
  cancelPlan: CancelCircleIcon,

  // Members
  inviteMember: UserAdd01Icon,
  members: UserMultipleIcon,

  // Store connections
  connect: Add01Icon,
  performance: Analytics01Icon,

  // Commission
  sellerLevel: Award01Icon,
  categoryRates: PercentIcon,
  importData: FileExportIcon,

  // Shipping
  shippingSource: DeliveryTruck01Icon,
  carrier: DeliveryTruck01Icon,
} as const satisfies Record<string, IconComponent>;

export type DomainIconKey = keyof typeof DOMAIN_ICONS;
