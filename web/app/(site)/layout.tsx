import { SiteFooter, SiteHeader } from '@/components/Chrome';
import { getIndex } from '@/lib/server/data';
import { groundPath } from '@/lib/clubs';
import { jumpTokens } from '@/lib/nav';

// The public, read-only site: header, sample-data note, footer with the data stamp.
// Phase 2 adds a sibling route group, (club), whose layout wraps the wallet provider around the same chrome.
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { data, source } = await getIndex();
  return (
    <>
      <SiteHeader source={source} ground={groundPath(data.tokens[0].symbol)} tokens={jumpTokens(data.tokens)} />
      {children}
      <SiteFooter source={source} asOf={data.asOf} ground={groundPath(data.tokens[0].symbol)} />
    </>
  );
}
