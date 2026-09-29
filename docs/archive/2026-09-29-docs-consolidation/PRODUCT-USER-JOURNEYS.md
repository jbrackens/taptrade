# Prediction Market Consumer Journeys — 50 Complete Journeys

Each scenario is mapped as a real journey: 10 canonical stages, and at every stage what the user **does**, what they're **thinking/feeling**, and the **friction → fork** (where they break or progress). Personas/categories are only navigation; the substance is the stage-by-stage walk.

Canonical stages: **1 Trigger · 2 Discovery · 3 Landing · 4 Orientation · 5 Evaluation · 6 Funding/Auth · 7 First trade · 8 Monitoring · 9 Resolution & payout · 10 Post & retention.** Where a persona genuinely skips a stage, that skip *is* their journey and is stated.

Applied to Tap Trade: binary YES/NO, cent-priced, categories politics/crypto/sports/entertainment/tech/economics.

---

## A. Profit / Speculation

### 1. The DeFi yield-chaser
*Crypto-native from liquidity mining; trigger = "prediction markets" trending with an airdrop rumor.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees CT thread pairing Tap Trade with a points rumor | "Another farm to rotate into" | Hook is the rumor, not the product |
| Discovery | Clicks through from the thread link | Impatient, скептичен about yield | If no incentive visible in 20s, doubts it's worth it |
| Landing | Hits /predict or a market deep-link | Scans for volume, ignores questions | Wants "what's hot" immediately, not editorial |
| Orientation | Skips all copy, hunts the highest-volume market | "Where's the deepest pool" | If liquidity isn't visible per-market, bounces |
| Evaluation | Picks the side with momentum, not a thesis | Indifferent to the actual question | Thin book = not worth the gas/time |
| Funding/Auth | Connects wallet, expects sub-minute | "Don't make me KYC for a farm" | Any KYC wall here = immediate abandon |
| First trade | Large market order on the momentum side | Sizing like a farm deposit | Slippage on a thin book sours them instantly |
| Monitoring | Checks position like a yield dashboard, hourly | ROI vs other farms, not the event | No portfolio ROI view = friction |
| Resolution & payout | Often exits before resolution; payout incidental | "Did this beat my other farm?" | Slow settlement irrelevant (already rotated) |
| Post & retention | Tallies effective yield, compares opportunities | Mercenary, zero loyalty | **Stays only if yield+incentives top next farm; else gone** |

### 2. The sportsbook crossover
*DraftKings regular; trigger = sportsbook lacks the market (election/awards/prop) they want.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Wants to bet an event their book doesn't carry | "Where can I even bet this" | — |
| Discovery | Googles "bet on the election" | Expects a sportsbook-like site | — |
| Landing | Lands on the specific market page | Looks for the bet slip | No familiar slip metaphor = mild disorientation |
| Orientation | Sees 65¢, not -186; stalls | "What's 65¢ mean as odds?" | **Biggest break point: ¢ vs American odds** |
| Evaluation | Mentally converts to odds, assesses value | "OK 65¢ ≈ 65% ≈ -186" | If no conversion hint, many quit here |
| Funding/Auth | Funds like a sportsbook deposit | Expects fast deposit | Slow/clunky deposit vs DK = unfavorable compare |
| First trade | Stakes a sports-sized amount, treats as a bet | "This is just a parlay leg" | — |
| Monitoring | Mostly ignores until the event | Set-and-forget like a bet | — |
| Resolution & payout | Expects instant settle when event ends | "Game's over, pay me" | **Settlement lag vs sportsbook instant = anger** |
| Post & retention | Compares the whole experience to DK | Speed/fairness judgment | **Stays if payout felt fast+fair; else back to DK props** |

### 3. The macro tourist
*Bloomberg reader, not a trader; trigger = viral "73% recession" screenshot.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees the screenshotted probability | "Is that real? Says who?" | — |
| Discovery | Clicks the embedded link | Skeptical of the source | Broken/slow deep-link kills it instantly |
| Landing | Arrives directly on the recession market | Looking for credibility | Homepage redirect would lose them |
| Orientation | Reads the resolution criteria carefully | "How exactly does this resolve?" | Vague criteria = won't risk money |
| Evaluation | Forms a macro thesis, sizes modestly | Conviction, not gambling | Needs named settlement source to trust |
| Funding/Auth | Funds once, reluctantly | "Minimum friction please" | Heavy KYC for one bet = abandon |
| First trade | One thesis position, modest size | Calm, deliberate | — |
| Monitoring | Does *not* check daily; conviction hold | Patient | Over-notification annoys them |
| Resolution & payout | Returns near resolution | Wants clean, sourced settlement | Ambiguous resolution = "knew it, sketchy" |
| Post & retention | Screenshots own win, posts it | Validated, mild pride | **Returns for macro events if resolution was credible; else one-and-done** |

### 4. The news-reactor
*Terminally online; trigger = breaking-news push (theirs, not yours).*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | News breaks on their feed | "Trade this before it moves" | — |
| Discovery | Opens Tap Trade from muscle memory in <90s | Urgency, adrenaline | If app slow to open, misses the window |
| Landing | Goes straight to the relevant market | "Does it even exist yet?" | **Market doesn't exist = total miss, the core risk** |
| Orientation | None — already knows what they want | Tunnel vision | — |
| Evaluation | Glances at price vs their read of the news | "Mispriced for 30 more seconds" | Thin book = can't get size in |
| Funding/Auth | Already funded (returning) | Annoyed by any re-auth | Session expiry mid-news = rage |
| First trade | Slams a market order before reprice | "Beat the crowd" | Order reject under load = the worst moment |
| Monitoring | Watches the price reprice live | Engaged, fast | Laggy price feed = flying blind |
| Resolution & payout | Exits in minutes/hours, rarely holds | "Locked the move, next" | — |
| Post & retention | Hunts the next headline | Dopamine loop | **High-frequency return iff markets exist fast + books deep at news** |

### 5. The scheduled-data scalper
*Semi-pro; trigger = economic calendar (CPI/Fed/jobs), to the minute.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Knows the print time precisely | "Pre-position before release" | — |
| Discovery | Direct to the data market (returning user) | Routine | — |
| Landing | Market detail, checks depth first | "Can I get size here?" | Thin book pre-event = won't bother |
| Orientation | None — knows the instrument cold | Focused | — |
| Evaluation | Models the surprise scenarios | Probabilistic, precise | Unclear resolution timing vs the print = risk |
| Funding/Auth | Funded, capital staged | Capital-efficiency minded | Stuck capital from a prior cycle = blocked |
| First trade | Pre-positions, then trades the surprise at release | "Race the reprice" | **Order reject at the print = relationship over** |
| Monitoring | Watches the clock then the tape | Tense seconds | Feed lag at release = blind at worst moment |
| Resolution & payout | Closes minutes later for a small edge | "Small, repeatable" | Can't exit cleanly = trapped |
| Post & retention | Logs it, moves to next calendar event | Process-driven | **Loyal+high-volume iff fills reliable in volatile window** |

