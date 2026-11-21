import { SiteFooter, SiteHeader } from '@/components/Chrome';
import WalletProvider from '@/components/wallet/WalletProvider';
import ConnectButton from '@/components/wallet/ConnectButton';
import { getIndex } from '@/lib/server/data';
import { clubsSample } from '@/lib/server/clubs';
import { sessionWallet } from '@/lib/server/session';
import { groundPath } from '@/lib/clubs';

// Clubs, buying and records: everything that needs a wallet. Same chrome as the public site,
// wrapped in the wallet provider. These pages are rendered per request.
export const dynamic = 'force-dynamic';

export default async function ClubLayout({ children }: { children: React.ReactNode }) {
  const [{ data, source }, wallet] = await Promise.all([getIndex(), sessionWallet()]);
  const ground = groundPath(data.tokens[0].symbol);
  return (
    <WalletProvider initialWallet={wallet}>
      <SiteHeader source={source} ground={ground} end={<ConnectButton compact />} sampleClubs={clubsSample} />
      {children}
      <SiteFooter source={source} asOf={data.asOf} ground={ground} />
    </WalletProvider>
  );
}
