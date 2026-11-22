'use client';

import WalletProvider from '@/components/wallet/WalletProvider';
import BuySheet, { type BuySheetProps } from './BuySheet';

/** The buy sheet with its own wallet provider, for pages outside the clubs section. Loaded on demand. */
export default function BuyStandalone(props: BuySheetProps) {
  return (
    <WalletProvider initialWallet={null}>
      <BuySheet {...props} />
    </WalletProvider>
  );
}
