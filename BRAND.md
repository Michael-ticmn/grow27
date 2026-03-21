# grow27 — Brand & Product Principles

## Identity

- **Name:** grow27 (always lowercase)
- **Tagline:** worth more than its weight
- **Subtext:** watching so you don't have to
- **Origin:** Built for a specific operation — #27, DFM, and MFM — then scaled to serve every farm that deserves the same tools.

## Visual Identity

**Colors:**
- Amber: `#d4a027` — primary brand, corn, grain module
- Teal: `#3ea8aa` — fields module
- Green: `#3cb96a` — herd module, positive indicators
- Purple: `#7b68c8` — finance module
- Dark background: `#111214`

**Typography:** Courier New monospace — deliberate, utilitarian, farm ledger aesthetic

**Logo:** Corn stalks (teal) + divider + "grow27" wordmark in amber

**Module colors:**
- #27Markets = amber
- #27Herd = green
- #27Fields = teal
- #27Finance = purple

## Core Brand Principles

### 1. Your data never leaves your machine

grow27 does not collect, store, transmit, or monetize user farm data. Ever. When personal operation data is involved — herd records, financials, performance logs — it lives locally, encrypted on the user's device. This is non-negotiable and a core competitive differentiator. Every feature decision must be filtered through this principle.

> "grow27 never sees your data. It never touches our servers. It lives on your machine, encrypted, period."

### 2. Built for the operation, not the investor

grow27 was built by a farmer's family, for farmers. The tool should always feel like it was made by someone who understands what 4am feeding looks like, not by a SaaS company trying to upsell a dashboard. Language should be direct, practical, and respectful of the operator's time and intelligence.

### 3. Watching so you don't have to

grow27 surfaces what matters without requiring the user to go looking for it. Prices, weather, market signals, and operation alerts should come to the user — not require navigation to find. The default state of the app should always answer: what do I need to know right now?

### 4. Worth more than its weight

Every feature earns its place. No bloat, no vanity metrics, no features that look impressive but don't help someone make a better decision about their operation. If it doesn't affect a real decision, it doesn't ship.

### 5. Free intelligence, private records

The market intelligence layer (#27Markets) is free, public, and requires no account. The operation management layer (#27Herd, #27Fields, #27Finance) is local-first, private, and where the real value lives. These are complementary, not competing.

### 6. Built by one, powered by intelligence

grow27 was built solo — one person, one operation's worth of inspiration, and AI as a co-developer. This isn't a VC-funded team of 50. That's intentional. It means every decision stayed close to the actual problem, and the tool reflects what a real operator needs — not what looks good in a pitch deck.

The same AI that built grow27 is what powers it. We're not hiding that — we're proud of it. The future of farming tools looks like this: small teams, smart systems, zero bloat.

## Product Architecture

- **PWA (current):** Market intelligence — prices, basis, weather, local buyers, auction barns, meat lockers. No account required. Works in any browser or installed as a home screen app.
- **Desktop App (roadmap):** Operation management — herd records, financials, performance tracking. Local-only, encrypted, Tauri + SQLite/SQLCipher. The PWA gets someone in the door. The desktop app is where they live.

## Naming Conventions

- Platform: grow27
- Modules: #27Markets, #27Herd, #27Fields, #27Finance
- Always lowercase for "grow27"
- Hashtag prefix for module names
- Version tags: v1.x for PWA releases

## Voice & Tone

- Direct, not corporate
- Informed, not academic
- Confident, not arrogant
- Plain language — a farmer reading this at 5am should understand it immediately
- Numbers and data get amber/teal treatment — they're the point
- Transparent about how it's built — grow27 was built by one person with AI as a co-developer. That's not a weakness, it's the point. The same tools that built this are available to every operation
- grow27 uses AI openly and honestly — to build faster, to surface better insights, and eventually to put capabilities in the hands of operators that used to require a team of analysts

## What grow27 Is Not

- Not a data broker
- Not a subscription trap
- Not built for investors to demo — built for operators to use
- Not trying to replace agronomists, vets, or lenders — trying to make conversations with them better informed
- Not hiding how it was built — one person, AI co-development, built close to the problem