### 6. The election-cycle specialist
*Shows up only for elections, goes deep; trigger = primary/major election entering the cycle.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Election season starts dominating news | "My season is here" | — |
| Discovery | Reactivates or signs up months out | Anticipation | If dormant account is hard to recover, slow start |
| Landing | Goes to politics category, scans every race | "Build my book" | Shallow politics coverage = underwhelmed |
| Orientation | Knows the mechanics; assesses the slate | Strategic | Missing key races = goes elsewhere too |
| Evaluation | Builds a multi-race portfolio thesis | Analytical, invested | No portfolio view = clumsy across races |
| Funding/Auth | Funds significantly (biggest of their year) | Committed | Deposit caps below their size = friction |
| First trade | Many positions across races over weeks | Active management | — |
| Monitoring | Trades every debate/poll/scandal | High engagement, daily | Slow price updates on news = missed edge |
| Resolution & payout | Election night = marathon live session | Peak intensity | **Platform buckles under election-night load = catastrophe** |
| Post & retention | Big realized P&L event, then goes dark ~18mo | Done till next cycle | **Worthless unless you can re-wake them in 18 months** |

### 7. The cross-platform arbitrageur
*Runs the same market on Tap Trade/Polymarket/Kalshi; trigger = a price discrepancy.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Spots Tap Trade price diverging from peers | "Free spread" | — |
| Discovery | Already monitors all venues by tool/eye | Mechanical | — |
| Landing | Jumps to the diverged market | "How deep is the cheap side" | Thin book = can't lock meaningful spread |
| Orientation | None — pure price/size math | Indifferent to the event | — |
| Evaluation | Computes spread net of fees both legs | "Is the edge real after costs" | Opaque fees = can't compute = skips |
| Funding/Auth | Keeps capital staged across venues | Capital must cycle | — |
| First trade | Takes cheap side here, opposite elsewhere | "Locked, market-neutral" | Slippage eats the spread |
| Monitoring | Holds the locked spread, manages inventory | Neutral on outcome | — |
| Resolution & payout | Collects on both legs at resolution | "Just unwind" | Slow settle ties up capital |
| Post & retention | Withdraws, redeploys to next spread | Mercenary, disciplined | **Stays iff withdrawals fast + limits high; else capital flees** |

### 8. The market maker / LP
*Provides two-sided depth for spread/rebate; trigger = markets with flow but thin books.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Notices retail flow into thin markets | "Spread to earn here" | — |
| Discovery | Surveys which markets have flow, no depth | Opportunity scan | No volume signals = can't find targets |
| Landing | Order book view, studies the spread | "Quote both sides" | AMM-only (no real book) = can't operate |
| Orientation | Knows the engine; checks maker rules | Risk/inventory mindset | No post-only = adverse-selection risk |
| Evaluation | Models inventory risk vs spread earned | "Does flow justify risk" | Bad maker economics = won't quote |
| Funding/Auth | Large standing balance | Inventory-funded | — |
| First trade | Posts resting limits both sides | "Earn the spread" | Bad reservation TTLs = orders die mid-quote |
| Monitoring | Manages inventory as retail takes quotes | Continuous, active | Can't re-quote fast = picked off |
| Resolution & payout | Flattens inventory near resolution | Neutral target | — |
| Post & retention | Stays while retail flow persists | Flywheel-dependent | **First to leave when volume dips — they ARE the liquidity** |

### 9. The longshot lottery player
*Recreational; trigger = a wild "what if" market, dreaming of 20-50x.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees an outlandish market shared | "Imagine if that hit" | — |
| Discovery | Arrives from a social share | Playful | — |
| Landing | The specific meme/longshot market | "How cheap is YES" | — |
| Orientation | Barely reads; it's lottery money | Low stakes mentally | — |
| Evaluation | Wants the cheapest, wildest YES | "$5 for a maybe-50x" | If no cheap longshots surfaced, no draw |
| Funding/Auth | Tiny deposit, low commitment | "Beer money" | Big deposit minimum = walks |
| First trade | Small stake, expects to lose | Pure hope | — |
| Monitoring | Forgets about it entirely | Out of mind | — |
| Resolution & payout | Either 20x euphoria or worthless shrug | Calibrated to "lottery" | Loss doesn't churn (expected); win is huge |
| Post & retention | If it hits: screenshots, evangelizes forever | "I won 40x on Tap Trade" | **Rare win = lifelong advocate; loss = neutral, returns for next** |

### 10. The favorite-grinder
*Risk-averse; trigger = wants better-than-savings yield at perceived low risk.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Wants "safe" yield above a savings account | "Low-risk return" | — |
| Discovery | Searches for safe/high-probability bets | Cautious | — |
| Landing | Filters/sorts for 88¢+ YES | "Near-certain only" | No probability sort = can't find them |
| Orientation | Reads probability as near-guarantee | Underweights the tail | — |
| Evaluation | Stakes large for small absolute gain | "T-bill-like" | Doesn't internalize 1-in-12 loss |
| Funding/Auth | Funds a sizable amount | Confident | — |
| First trade | Big stake on a 92¢ YES | "Basically free" | — |
| Monitoring | Barely watches; "it's safe" | Complacent | — |
| Resolution & payout | Eventually a 92¢ loses | Shock, feels scammed | **The defining moment: variance feels like betrayal** |
| Post & retention | Either accepts variance or rage-quits | "It was supposed to be safe!" | **Churns hard unless pre-framed; honest odds copy decides it** |

### 11. The copy-trader
*Follows winners, not own analysis; trigger = sees a great leaderboard profile.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Wants returns without doing the work | "Just follow the best" | — |
| Discovery | Finds the Leaderboards page | "Who's actually winning" | No leaderboard = no journey at all |
| Landing | Opens the top accuracy/P&L profile | "Can I see their bets?" | Hidden positions = dead end |
| Orientation | Tries to understand what to mirror | "Copy these picks" | No follow primitive = manual, error-prone |
| Evaluation | Decides which star to track | Trust by track record | Gameable leaderboard = mistrust |
| Funding/Auth | Funds to mirror positions | Committed to the strategy | — |
| First trade | Manually replicates the star's open bets | "Riding their coattails" | Stale data = copies the wrong thing |
| Monitoring | Watches both star and own P&L | "Is the star still hot?" | No position visibility = can't keep up |
| Resolution & payout | Wins/loses with the followed trader | Attributes outcome to the star | — |
| Post & retention | Stays while the star performs+is visible | Loyalty to the star, not you | **Churns when star cools or positions go dark** |

