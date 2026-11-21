# Tropa Club web: design plan

Phase 1, Nov 22 2026. Read-only: The Ground, The Attendance, the matchday ticket.

## Concept: the ticket office at a night match

The subject is football-club attendance applied to stock-token holders. Two objects carry the whole identity, and everything else stays quiet around them.

1. **The Ground.** A stadium seen straight from above, drawn like the seating plan a ticket office prints: every holder wallet is one seat. Ghost seats are barely there. Real fans are lit in the club's kit colours, and because the kit pattern is mapped across the stands, the crowd forms a **tifo**: hoops, halves, a sash or a chevron made of fans. A half-empty ground with a faint tifo is the picture of "17,685 tickets sold, 1,613 fans showed up".
2. **The ticket.** A wallet's holder card is a printed matchday ticket: Chalk paper, Midnight ink, a Marigold stub behind a perforation, a barcode cut from the address bytes, and a thumbnail seating plan with the seat marked.

The Ground is always a night match: its stage is Midnight in both themes, so the seats read the same everywhere and the light theme gets its 20% of dark from the stadium itself. Tickets are always Chalk paper.

What this is not: no 3D, no glow, no gradients, no card grids with soft shadows, no hero built from one big number. Flat cut shapes only (BRAND.md).

## Tokens

| Token | Light | Dark |
|---|---|---|
| `--bg` | Chalk `#F4F1E8` | Midnight `#121037` |
| `--bg-2` (bands) | `#EBE7DA` | `#17154A` |
| `--ink` | Midnight `#121037` | Chalk `#F4F1E8` |
| `--ink-2` (secondary text) | `#4A4870` | `#A9ABD9` |
| `--line` | `#D8D3C2` | `#232064` |
| `--line-2` | `#B9B4A2` | `#3A3790` |
| `--stage` (stadium floor) | Midnight `#121037` | `#0C0A2A` |
| `--accent` | Marigold `#FFC531` fills with Midnight text | Marigold fills, key numbers |
| `--link` | Midnight, underlined | Sky `#8AB8FF` |

Club colours (Pitch `#12A874`, Flare `#FF5C4D`, Sky `#8AB8FF`, Chalk) appear only inside pennants, kits and the crowd. Marigold is reserved for one thing per screen: the main action or *your* seat. No club uses Marigold as a kit primary, so a Marigold seat always means "this one is yours".

Spacing: 4px base, steps 4 8 12 16 24 32 48 72 112. Page gutter 16px (phones) to 40px. Content column max 1200px; reading column max 68ch. Radius: 0 on tickets and tables (cut paper), 6px on inputs and buttons, 14px on the stadium stage only.

## Type

- **Display, numbers, labels: Barlow Semi Condensed** (SIL OFL, self-hosted from `@fontsource/barlow-semi-condensed`, files copied to `assets/fonts`). Bahnschrift, the brand face, has no web licence. Barlow is drawn from the same highway-signage DIN tradition and at Semi Condensed matches Bahnschrift at width 90–92. Weights 600 and 700, tracking −0.01em, sentence case, tabular figures on every number.
- **Body: the system UI stack** (Segoe UI / San Francisco / Roboto), as BRAND.md specifies.
- Small caps labels (600, +0.12em) are used only where a printed ticket or a scoreboard would use them: ticket fields, table column heads, stand names. Never as an eyebrow over a heading.

Scale (1.25): 13 · 14 · 16 · 20 · 25 · 31 · 39 · 49. The hero line tops out at 56px on desktop and 34px on phones (calm type). Body 16/1.55, never under 14.

## The stadium geometry

All geometry is in `lib/stadium.ts`, pure and deterministic. It needs only the seat count, so the hero paints from `index.json` alone and never waits for a 2 MB seat file.

- **Shape.** A pitch (105:68) with a rounded-rectangle surround. Rows are offset curves of that surround: straights keep their length, corner arcs grow, so the bowl widens like a real one.
- **Tiers.** Two tiers split by a concourse gap once a ground has 10 or more rows. Small clubs get a single-tier ground.
- **Blocks.** Radial aisles cut each tier into 16 blocks: 4 per long stand, 2 per end, 1 per corner. Lower tier blocks are 101–116, upper 201–216, numbered clockwise from the north-west.
- **Capacity fit.** Seat pitch `s` is solved so capacity equals holders exactly. Big clubs fill the full bowl with small seats (NVIDIA FC: about 30 rows). Below the size where seats would exceed 9 units, the pitch is held and rows are removed instead, so a small club has a small ground rather than a big one with fat seats.
- **Who sits where.** Every slot gets a desirability score: row depth plus deterministic noise, with a small bonus near the halfway line. Seat index `i` (file order: real fans by rank, then ghosts) takes the `i`-th best slot. Real fans therefore crowd the lower rows and thin out upward, like a real attendance. Rank 1 sits pitchside at halfway. Rank is never by size (hold time, then earliest buy), so neither is the seat.
- **Block / Row / Seat** on a ticket come straight from the slot.
- **Orientation.** Landscape from 620px container width, portrait (rotated 90°) below.

