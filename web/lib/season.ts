// Season 1 (the $TROPA airdrop qualifier): values and copy from rules.json (season1), safe for
// client components. The engine reads the same file (clubs/src/seasondefs.ts).
import rules from './rules.json';

const s1 = rules.season1;
export const SEASON1 = {
  ...s1,
  startAtMs: Date.parse(s1.startAt),
  endAtMs: Date.parse(s1.endAt),
  founderCaps: rules.caps.founder,
  caps: rules.caps,
} as const;

export const SEASON_PATH = '/season';
export const TERMS_HREF = '/season#terms';
export const X_HANDLE = s1.social.handle;
export const X_URL = `https://x.com/${s1.social.handle}`;

/** "Caps are points. … Season 1 Caps count toward the planned $TROPA airdrop." (then link "See the terms." to TERMS_HREF) */
export const CAPS_COPY: string = rules.caps.copy;
export const CAPS_COPY_LINK: { label: string; href: string } = rules.caps.copyLink;

export type SocialQuestId = 'follow' | 'like_repost' | 'post';
export const SOCIAL_QUEST_CAPS: Record<SocialQuestId, number> = { follow: s1.social.follow, like_repost: s1.social.likeRepost, post: s1.social.post };

/** X intent links for the quests (the post id comes from the server: SEASON_POST_ID). */
export const X_INTENTS = {
  follow: () => `https://x.com/intent/follow?screen_name=${encodeURIComponent(s1.social.handle)}`,
  like: (id: string) => `https://x.com/intent/like?tweet_id=${encodeURIComponent(id)}`,
  repost: (id: string) => `https://x.com/intent/retweet?tweet_id=${encodeURIComponent(id)}`,
  post: (text: string, url: string) => `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
};

/** The prefilled ticket post: "my seat in the NVIDIA stadium on @base via @tropaclubxyz #TropaClub". */
export const ticketPostText = (ground: string) => `my seat in the ${ground} stadium on @base via @${s1.social.handle} #TropaClub`;
