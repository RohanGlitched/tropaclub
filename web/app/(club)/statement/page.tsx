import { redirect } from 'next/navigation';

// /statement with no wallet: the wallet check on the home page, where any address opens its ticket and statement.
export default function StatementIndex() {
  redirect('/#check');
}