### 12. The insider-edge believer
*Domain pro (pharma/law/sports); trigger = a market in their professional wheelhouse.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees a market they "know the answer" to | "This is free money" | — |
| Discovery | Searches their domain markets | Confident | Thin domain coverage = nothing to trade |
| Landing | The specific specialist market | "I know how this resolves" | — |
| Orientation | Scrutinizes resolution criteria | "Does it resolve on what I know?" | Criteria that nullify their edge = won't bet |
| Evaluation | Sizes up with conviction | Certainty, slight arrogance | — |
| Funding/Auth | Funds meaningfully | "Easy money" | — |
| First trade | Large conviction position | "I can't lose this" | — |
| Monitoring | Watches confidently | Sure of outcome | — |
| Resolution & payout | Validated, or blindsided by why markets are hard | Triumph or humbling | Ambiguous resolution that voids their edge = fury |
| Post & retention | If right: category specialist+evangelist | "I have an edge here" | **Specialist loyalty if right; bruised exit if edge was illusory** |

---

## B. Hedging / Utility

### 13. The election hedger
*Politically anxious, not a gambler; trigger = dread about a specific outcome.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Anxiety spikes about an election result | "I can't control this" | — |
| Discovery | Searches "bet against [candidate]" | Emotional, not analytical | — |
| Landing | The election market | "Can this soften the blow?" | — |
| Orientation | Needs permission to see this as a hedge | "Is this gambling? Am I bad?" | **No hedge framing = guilt → abandon** |
| Evaluation | Buys the outcome they fear | "Insurance against my nightmare" | — |
| Funding/Auth | Modest deposit | Reluctant but motivated | KYC friction at peak anxiety = drop |
| First trade | Buys the feared side, modest size | Relief at having "covered" it | — |
| Monitoring | Election night, hoping to lose the bet | Anxious, conflicted | — |
| Resolution & payout | Relief either way (cash or preferred result) | Emotionally hedged | Slow payout undercuts the comfort |
| Post & retention | Returns every charged election | "This made it bearable" | **Cyclic; not a between-election user** |

### 14. The small-business regulatory hedger
*Owner exposed to a ruling/policy; trigger = a pending decision that hits their business.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A regulatory decision threatens the business | "I have real exposure" | — |
| Discovery | Researches if a market on it exists | Pragmatic, financial | — |
| Landing | Hunts the specific decision market | "Does this match my risk?" | **No market at their granularity = unserved, leaves** |
| Orientation | Studies resolution vs their exposure | "Will this actually offset?" | Loose criteria = won't trust as a hedge |
| Evaluation | Sizes the hedge to real-dollar exposure | Treating it as an instrument | Low limits = can't hedge real size |
| Funding/Auth | Funds to the exposure size | Business-serious | Heavy KYC acceptable here (expected) |
| First trade | One sized hedge, holds it | "This is insurance" | — |
| Monitoring | Watches like a financial position | Calm, periodic | — |
| Resolution & payout | Payout offsets (or not) the business hit | "Did the cover work?" | Bad/opaque resolution = lost trust + money |
| Post & retention | Quiet durable utility user | "This is a real tool" | **Rarest+stickiest user if served** |

### 15. The fan hedger ("win either way")
*Superfan who hates losing; trigger = their team/artist in a high-stakes final.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Big final involving their side announced | "I'll be devastated if they lose" | — |
| Discovery | Looks for a market on the final | "Can I cover the heartbreak?" | — |
| Landing | The event market | "Bet against my own team?" | — |
| Orientation | Reframes betting-against as protection | "Smart, not disloyal" | No reframe = feels like betrayal, abandons |
| Evaluation | Bets the side they *don't* want | Strategic emotional management | — |
| Funding/Auth | Small/modest stake | Casual | — |
| First trade | Buys against their team | "Now I win either way" | — |
| Monitoring | Watches the event, invested both ways | Intense, ambivalent | — |
| Resolution & payout | Joy+small tax, or loss+cash cushion | Emotionally insulated | Slow payout dulls the cushion |
| Post & retention | Returns every championship/awards season | "Never lose a final again" | **Ritual-driven seasonal recall** |

### 16. The crypto-holder hedger
*Long a bag, wants downside cover; trigger = macro fear, a key level nearing.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | BTC approaching a scary level | "Don't want to sell, want cover" | — |
| Discovery | Crypto-native, knows where to look | "Need a put-like market" | — |
| Landing | Crypto category, hunts a strike/date | "Is there a market at my level?" | **No matching strike/date = unserved** |
| Orientation | Maps the market to a put payoff | "This hedges my bag" | — |
| Evaluation | Sizes to the pain threshold of the bag | Risk-management mindset | — |
| Funding/Auth | Funds from wallet, fast | Expects crypto-speed | Slow funding kills the moment |
| First trade | Buys "BTC below $X by date" | "Cheap insurance" | — |
| Monitoring | Tracks alongside portfolio | Calm, hedged | — |
| Resolution & payout | Offsets a drawdown or expires cheap | "Worked / cheap to be wrong" | — |
| Post & retention | Recurs every volatile macro window | "Standard part of my risk kit" | **Recurring iff strike library stays current** |

### 17. The event-organizer hedger
*Runs an event with binary risk (rain-out/attendance); trigger = real operational exposure.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Operational risk on an upcoming event | "I could lose money if X" | — |
| Discovery | Searches for a matching market | Hopeful, practical | — |
| Landing | Looks for their exact risk | "Nothing this specific exists" | **Almost always unserved today** |
| Orientation | Considers a proxy market | "Close enough?" | Proxy mismatch = not a real hedge |
| Evaluation | Usually concludes it doesn't fit | Disappointed | — |
| Funding/Auth | Rarely reaches funding | — | — |
| First trade | Usually none (no fitting market) | "Maybe someday" | — |
| Monitoring | N/A | — | — |
| Resolution & payout | N/A | — | — |
| Post & retention | Leaves an unmet-need signal | "Wish this existed" | **Wedge only if user-proposed/parametric markets ship** |

---

## C. Information / Forecasting

### 18. The journalist / analyst
*Cites the market as data; trigger = writing about an uncertain event.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Needs a probability to quote in a piece | "What's the market saying?" | — |
| Discovery | Searches "[event] odds" | Source-evaluating | — |
| Landing | Market page, no account | "Is this citeable/legit?" | **Auth wall to even see price = bounce, no citation** |
| Orientation | Reads the price as a number | "Clean enough to quote?" | Cluttered page = won't screenshot |
| Evaluation | Decides whether to cite/embed | Editorial judgment | No embed = less distribution for you |
| Funding/Auth | Usually never funds | "Not here to bet" | — |
| First trade | Maybe a token "skin in the game" trade | "For the column" | — |
| Monitoring | Tracks for the story, not P&L | Narrative-driven | — |
| Resolution & payout | Notes the outcome for follow-up piece | "Did the market call it?" | — |
| Post & retention | Recurring traffic referrer, rare depositor | "Reliable data source" | **Value = distribution; nurture as a channel, not GMV** |