### Rendering

2D canvas, DPR capped at 2.5. One frame is: pitch (flat mowing stripes, hairline markings), ghosts in one batched path, fans in two batched paths (kit primary and secondary). About 17.7k `rect` calls, 3 fills. No animation loop at rest: the canvas redraws only on resize, camera moves, filter changes and the two animations. When zoomed past 9px per seat, visible seats are drawn as oriented seat shapes with a backrest, and block numbers appear.

## Motion

One orchestrated moment, and one answer to an action:

1. **Arrival** (hero and ground page load, 1.4s): ghosts are there from the first frame, then fans take their seats in rank order. Nothing else on the page moves.
2. **Find your seat** (user action, 1.8s): the camera eases out slightly, travels, and settles on the seat. The seat turns Marigold and a Banner-T pennant drops onto it. A small ticket callout names block, row and seat.

`prefers-reduced-motion`: both land on their final frame at once. No scroll-triggered entrances, no hover lifts.

## Layout

Left-aligned throughout. A 12-column grid at 1440, single column on phones. Sections are separated by space and one hairline, not by cards.

```
HOME 1440                                   HOME 390
┌──────────────────────────────────────┐    ┌──────────────┐
│ ▣ Tropa Club   Attendance Grounds …  │    │ ▣        ☰   │
├───────────────┬──────────────────────┤    │ NVIDIA FC    │
│ NVIDIA FC     │   ╭──────────────╮   │    │ sold 17,685… │
│ sold 17,685   │   │  THE GROUND  │   │    │ ╭──────────╮ │
│ tickets.      │   │   (canvas)   │   │    │ │  ground  │ │
│ 1,613 fans    │   ╰──────────────╯   │    │ │ portrait │ │
│ showed up.    │   club pennant tabs  │    │ ╰──────────╯ │
│ [find seat ]  │                      │    │ club tabs    │
├───────────────┴──────────────────────┤    │ [find seat]  │
│ gate report: sold / dust / farmer /… │    │ gate report  │
│ find your seat + sample ticket       │    │ …            │
│ how the club works (opens Tue)       │    └──────────────┘
│ The Attendance, top of the table     │
│ measured evidence (4 figures, chart) │
│ honest limits                        │
│ closing: pennant rail + input        │
│ footer: sitemap, data, changelog     │
└──────────────────────────────────────┘
```

- **`/attendance`**: title and totals, sortable league table (position, pennant, club, tickets sold, fans, attendance bar, weekly buyers, new buyers). Under 760px each row becomes a card with the same six facts. Then: how to read it, who counts as a fan, the free JSON feed, limits.
- **`/ground/[symbol]`**: club header with pennant and the tickets/fans line, the stadium at full width with legend filters, zoom and seat search, the gate report, club figures, the front row (first ten fans by rank), how seats are given out, other grounds, limits.
- **`/ticket/[address]`**: the best ticket large, other tickets below, ghost seats listed plainly, share bar, "paste yours" field, how to read a ticket. Empty state: the gate is shut, with the club's real-fan count and an invite to the clubs opening Tuesday.
- **`/about`**: how it works, the data method, definitions, compliance, changelog.
- **404**: an empty block of seats and a way back.

## Components

`SiteHeader`, `SiteFooter`, `Logo` (brand SVG paths, `currentColor`), `ThemeToggle`, `Pennant` (five kit patterns), `Ground` (canvas), `GroundStage` (club tabs, headline, search, callout), `SeatSearch`, `Ticket`, `MiniPlan`, `Barcode`, `GateReport`, `AttendanceTable`, `WeeklyChart`, `ShareBar`, `SampleBadge`, `ClubsOnly` (region gate).

## Copy rules (from SPEC v3 to v3.2)

