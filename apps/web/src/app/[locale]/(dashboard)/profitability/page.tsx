import { redirect } from 'next/navigation';

/**
 * /profitability is the entry point for the Karlilik Analizi group —
 * redirect to the first sub-report so the sidebar always has an
 * active row when the user lands on the parent route.
 */
export default function ProfitabilityIndexPage(): never {
  redirect('/profitability/orders');
}