### 19. The reputation forecaster
*Metaculus/Manifold type; trigger = a hard question worth their analytical pride.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Encounters a juicy forecasting question | "Can I call this right?" | — |
| Discovery | Seeks platforms that reward accuracy | "Is there a track record here?" | No accuracy system = uninterested |
| Landing | Evaluates question quality first | "Is this well-specified?" | Sloppy questions = won't engage |
| Orientation | Looks for a calibration/record system | "Will being right be remembered?" | P&L-only framing = wrong incentive for them |
| Evaluation | Trades to express a calibrated view | Sizes by confidence, not greed | — |
| Funding/Auth | Funds modestly (money is a means) | Reputation > profit | — |
| First trade | Calibrated position, deliberate | Intellectual engagement | — |
| Monitoring | Tracks accuracy over time | Scorekeeping ego | No accuracy board = no feedback loop |
| Resolution & payout | Resolution = a calibration data point | Pride or learning | Ambiguous resolution corrupts their record = leaves |
| Post & retention | Deeply loyal to accuracy/reputation systems | "This tracks my skill" | **Retained by the Accuracy board, indifferent to cash** |

### 20. The decision-maker polling the crowd
*Facing a personal decision; trigger = "should I worry about X?"*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A personal decision hinges on an uncertainty | "What do smart people think?" | — |
| Discovery | Searches the question | Treats market as a smart poll | — |
| Landing | The relevant market | "What's the number?" | Auth wall to see price = leaves |
| Orientation | Reads implied probability as advice | "Is this signal trustworthy?" | No volume signal = "is this just noise?" |
| Evaluation | Maybe a token stake to "subscribe" | "Skin to stay engaged" | — |
| Funding/Auth | Minimal, if at all | Light commitment | — |
| First trade | Tiny or none | Informational, not financial | — |
| Monitoring | Returns to check the number as date nears | "Has the crowd shifted?" | No watchlist = forgets to come back |
| Resolution & payout | Notes outcome to inform their decision | "Crowd was right/wrong" | — |
| Post & retention | Light recurring informational user | "Useful gut check" | **Converts to trader only if a market personally surprises them** |

### 21. The skeptic stress-tester
*Thinks prediction markets are dumb; trigger = a market they think is obviously wrong.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees a "clearly mispriced" market | "I'll prove this is dumb" | — |
| Discovery | Arrives adversarial, often from a hate-share | Contempt, curiosity | — |
| Landing | The market they think is wrong | "Easy money off idiots" | — |
| Orientation | Scrutinizes everything for a gotcha | Looking to be right about the concept | — |
| Evaluation | Places a deliberate contrarian bet | "Teaching the market a lesson" | — |
| Funding/Auth | Small test deposit | "Just enough to prove a point" | — |
| First trade | Contrarian position, modest | Emotionally invested in the *idea* | — |
| Monitoring | Watches closely, ego on the line | "Am I right about this whole thing?" | — |
| Resolution & payout | Wins → converted; loses → louder skeptic | Pivotal | **Ambiguous settlement to a losing skeptic = anti-evangelist** |
| Post & retention | Won skeptic = best evangelist you get | "OK, I was wrong, this works" | **Bulletproof resolution decides convert vs detractor** |

### 22. The embedded-widget reader
*Never visits the site; trigger = sees Tap Trade odds inside third-party content.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Reads an article/app embedding the odds | "Huh, interesting number" | — |
| Discovery | Passive — never sought you out | Brand impression forming | Unbranded widget = zero brand transfer |
| Landing | Stays in the host content | Not motivated to leave | — |
| Orientation | Absorbs the probability in context | "Tap Trade says 60%" | — |
| Evaluation | No active evaluation (passive) | — | — |
| Funding/Auth | None | — | — |
| First trade | None on this exposure | — | — |
| Monitoring | Sees the widget again over time | Repeated passive exposure | — |
| Resolution & payout | N/A | — | — |
| Post & retention | Eventually clicks on a *personally salient* market | "This one I care about" | **Converts only if widget→exact market is one tap and honors intent** |

---

## D. Entertainment / Social

### 23. The group-chat gambler
*A friend group that bets on everything; trigger = an argument/event in the chat.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | "Let's actually put money on this" in chat | Social, competitive fun | — |
| Discovery | One member looks for somewhere to do it | "Where can we all bet each other?" | — |
| Landing | Lands on the public global book | "Wait, this isn't us-vs-us" | **No private/group market = core need unmet** |
| Orientation | Tries to make the public book work | "How do we just bet each other?" | Public anonymous book ≠ the social need |
| Evaluation | Considers improvising (Venmo, honor system) | "This is clunky" | — |
| Funding/Auth | Stalls — nobody wants to onboard for this | Friction kills momentum | Group onboarding friction = whole chat bails |
| First trade | Rarely happens on-platform | "We'll just do it ourselves" | — |
| Monitoring | N/A | — | — |
| Resolution & payout | Settled off-platform, informally | — | — |
| Post & retention | Whole chat would've onboarded together if served | "If only the app did this" | **Highest-virality unmet need in the entire map** |

### 24. The watch-party live-trader
*Second-screen during a debate/game/awards; trigger = the event is happening now.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Event on TV, phone in hand | "Trade this live with friends" | — |
| Discovery | Opens app as the event starts | Hyped | — |
| Landing | Goes to the event's live market | "What's the price right now?" | Stale price = useless live |
| Orientation | Knows the format; wants speed | Reactive | — |
| Evaluation | Reacts to each moment (gaffe/goal/snub) | Impulsive, emotional | — |
| Funding/Auth | Already funded; resents any re-auth | "Don't interrupt me" | Session expiry mid-event = miss the moment |
| First trade | Rapid in-and-out on live moments | Adrenaline | Slow fills = the moment's gone |
| Monitoring | Glued to live price + the broadcast | Peak engagement | Feed lag = trading blind |
| Resolution & payout | Resolves at event end; quick payout hoped | Comedown | — |
| Post & retention | Returns for every televised marquee event | "Most fun I've had betting" | **Returns iff live speed + shareable in-moment cards** |

### 25. The meme-market participant
*Here for absurd markets, profit secondary; trigger = a ridiculous market goes viral.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A ludicrous market is shared into their feed | "lmao I have to" | — |
| Discovery | Clicks the viral share | Amused | — |
| Landing | The meme market | "This is hilarious" | Sterile/serious UI kills the vibe |
| Orientation | Doesn't need to understand much | Low-stakes fun | — |
| Evaluation | Trades it "for the bit" | Engagement is the point | — |
| Funding/Auth | Tiny deposit | "Joke money" | Big minimum = not worth the bit |
| First trade | Small stake, screenshots it as a joke | The screenshot IS the content | Hard-to-share position = lost virality |
| Monitoring | Barely | Out of mind | — |
| Resolution & payout | Brief LOL on resolution | "Worth it for the meme" | — |
| Post & retention | Returns for the next viral meme market | "This app is fun" | **Retained iff platform surfaces playful/timely markets** |

