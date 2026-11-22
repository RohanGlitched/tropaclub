import { redirect } from 'next/navigation';

// /ticket with no wallet: the wallet check on the home page.
export default function TicketIndex() {
  redirect('/#check');
}