- A holding is "stock tokens that track the share price". Never "you own shares".
- No advice, no returns language, no green/red arrows. Tickets never print a dollar amount.
- Ranks and seats are never by size.
- Cards carry "past performance · not advice".
- Club and buy sections are hidden in the US and its territories only (owner decision, contest rules). Read-only pages are global.
- Club names such as "NVIDIA FC" are nicknames for a token's holders; the footer says they are not affiliated with the companies.

## States

Loading: the stage paints its pitch from CSS before JavaScript runs, so there is no jump. Empty: says what to do next. Error: one sentence and a retry. Sample data: a visible badge in the header strip and footer whenever any file came from the mock generator.

## Motion language

One orchestrated moment per screen. Everything else answers something the visitor did. Durations and easing are tokens in `globals.css` (`--dur-quick` 160ms, `--dur-move` 420ms, `--dur-scene` 760ms, `--ease-out`). Under `prefers-reduced-motion` every one of these lands on its final frame.

| Moment | Where | What moves | Trigger | Reduced motion |
|---|---|---|---|---|
| Arrival | Home hero, ground page | Fans take their seats in rank order over 1.4s. Ghosts are there from frame one. | Page load | Fans drawn at once |
| Find your seat | The Ground | Camera travels and settles on the seat in 1.8s; the seat turns Marigold; the Banner T drops on it; a callout names block, row, seat. | Submitting a wallet | Camera jumps to the seat |
| Print-in | Ticket page | The first ticket feeds out of the printer in 12 steps. | Page load (the page's one moment) | Ticket shown whole |
| Tear | Ticket page | The stub pulls away from the ticket along the perforation. | Share picture is ready | Stub shifts with no transition |
| Flip digits | Scoreboard | Changed digits fall like split-flap cells, right to left. | A count changes (Matchday) | Digit swaps in place |
| Pennant raise | Team sheet, club join | The pennant runs up from below its rail with a small overshoot. | A member steps up / joins | Pennant shown in place |

No scroll-triggered entrances. No hover lifts. Nothing loops.

## Structure, and where Phase 2 slots in

```
app/
  layout.tsx            fonts, theme script, metadata
  not-found.tsx
  (site)/               public read-only pages; layout.tsx = header + data stamp footer
    page.tsx  attendance/  ground/[symbol]/  ticket/[address]/  about/
  (club)/               PHASE 2: layout.tsx wraps the wallet provider (wagmi/viem) around the same chrome
    clubs/  club/[id]/  club/[id]/matchday/  fixtures/  supporters/  stats/  statement/[address]/
  api/                  one folder per resource; each route.ts is thin
    wallet/ seats/ resolve/ region/ card/      (Phase 2: buy/quote, buy/verify, clubs/…)
lib/
  server/               server-only modules (import 'server-only'): data, card, cardstore, api helpers
  stadium.ts clubs.ts ticket.ts format.ts site.ts     shared, pure, usable on both sides
  client.ts             browser fetch helpers and hooks
components/
  ds/                   design system, no data fetching: Logo, Pennant, Ticket, LeagueTable, Scoreboard, TeamSheet
  Ground.tsx GroundStage.tsx …                        feature components that compose ds/
mock/                   sample data generator
```

API route pattern: validate the input, call `rateLimited()`, call one function from `lib/server/*`, answer with `ok()` or `fail()` from `lib/server/api.ts`. Secrets and SDK clients only ever live under `lib/server`.

Design-system notes for Phase 2:

- **LeagueTable** is generic (`columns`, `lead`, `rowKey`). The Attendance is one configuration; club standings and the Supporters table are two more. Supporters columns must be participation and streak only.
- **Scoreboard** takes labelled cells of counts. It has no slot for money or returns, on purpose.
- **TeamSheet** takes members with `playing` or `bench`, and an optional `onCallUp`. When call-ups are not allowed (limit reached, region), pass `callUpOff` with the reason so the button stays visible and explains itself.
- **Pennant** is the club crest. A kit is `{ primary, secondary, pattern }`; clubs pick theirs at creation. Marigold is never a kit primary.
- **Ticket** is the pattern for every printed artifact. The cost-basis statement is a match programme page built from the same paper, rules and label type.
- The buy sheet belongs to `(club)` only. No buy button appears on a ticket, a card or any `(site)` page.
- Region: `/api/region` answers `{ clubs: boolean }`. Blocking is US and its territories only. Anything with class `clubs-only` hides there; read-only pages stay open everywhere.

## Phase 2 as built (wallet, buying, clubs)

### Routes

```
app/(site)/   public and read-only, mostly static: /  /attendance  /ground/[symbol]  /ticket/[address]  /about
app/(club)/   needs a wallet, rendered per request, wrapped in WalletProvider:
              /clubs  /join/[code]  /club/[id]  /league  /stats  /statement/[address]
app/api/      auth/{challenge,verify,session}   buy/{tokens,quote,record}
              clubs (create)  clubs/{join,pickup,callup}  statement/[address]/csv
              cron/[job]   region   card   wallet   seats   resolve
/docs         redirects to https://docs.tropaclub.xyz
```

### Server modules (`lib/server`, all `server-only`)

| File | Job |
|---|---|
| `chain.ts` | One Base read client: `BASE_RPC_URL` first, then keyless public RPCs. |
| `session.ts` | Sign-In With Ethereum (EIP-4361). Verified on Base with `verifySiweMessage`, so ERC-1271 and ERC-6492 smart wallets work. Stateless signed challenge, then an httpOnly `__session` cookie (the only cookie Firebase Hosting forwards). |
| `geo.ts` | Country from a country header if one arrives, else from the client IP in the DB-IP Country Lite database (`../geo`). US and territories are blocked; unknown countries must tick "I am not a US person". |
| `buy.ts` | `listBuyTokens()` (only tokens that pass `isBuyable`) and `quoteBuy()`: isBuyable, balance check, getQuote, guardMinOut, buildSwap, allowance, buildBuyCalls. Quotes are cached 12 s, buyable checks 60 s, the token list 5 min. |
| `clubs.ts` | The `@tropaclub/clubs` service, one per instance. Firestore on Cloud Run; elsewhere an in-memory store seeded with sample clubs on a fixed demo clock (`CLUBS_DEMO_NOW`). |
| `statement.ts` | Statement per wallet, cached 10 min, with a 45 s deadline and a specimen fallback. |
| `api.ts` | `ok`, `fail`, `rateLimited`, `readJson`, `guarded` (turns `ClubsError` into its own sentence and status). |

### The buy sheet

`components/buy/BuySheet.tsx`, a native `<dialog>`. The server builds the calls; the browser only plans and sends them:

1. Pick a stock (buyable tokens only; tokens without a feed are labelled "no reference price"), $10 / $25 / $50, USDC or ETH.
2. Live quote, refreshed every 20 s. A hold is one sentence with the reason (balance short, outside the 1.5% guard, corporate action, no route).
3. `wallet_getCapabilities`, then `planSend` from `@tropaclub/buy`: one `wallet_sendCalls` with `dataSuffix` when the wallet supports it, otherwise approve and buy as separate transactions, each waited for.
4. A step list shows approve, buy and confirmation. Buttons lock while anything is in flight. Every failure maps to one sentence (`decodeRevert` for reverts).
5. On success: BaseScan link, then `POST /api/buy/record`, which runs `verifyAttribution` and `clubs.recordBuy`.

US visitors get "Not available to US persons" and no buy button. The sheet always says "Buys here don't earn third-party cashback".

### Design-system additions

- **Crest** (`ds/Pennant.tsx`): pennant plus one of eight emblems, drawn from the recipe `crestFromSeed()` returns. Stock clubs wear their ground's kit instead.
- **Scoreboard**: Played, Bench and Turnout as flip digits. The line under them may name the top scorer and the club median, always with "Returns are status only".
- **TeamSheet**: Played and Bench columns, streak badges, call-up buttons with the reason shown when call-ups are off.
- **LeagueTable**: three more configurations in `components/club/Tables.tsx` (league, preseason, Supporters).
- **Programme** (statement page): the cost-basis statement printed on Chalk paper like a match programme page, with stacked rows on phones and a CSV download for the signed-in owner.

### Region gate, no flash

An inline script in `<head>` reads the `tc_region` cookie before first paint and sets `data-region` on `<html>`. With no cookie (first visit) it sets `pending`, which keeps `.clubs-only` sections invisible but in the layout until `/api/region` answers and leaves the cookie. Pages stay static and CDN-safe: no page response ever carries a per-visitor cookie. Club pages are rendered per request and also check the region on the server.

### Motion, as implemented

Arrival, find-your-seat fly-in, ticket print-in, stub tear on share, flip digits on any Scoreboard change, pennant raise when a club is founded, when you join (crest and your row), and in the Matchday preview. Pinch, ctrl+wheel and double-tap zoom on the stadium. All respect `prefers-reduced-motion`.