### 26. The streamer / creator
*Runs markets as audience engagement; trigger = wants the audience to participate live.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Wants live audience participation | "Make them part of the show" | — |
| Discovery | Looks for a market to point the audience to | "Can I spin one up easily?" | Hard to create/point = won't bother |
| Landing | Picks/links a market on-stream | "This is content" | — |
| Orientation | Needs it legible on a stream overlay | Performance mindset | Confusing UI = bad on stream |
| Evaluation | Drives the whole audience at once | "Everyone go now" | — |
| Funding/Auth | Audience floods onboarding simultaneously | (Cohort, not the creator) | **Burst load + onboarding friction = cohort lost** |
| First trade | Audience trades as a cohort live | Communal | Reject under burst = mass bad first impression |
| Monitoring | Uses live price as stream content | "Look at it move!" | Laggy feed = dead content |
| Resolution & payout | Resolves on stream, big moment | Shared payoff | — |
| Post & retention | Creator = huge channel; most audience leaves | "Did any of them stick?" | **The game is cohort retention of creator inflow** |

### 27. The leaderboard climber
*Motivated by rank, not money; trigger = sees they're #14, wants top 10.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Notices their rank on a board | "I can climb that" | No visible board = no trigger |
| Discovery | Already a user; finds Leaderboards | Competitive | — |
| Landing | Their rank + the names above | "What do I need to pass them?" | Opaque metric = can't strategize |
| Orientation | Reverse-engineers the ranking metric | "Optimize for the board" | — |
| Evaluation | Trades to move rank, sometimes vs EV | Rank > profit | — |
| Funding/Auth | Already funded | Sunk-in | — |
| First trade | Rank-optimizing position | Dopamine on rank ticks | — |
| Monitoring | Checks rank obsessively | Compulsive loop | No rank-change notifications = loop breaks |
| Resolution & payout | Resolution = rank movement event | Win/loss measured in rank | — |
| Post & retention | Period reset re-engages them | "New season, new climb" | **Pure retention fuel iff boards are periodic + meaningful** |

### 28. The seasonal ritualist
*Oscars/Super Bowl pool every year; trigger = the annual event arrives.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | The annual event week arrives | "It's that time again" | No reminder = they forget you exist |
| Discovery | Reactivates the same week yearly | Habitual, social | Hard dormant-account recovery = lost |
| Landing | Looks for the familiar seasonal slate | "Where's the Oscars markets?" | Slate not pre-built = disappointed |
| Orientation | Knows the drill from last year | Comfortable | — |
| Evaluation | Bets the fun familiar slate, often w/ friends | Light, ritualistic | — |
| Funding/Auth | Re-funds for the ritual | Once-a-year spender | Re-auth friction at the ritual = drop |
| First trade | A handful of fun seasonal bets | Social tradition | — |
| Monitoring | Casual until event night | Low intensity | — |
| Resolution & payout | Resolves event night, social payoff | Annual fun closed out | — |
| Post & retention | Dormant ~11 months, predictable return | "See you next year" | **100% recall iff you reach them at the exact ritual window** |

### 29. The trash-talk bettor
*Bets to win an argument with a named person; trigger = "wanna bet?" in conversation.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A real argument with a specific person | "Prove them wrong with money" | — |
| Discovery | Looks for a way to bet *that person* | "Not strangers — them" | — |
| Landing | Finds only the public anonymous book | "This doesn't settle our bet" | **No head-to-head = the social need dies** |
| Orientation | Tries to make public book substitute | "How do we bet each other here?" | Doesn't satisfy the duel |
| Evaluation | Considers a shareable callout | "I want a 'prove me wrong' link" | No challenge primitive = improvises off-platform |
| Funding/Auth | Both would onboard for the duel if possible | Motivated by the rivalry | — |
| First trade | Rarely on-platform today | "We'll just bet directly" | — |
| Monitoring | N/A on-platform | — | — |
| Resolution & payout | Settled by argument, not the app | — | — |
| Post & retention | Both users acquirable via one duel link | "If the app did this we'd both join" | **Viral 1:1 acquisition; same roadmap theme as #23** |

---

## E. Identity / Conviction

### 30. The "money where your mouth is" ideologue
*Strong conviction to signal; trigger = a public claim they want to back.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A public debate they want to back with cash | "Put up or shut up" | — |
| Discovery | Seeks the market on their cause | Ideologically charged | Thin cause coverage = no outlet |
| Landing | The cause/political market | "Time to make a statement" | — |
| Orientation | Doesn't care about EV, cares about signal | Identity-driven | — |
| Evaluation | Sizes by conviction/identity, not Kelly | Defiant | — |
| Funding/Auth | Funds to make the statement land | Committed | — |
| First trade | Conviction position, wants it visible | "This says who I am" | No shareable/public position = signal lost |
| Monitoring | Holds defiantly through price swings | "I'm not wrong" | — |
| Resolution & payout | Win = vindication content; loss = quiet | Pride or silence | — |
| Post & retention | Returns whenever their cause has a market | Identity-loyal, price-insensitive | **Retained by cause coverage + shareable conviction** |

### 31. The superfan loyalist
*Always bets YES on their team/artist; trigger = any market about their fandom.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A market involving their object of fandom | "I always back them" | — |
| Discovery | Searches their team/artist/company | Fan-first | No deep entity coverage = nothing to back |
| Landing | The fandom market | "Of course YES" | — |
| Orientation | Ignores price/analysis entirely | Loyalty over logic | — |
| Evaluation | Always the loyal side | Emotional default | — |
| Funding/Auth | Funds as a fandom expense | "Worth it for them" | — |
| First trade | Loyal-side position regardless of odds | Devotion | — |
| Monitoring | Emotionally, as a fan | Invested as a supporter | — |
| Resolution & payout | Usually small losses, occasional euphoria | "Worth it either way" | — |
| Post & retention | Returns for every fandom market | Fandom retains, not returns | **Durable, EV-negative but retention-positive; tolerate it** |

