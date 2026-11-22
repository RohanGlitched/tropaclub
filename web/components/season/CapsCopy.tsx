import Link from 'next/link';
import { CAPS_COPY, CAPS_COPY_LINK, SEASON1, SEASON_PATH } from '@/lib/season';

/** "Caps are points. … count toward the planned $TROPA airdrop. See the terms." The one Caps line, always with its link. */
export function CapsCopy() {
  return (
    <>
      {CAPS_COPY} <Link href={CAPS_COPY_LINK.href} prefetch={false}>{CAPS_COPY_LINK.label}</Link>
    </>
  );
}

/**
 * The small Season 1 strip: "Season 1 · Every verified buy earns Caps toward the $TROPA airdrop. How it works".
 * Server and client safe (the buy sheet uses it). `compact` drops the trailing link text to one word.
 */
export function SeasonBanner({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <p className={`season-banner${compact ? ' season-banner-sm' : ''}${className ? ` ${className}` : ''}`}>
      <span className="tag">{SEASON1.name}</span>
      <span className="season-banner-text">{SEASON1.banner}</span>{' '}
      <Link href={SEASON_PATH} prefetch={false}>{compact ? 'How it works' : 'How Season 1 works'}</Link>
    </p>
  );
}
