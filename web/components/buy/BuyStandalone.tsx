'use client';

import WalletProvider from '@/components/wallet/WalletProvider';
import BuySheet from './BuySheet';

/** The buy sheet with its own wallet provider, for pages outside the clubs section. Loaded on demand. */
export default function BuyStandalone(props: { open: boolean; onClose: () => void; clubId?: string | null; token?: string | null; us: boolean }) {
  return (
    <WalletProvider initialWallet={null}>
      <BuySheet {...props} />
    </WalletProvider>
  );
}