### 32. The contrarian
*Enjoys betting against the crowd; trigger = a lopsided consensus price.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Sees a 95/5 consensus that offends them | "The crowd is sheep" | — |
| Discovery | Hunts the most lopsided markets | "Where's consensus wrong?" | No way to see crowd % = can't find targets |
| Landing | A heavily one-sided market | "Everyone's on one side" | Consensus not shown = no contrarian hook |
| Orientation | Needs to *see* the consensus to oppose it | "I'll take the lonely side" | — |
| Evaluation | Takes the unpopular side for identity | Enjoys being alone | — |
| Funding/Auth | Funded | Self-styled maverick | — |
| First trade | Contrarian position | "Vindication incoming" | — |
| Monitoring | Watches, enjoying the lonely stance | Identity reinforcement | — |
| Resolution & payout | Vindication when right (the whole point) | "Told you so" | — |
| Post & retention | Returns for the next lopsided market | Needs visible consensus to oppose | **Retained iff crowd-sentiment is surfaced** |

### 33. The reputation-staker
*Public figure signaling confidence; trigger = made a public prediction, challenged to back it.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Publicly challenged on a prediction | "I'll back it to prove I mean it" | — |
| Discovery | Needs a credible venue worth attaching their name | Reputation-protective | Low-credibility platform = won't risk name |
| Landing | The market on their claim | "Is this verifiable?" | — |
| Orientation | Cares the position is provable/public | "Screenshot-proof?" | No tamper-evident proof = pointless for them |
| Evaluation | Sizes for visibility, not return | The act is the message | — |
| Funding/Auth | Funds enough to be credible | Calculated | — |
| First trade | Deliberately public, amplified off-platform | "Watch me back this" | — |
| Monitoring | Holds as a credibility instrument | Eyes on the audience | — |
| Resolution & payout | Win = "told you so"; loss = public reckoning | High-stakes ego | — |
| Post & retention | Episodic, high-visibility; each is free marketing | "Good arena for my brand" | **Returns iff positions are credible, public, tamper-evident** |

---

## F. Onboarding Edges / Accidental

### 34. The referral arrival
*Came via a friend's invite + bonus; trigger = friend's recommendation + incentive.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Friend sends an invite link + "free $X" | "Free money + my friend uses it" | — |
| Discovery | Clicks the invite | Trusting (social proof) | — |
| Landing | Referral landing, expects the bonus front-and-center | "Where's my bonus?" | Bonus not obvious = feels bait-and-switch |
| Orientation | Friend's recommendation lowers the bar | "If they use it, fine" | — |
| Evaluation | Looks for the easiest first trade | "What do I even bet on?" | No guided first trade = paralysis |
| Funding/Auth | Onboards (bonus offsets KYC pain) | Tolerant because of the bonus | Excess KYC still drops some |
| First trade | Often the bonus, on the friend's suggested market | Low risk (house money) | — |
| Monitoring | Casual | Tied to the friend's enthusiasm | — |
| Resolution & payout | Wins/loses house money | Low stakes emotionally | — |
| Post & retention | **Second (own-money) trade is the real conversion** | "Do I do this again with my cash?" | **Retained iff a deliberate post-bonus first-real-trade nudge lands** |

### 35. The incentive farmer
*Here only for the bonus/token; trigger = a rumored or explicit reward.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Hears about a reward | "Extract and leave" | — |
| Discovery | Comes for the incentive only | Purely transactional | — |
| Landing | Goes straight to qualifying actions | "What's the minimum to qualify?" | — |
| Orientation | Reads only the reward terms | Gaming mindset | — |
| Evaluation | Finds the cheapest path to clear conditions | "Least effort possible" | — |
| Funding/Auth | Minimum required deposit | Reluctant | — |
| First trade | Smallest/safest qualifying trade | Zero product interest | Anti-gaming rules force *some* real engagement |
| Monitoring | Only tracks reward-vesting progress | "Am I qualified yet?" | — |
| Resolution & payout | Extracts the reward the moment it vests | "Done here" | — |
| Post & retention | ~95% churn by design | "On to the next airdrop" | **Win = the 1-in-20 who accidentally find value; design for that** |

### 36. The "saw it on X" impulse visitor
*Clicked a screenshotted market mid-scroll; trigger = one compelling market in-feed.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A striking market screenshot in their feed | "Wait, that's a thing?" | — |
| Discovery | Taps the link mid-scroll | Curious, low-commitment | — |
| Landing | Deep on that market, no homepage context | 8-second "interesting + legit?" verdict | **Slow load or confusing page = instant bounce** |
| Orientation | Must self-explain from this one page | "What am I looking at?" | No self-contained context = gone |
| Evaluation | Snap judgment on that single market | "Worth a few bucks?" | — |
| Funding/Auth | Hates being asked to sign up to act | "Just let me try" | **Hard auth/KYC wall before trying = abandon** |
| First trade | Maybe one impulsive small trade on *that* market | Spur-of-the-moment | — |
| Monitoring | Rarely explores beyond visit one | Came for one thing | No reason to look around = single-serving |
| Resolution & payout | May not even remember to return | Low attachment | — |
| Post & retention | The deep-link landing *was* the whole funnel | "Neat, anyway…" | **Converts iff first 8s + guest→trade path are flawless** |

### 37. The app-store browser
*Found it browsing finance apps, no intent; trigger = app-store discovery.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Browsing app store, vague curiosity | "What's this category?" | — |
| Discovery | Installs on a whim | No target in mind | — |
| Landing | Opens to /predict with zero intent | "OK, what is this?" | Weak discovery surface = one-and-done open |
| Orientation | Needs the app to manufacture intent fast | "Why would I use this?" | No magnetic default = never opens again |
| Evaluation | Browses for *anything* that grabs them | "Is anything here interesting?" | Stale/irrelevant feed = no spark |
| Funding/Auth | Only if a market hooked them first | Skeptical | Premature funding ask = uninstall |
| First trade | Only if intent got manufactured | "Maybe I'll try this one" | — |
| Monitoring | Sporadic if at all | Weak attachment | — |
| Resolution & payout | Often never gets this far | — | — |
| Post & retention | Discovery-surface quality is the entire funnel | "Eh, deleting" | **Retained only if a cold, intentless open finds a spark in 30s** |

### 38. The confused first-timer
*Doesn't get shares/cents/"YES at 65¢"; trigger = heard about it, curious, not numerate in mechanics.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Curious after hearing about prediction markets | "I want to try this" | — |
| Discovery | Arrives willing to participate | Open, a bit intimidated | — |
| Landing | Reaches a market and the trade ticket | "OK how do I do this" | — |
| Orientation | Can't map "$25 → 38 shares → $38 payout" | "Wait, what am I buying?" | **The comprehension wall — the biggest silent leak** |
| Evaluation | Hovers, hesitates, fears looking dumb | Embarrassed, uncertain | No plain-language framing = quiet abandon |
| Funding/Auth | May fund then freeze at the ticket | "Did I just lose money?" | Confusing ticket post-funding = worst churn |
| First trade | Often never completes it | "I don't get it, forget it" | — |
| Monitoring | N/A (never traded) | — | — |
| Resolution & payout | N/A | — | — |
| Post & retention | Leaves silently, never tells you why | "Not for me I guess" | **Recovered only by plain-language ticket + first-trade walkthrough** |

### 39. The KYC / funding bouncer
*Wants in, hits identity/deposit friction; trigger = ready to fund, then asked for KYC.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Found a market they want to trade | "I'm in, let's go" | — |
| Discovery | Engaged, motivated | Eager | — |
| Landing | Picked the market, ready to act | High intent | — |
| Orientation | Understood enough to commit | Decided | — |
| Evaluation | Already chose their position | "Just let me fund" | — |
| Funding/Auth | Hit with KYC + deposit steps at peak intent | "All this just to bet $20?" | **The most expensive churn: converted, then lost at the last step** |
| First trade | Never reached — abandoned at the form | Frustrated, intent wasted | — |
| Monitoring | N/A | — | — |
| Resolution & payout | N/A | — | — |
| Post & retention | Rarely comes back; the moment is gone | "Too much hassle" | **Saved only by progressive/just-in-time KYC + fast funding paths** |

### 40. The mobile-only casual
*Entire relationship is a phone in spare moments; trigger = boredom (queue/commute/couch).*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Bored, phone out, 90 seconds to kill | "Something to do" | — |
| Discovery | Opens the app reflexively | Idle | — |
| Landing | Thumb-scrolls /predict one-handed | "Anything quick?" | Desktop-shaped layout = clumsy, closes |
| Orientation | Needs instant legibility on a small screen | Low patience | Tiny targets/cramped UI = gives up |
| Evaluation | Skims for a fast, fun, tiny bet | "Quick one before my stop" | — |
| Funding/Auth | Hates any multi-step on mobile | "Not now" | Re-auth on mobile = backs out |
| First trade | Maybe one tiny one-handed trade | Casual flick | Multi-tap ticket = abandons mid-trade |
| Monitoring | Backgrounds the app, peeks later | Ephemeral | — |
| Resolution & payout | Notices payout in a later idle moment | Mild satisfaction | — |
| Post & retention | Returns sporadically when bored | "Decent time-killer" | **Retained only if full loop is one-handed, sub-minute (mobile nav gap = real blocker)** |

---

## G. Professional / Power Users

### 41. The quant / algo trader
*API-only, never sees the UI; trigger = a modeled edge worth automating.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Backtest shows an exploitable edge | "Automate this" | — |
| Discovery | Evaluates the API + docs first | "Is the API real?" | No/poor API = never starts |
| Landing | Reads API reference, not the site | "Endpoints, limits, latency" | Thin docs = walks |
| Orientation | Maps endpoints to their strategy | Engineering mindset | No historical data endpoint = can't backtest |
| Evaluation | Backtests against historical data | "Does the edge survive costs?" | — |
| Funding/Auth | Programmatic auth/keys | Wants stable keys | Flaky auth = bot dies silently |
| First trade | Bot places first live orders, small | Cautious scale-up | Rate limits/rejects = bot disabled |
| Monitoring | Monitors latency, uptime, fills | SLO-driven | Downtime = pulled immediately |
| Resolution & payout | Programmatic P&L reconciliation | Mechanical | Reconciliation mismatch = trust gone |
| Post & retention | Scales size as confidence grows | "Reliable infra = more capital" | **High-volume + sticky iff API robust; silent exit if flaky** |

### 42. The whale
*Large positions; depth/slippage are everything; trigger = high conviction sized to real money.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | High-conviction view worth real size | "Big position here" | — |
| Discovery | Returning; goes straight to the market | — | — |
| Landing | Checks book depth before anything | "Can this absorb my size?" | Thin book = won't even start |
| Orientation | Assesses slippage and limits | Risk-of-ruin aware | Low limits = can't express the view |
| Evaluation | Models market impact of their order | "How do I get in without moving it?" | No large-order tooling = clumsy |
| Funding/Auth | Funds large; expects high limits | Expects white-glove | — |
| First trade | Works the order over time to limit impact | Careful, deliberate | Bad slippage on entry = soured immediately |
| Monitoring | Watches depth + their exposure closely | Vigilant | — |
| Resolution & payout | Large settlement; large withdrawal next | "Can I get this out cleanly?" | — |
| Post & retention | Disproportionate GMV; one bad event loses them | "Did big money move smoothly?" | **Lost over a single slippage or stuck large withdrawal** |

### 43. The portfolio manager
*Treats positions as a managed book; trigger = a diversified multi-event thesis.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | A thesis spanning many correlated events | "Run this like a book" | — |
| Discovery | Returning power user | — | — |
| Landing | Wants a portfolio view, not one market | "Show me my whole book" | One-market-at-a-time UX = friction |
| Orientation | Thinks in exposure/correlation | Fund-manager mindset | No aggregate view = manual spreadsheeting |
| Evaluation | Builds a diversified position set | Allocative | — |
| Funding/Auth | Funds a managed-size balance | Professional | — |
| First trade | Many positions as one allocation | Systematic | — |
| Monitoring | Returns daily to rebalance the book | "Net exposure? P&L? Drift?" | No exposure view = can't manage |
| Resolution & payout | Positions resolve over time, rebalances | Continuous management | — |
| Post & retention | Durable, high-value iff portfolio tooling exists | "This lets me run a book" | **Frustrated to churn by a flat positions list** |

### 44. The tax-aware closer
*Manages realized P&L near year-end; trigger = Q4/fiscal year-end.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Tax year-end approaching | "Manage my realized P&L" | — |
| Discovery | Returning; goes to portfolio/history | — | — |
| Landing | Reviews realized vs unrealized | "What's my taxable position?" | No realized/unrealized split = can't plan |
| Orientation | Plans which positions to close | Tax-strategic | — |
| Evaluation | Decides closes for tax-year management | Deliberate | — |
| Funding/Auth | Already funded | — | — |
| First trade | Closes selected positions intentionally | Mechanical, planned | — |
| Monitoring | Tracks the year's realized total | Precise | — |
| Resolution & payout | Needs exportable records | "Can I give this to my accountant?" | **No export = compliance pain, trust risk** |
| Post & retention | Returns predictably each tax season | "Reliable records" | **Retained unless accounting is wrong (then existential)** |

---

## H. Lifecycle / Retention

### 45. The one-event tourist
*Came for one huge event, no broader interest; trigger = the election/final/one viral market.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | One massive event they care about | "I want in on THIS" | — |
| Discovery | Comes specifically for that event | Single-purpose | — |
| Landing | The one event's market | "Just this one thing" | — |
| Orientation | Learns just enough for this event | Narrow focus | — |
| Evaluation | Trades that event intensely | Engaged for now | — |
| Funding/Auth | Funds for the one event | One-time intent | — |
| First trade | Possibly several, all on the one event | Invested briefly | — |
| Monitoring | Watches through to that resolution | Tied to the event | — |
| Resolution & payout | Resolves, gets paid (or not) | "Done, that's what I came for" | **The pivotal moment: no built-in reason to stay** |
| Post & retention | Goes dormant; LTV hinges on a *second* reason | "What else is here?" (if asked) | **Won/lost in the post-resolution hand-off + dormant win-back** |

### 46. The lapsed returner
*Dormant months, pulled back by a big event + outreach; trigger = major event + re-engagement message.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Big event + a well-timed email/push | "Oh right, that app" | Bad targeting = ignored |
| Discovery | Clicks the re-engagement message | Mild interest | — |
| Landing | Returns to a possibly-changed product | "Where's my stuff?" | Changed UX with no orientation = confusion |
| Orientation | Re-learns what changed | "Is my money still here?" | Balance not obvious = panic/distrust |
| Evaluation | Decides if it's worth re-engaging | "Worth my time again?" | — |
| Funding/Auth | Often needs to re-auth | "What was my login?" | **Painful re-auth = abandons at the doorstep** |
| First trade | Re-engages on the triggering event | Cautious re-entry | — |
| Monitoring | Through the event that brought them back | Renewed interest | — |
| Resolution & payout | Resolves; reminded why they liked it | "That was fun again" | — |
| Post & retention | Re-retained iff re-entry was frictionless | "Maybe I'll stick around" | **Win-back works only with durable accounts + obvious balance + painless re-auth** |

### 47. The churned-by-loss quitter
*Lost their first stake, rage-quit; trigger = first trade lost, especially if it felt unfair/abrupt.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Decides to try it | Hopeful | — |
| Discovery | Arrives optimistic | Excited | — |
| Landing | Finds a market they like | Confident | — |
| Orientation | Learns just enough to bet | Eager | Over-confidence not tempered = set up to fall |
| Evaluation | Picks a position, often all-in on first try | "I've got this" | No small-default first stake = full exposure |
| Funding/Auth | Funds, deposits the whole intended amount | Committed | — |
| First trade | Stakes it all on one bet | High hopes | — |
| Monitoring | Watches anxiously | Emotionally exposed | — |
| Resolution & payout | First trade loses | Shock, feels cheated | **Attributes variance to the platform, not chance** |
| Post & retention | Rage-quits, may post negatively | "This thing is rigged" | **Salvaged only by pre-loss framing + graceful post-loss reframe + first-trade protection** |

### 48. The slow-burn habituator
*Tiny bets that grow into a daily habit; trigger = mild ongoing curiosity, low commitment.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Mild recurring curiosity | "I'll just poke at it" | — |
| Discovery | Wanders in low-stakes | No pressure | — |
| Landing | Browses without urgency | "Just looking" | Aggressive upsell = scares them off early |
| Orientation | Learns gradually over many visits | Patient self-teaching | — |
| Evaluation | Starts with near-zero stakes | "Tiny, no risk" | High minimums = can't ease in |
| Funding/Auth | Funds a trivial amount first | Testing the waters | Big funding ask too early = bails |
| First trade | Micro-stake, low expectation | "Let's see" | — |
| Monitoring | Returns intermittently, trust building | Slowly warming | No daily reason to return = habit never forms |
| Resolution & payout | Small wins/losses, both fine | Calibrated, comfortable | — |
| Post & retention | Stakes+frequency creep up over weeks | "This is part of my routine now" | **Best LTV in the map — protected only by patience, no premature monetization** |

### 49. The withdrawal-tester
*Verifies they can get money out early; trigger = a small early win, or just prudence.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Early win or innate caution | "Can I actually get paid?" | — |
| Discovery | Already a user | — | — |
| Landing | Goes to withdrawal deliberately | "Test before I trust" | — |
| Orientation | Looks for fees, timing, steps | Risk-checking | Opaque withdrawal terms = suspicion |
| Evaluation | Decides to withdraw a small test amount | "Prove it" | — |
| Funding/Auth | Already funded | — | — |
| First trade | Already traded (small win) | — | — |
| Monitoring | Watches the withdrawal closely | Scrutinizing speed/fees | — |
| Resolution & payout | **The test: does the money arrive clean+fast?** | Trust on the line | **Slow/opaque/fee-surprised = silently extracts all, leaves** |
| Post & retention | Clean withdrawal unlocks scaling up | "OK, I can trust this with more" | **The single highest-leverage trust gate in the lifecycle** |

### 50. The settlement disputer
*Believes a market resolved wrongly; trigger = a resolution contradicting their reading of criteria.*

| Stage | Does | Thinking / feeling | Friction → fork |
|---|---|---|---|
| Trigger | Held to resolution, expected to win | Confident | — |
| Discovery | Already deeply engaged | Invested | — |
| Landing | Sees the opposite of the expected result | "That's wrong" | — |
| Orientation | Goes straight to criteria + source | "Let me check the rules" | Vague criteria = instant "scam" conclusion |
| Evaluation | Compares result against stated criteria | Feels cheated | No cited source = no way to be convinced |
| Funding/Auth | N/A (already in) | — | — |
| First trade | N/A (post-trade crisis) | — | — |
| Monitoring | Re-reads everything, builds a case | Aggrieved | No audit trail = nothing to point to |
| Resolution & payout | Disputes the payout, contacts support, posts publicly | Trust crisis, public | **No appeal path = permanent anti-evangelist** |
| Post & retention | Binary: transparent+appealable *strengthens* trust; opaque poisons acquisition | "Are these people honest?" | **Settlement integrity is existential — pre-stated criteria + cited source + audit trail + real dispute path** |

---

## Cross-cutting takeaways for Tap Trade

1. **~6 of 50 are the rational trader the product is built for** (1, 5, 7, 8, 41, 42). The other 44 run on anxiety, identity, social pressure, boredom, curiosity, or habit. Over-index the roadmap on the 44.
2. **Highest-virality unmet need = private/group + head-to-head markets** (23, 26, 29). Entirely unserved by a public-only book. The single biggest roadmap lever in this map.
3. **Biggest invisible funnel leak = comprehension** (38). The ¢/shares/payout model is a wall; confused users churn silently and never tell you. Plain-language ticket = likely highest-ROI fix.
4. **Settlement integrity is existential, not a feature** (21, 50). One ambiguous resolution manufactures permanent anti-evangelists who poison acquisition.
5. **First withdrawal is the master trust gate** (7, 42, 49). It silently caps how much every serious user will ever deposit.
6. **Most new users are one-event tourists** (45). LTV is won in the post-resolution hand-off + calendar-aware win-back (6, 13, 15, 28, 46), not session one.
7. **Leaderboards are a retention engine, not a vanity screen** (11, 19, 27). The leaderboard work already in the codebase is strategically central.
