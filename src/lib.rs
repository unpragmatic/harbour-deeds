use serde::{Deserialize, Serialize};
use std::cell::RefCell;

#[derive(Deserialize)]
struct Rules {
    #[serde(default)]
    dice: Dice,
    #[serde(default)]
    cards: Vec<Card>,
    development: Development,
    cash: i32,
    salary: i32,
    auction_increment: i32,
    rounds: usize,
    tiles: Vec<Tile>,
    notices: Vec<i32>,
}
#[derive(Deserialize)]
struct Dice {
    count: usize,
    sides: usize,
}
impl Default for Dice {
    fn default() -> Self {
        Self { count: 2, sides: 6 }
    }
}
#[derive(Deserialize)]
struct Card {
    title: String,
    kind: CardKind,
    amount: i32,
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum CardKind {
    Cash,
    Deeds,
    Levels,
    Cover,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Policy {
    Even,
    Free,
    District,
}
#[derive(Deserialize)]
struct Development {
    policy: Policy,
    set_rent_pct: i32,
    levels: Vec<Level>,
}
#[derive(Deserialize)]
struct Level {
    cost_pct: i32,
    rent_pct: i32,
}
#[derive(Serialize)]
struct Quote {
    tile: usize,
    cost: i32,
    tiles: Vec<usize>,
    gain: i32,
}
fn percent(n: i32, pct: i32) -> i64 {
    (i64::from(n) * i64::from(pct) + 50) / 100
}
#[derive(Deserialize)]
struct Tile {
    #[serde(default)]
    cash_offer: i32,
    #[serde(default)]
    cover_offer: i32,
    kind: Kind,
    #[serde(default)]
    price: i32,
    #[serde(default)]
    rent: i32,
    #[serde(default)]
    group: String,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Guild,
    Exchange,
    Start,
    Deed,
    Fee,
    Notice,
    Rest,
}
#[derive(Serialize, Default)]
struct Player {
    cover: i32,
    cash: i32,
    pos: usize,
    out: bool,
}
#[derive(Serialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Guild,
    Roll,
    Offer,
    Auction,
    Trade,
    End,
    Over,
}
#[derive(Serialize)]
struct Auction {
    actor: usize,
    high_bid: i32,
    leader: Option<usize>,
    tile: usize,
    #[serde(skip)]
    bidders: Vec<bool>,
}
#[derive(Deserialize, Serialize)]
struct Trade {
    #[serde(rename(deserialize = "actor"))]
    from: usize,
    to: usize,
    give_deed: Option<usize>,
    take_deed: Option<usize>,
    give_cash: i32,
    take_cash: i32,
}
#[derive(Serialize)]
struct Game {
    levels: Vec<usize>,
    rents: Vec<i32>,
    builds: Vec<Quote>,
    #[serde(skip)]
    rules: Rules,
    #[serde(skip)]
    seed: u32,
    players: Vec<Player>,
    owners: Vec<Option<usize>>,
    turn: usize,
    round: usize,
    dice: Vec<usize>,
    #[serde(skip)]
    deck: Vec<usize>,
    last_card: Option<usize>,
    phase: Phase,
    auction: Option<Auction>,
    trade: Option<Trade>,
    traded: bool,
    events: Vec<String>,
    winners: Vec<usize>,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum Command {
    Grant {
        actor: usize,
    },
    Insure {
        actor: usize,
    },
    Build {
        actor: usize,
        tile: usize,
    },
    Start {
        rules: Rules,
        seats: usize,
        seed: u32,
    },
    Roll {
        actor: usize,
    },
    Buy {
        actor: usize,
    },
    Pass {
        actor: usize,
    },
    Bid {
        actor: usize,
        amount: i32,
    },
    Withdraw {
        actor: usize,
    },
    Propose(Trade),
    Accept {
        actor: usize,
    },
    Reject {
        actor: usize,
    },
    End {
        actor: usize,
    },
}

impl Game {
    fn new(rules: Rules, seats: usize, seed: u32) -> Result<Self, &'static str> {
        if !(2..=4).contains(&seats)
            || rules.tiles.len() < 4
            || rules.rounds == 0
            || (rules.notices.is_empty() && rules.cards.is_empty())
            || !(1..=8).contains(&rules.dice.count)
            || !(2..=32).contains(&rules.dice.sides)
            || rules.cards.iter().any(|c| {
                c.title.is_empty()
                    || c.amount.unsigned_abs() > 10000
                    || matches!(c.kind, CardKind::Cover) && c.amount <= 0
            })
            || rules
                .tiles
                .iter()
                .any(|t| t.kind == Kind::Guild && (t.cash_offer <= 0 || t.cover_offer <= 0))
            || rules.cash <= 0
            || rules.salary < 0
            || rules.auction_increment <= 0
            || rules.tiles.iter().any(|t| t.price < 0 || t.rent < 0)
        {
            return Err("Invalid game configuration");
        }
        let d = &rules.development;
        if d.set_rent_pct < 100
            || d.levels.iter().enumerate().any(|(i, l)| {
                l.cost_pct <= 0
                    || l.rent_pct
                        <= if i == 0 {
                            d.set_rent_pct
                        } else {
                            d.levels[i - 1].rent_pct
                        }
            })
        {
            return Err("Invalid improvement curve");
        }
        let mut max_cost = 0i64;
        for t in rules.tiles.iter().filter(|t| t.kind == Kind::Deed) {
            let mut largest = 0;
            for l in &d.levels {
                let c = percent(t.price, l.cost_pct);
                if c == 0 || percent(t.rent, l.rent_pct) > i32::MAX as i64 {
                    return Err("Invalid deed development values");
                }
                largest = largest.max(c);
            }
            if percent(t.rent, d.set_rent_pct) > i32::MAX as i64 {
                return Err("Invalid set rent");
            }
            max_cost += largest;
            if max_cost > i32::MAX as i64 {
                return Err("Improvement costs too large");
            }
        }
        let mut game = Self {
            levels: vec![0; rules.tiles.len()],
            rents: vec![],
            builds: vec![],
            players: (0..seats)
                .map(|_| Player {
                    cash: rules.cash,
                    ..Default::default()
                })
                .collect(),
            owners: vec![None; rules.tiles.len()],
            dice: vec![0; rules.dice.count],
            deck: vec![],
            last_card: None,
            rules,
            seed: seed.max(1),
            turn: 0,
            round: 1,
            phase: Phase::Roll,
            auction: None,
            trade: None,
            traded: false,
            events: vec!["The table is open. All players begin at Port Office.".into()],
            winners: vec![],
        };
        game.refresh();
        Ok(game)
    }
    fn district(&self, i: usize) -> Vec<usize> {
        self.rules
            .tiles
            .iter()
            .enumerate()
            .filter(|(_, t)| t.kind == Kind::Deed && t.group == self.rules.tiles[i].group)
            .map(|(k, _)| k)
            .collect()
    }
    fn developed(&self, i: usize) -> bool {
        self.district(i).iter().any(|&k| self.levels[k] > 0)
    }
    fn refresh(&mut self) {
        let d = &self.rules.development;
        self.builds.clear();
        self.rents = vec![0; self.owners.len()];
        for (i, t) in self
            .rules
            .tiles
            .iter()
            .enumerate()
            .filter(|(_, t)| t.kind == Kind::Deed)
        {
            self.rents[i] = t.rent;
            let Some(owner) = self.owners[i] else {
                continue;
            };
            let group = self.district(i);
            if !group.iter().all(|&k| self.owners[k] == Some(owner)) {
                continue;
            }
            let lv = self.levels[i];
            self.rents[i] = percent(
                t.rent,
                if lv == 0 {
                    d.set_rent_pct
                } else {
                    d.levels[lv - 1].rent_pct
                },
            ) as i32;
            if owner != self.turn || self.phase != Phase::Roll || lv >= d.levels.len() {
                continue;
            }
            let tiles = match d.policy {
                Policy::District if i == group[0] => group,
                Policy::District => continue,
                Policy::Even if group.iter().any(|&k| self.levels[k] < lv) => continue,
                _ => vec![i],
            };
            let mut cost = 0;
            let mut gain = 0i64;
            for &k in &tiles {
                let x = &self.rules.tiles[k];
                cost += percent(x.price, d.levels[lv].cost_pct) as i32;
                let prior = if lv == 0 {
                    d.set_rent_pct
                } else {
                    d.levels[lv - 1].rent_pct
                };
                gain += percent(x.rent, d.levels[lv].rent_pct) - percent(x.rent, prior);
            }
            self.builds.push(Quote {
                tile: i,
                cost,
                tiles,
                gain: gain.min(i32::MAX as i64) as i32,
            });
        }
    }
    fn random(&mut self, n: usize) -> usize {
        let mut x = self.seed;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.seed = x;
        x as usize % n
    }
    fn charge(&mut self, amount: i32, to: Option<usize>) {
        let a = self.turn;
        let paid = amount.min(self.players[a].cash);
        self.players[a].cash -= paid;
        if let Some(b) = to {
            self.players[b].cash += paid
        }
        if paid < amount {
            self.players[a].out = true;
            for (i, o) in self.owners.iter_mut().enumerate() {
                if *o == Some(a) {
                    self.levels[i] = 0;
                    *o = None
                }
            }
            self.events.push(format!(
                "Seat {} is bankrupt. Their deeds return to market.",
                a + 1
            ));
            if self.players.iter().filter(|p| !p.out).count() == 1 {
                self.finish()
            }
        }
    }
    fn finish(&mut self) {
        self.phase = Phase::Over;
        let scores: Vec<_> = self
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| !p.out)
            .map(|(i, p)| {
                (
                    i,
                    p.cash
                        + self
                            .owners
                            .iter()
                            .enumerate()
                            .filter(|(_, o)| **o == Some(i))
                            .map(|(n, _)| self.rules.tiles[n].price)
                            .sum::<i32>(),
                )
            })
            .collect();
        let top = scores.iter().map(|(_, v)| *v).max();
        self.winners = scores
            .into_iter()
            .filter(|(_, v)| Some(*v) == top)
            .map(|(i, _)| i)
            .collect();
        self.events.push("Final accounts are settled.".into());
    }
    fn auction_action(&mut self, actor: usize, bid: Option<i32>) -> Result<(), &'static str> {
        let auction = self.auction.as_mut().ok_or("No auction in progress")?;
        if actor != auction.actor {
            return Err("Not the current bidder");
        }
        if let Some(amount) = bid {
            if amount > self.players[actor].cash
                || auction
                    .high_bid
                    .checked_add(self.rules.auction_increment)
                    .is_none_or(|minimum| amount < minimum)
            {
                return Err("Bid is below the minimum or exceeds available cash");
            }
            auction.high_bid = amount;
            auction.leader = Some(actor);
        } else {
            auction.bidders[actor] = false;
        }
        let seats = self.players.len();
        if let Some(next) = (1..=seats)
            .map(|d| (actor + d) % seats)
            .find(|&n| auction.bidders[n] && Some(n) != auction.leader)
        {
            auction.actor = next;
        } else {
            if let Some(winner) = auction.leader {
                self.players[winner].cash -= auction.high_bid;
                self.owners[auction.tile] = Some(winner);
                self.events.push(format!(
                    "Seat {} won deed {:02} for ${}.",
                    winner + 1,
                    auction.tile,
                    auction.high_bid
                ));
            } else {
                self.events.push("The auction closed without a bid.".into());
            }
            self.auction = None;
            self.phase = Phase::End;
        }
        Ok(())
    }

    fn validate_trade(&self, t: &Trade) -> Result<(), &'static str> {
        if t.from != self.turn || t.to == t.from || self.players.get(t.to).is_none_or(|p| p.out) {
            return Err("Invalid trade seats");
        }
        if t.give_cash < 0
            || t.take_cash < 0
            || (t.give_cash > 0 && t.take_cash > 0)
            || (t.give_deed.is_none() && t.take_deed.is_none())
            || (t.give_deed.is_none() && t.give_cash == 0)
            || (t.take_deed.is_none() && t.take_cash == 0)
        {
            return Err("Invalid trade terms");
        }
        for (seat, deed, pay, receive) in [
            (t.from, t.give_deed, t.give_cash, t.take_cash),
            (t.to, t.take_deed, t.take_cash, t.give_cash),
        ] {
            let cash = self.players[seat].cash;
            if deed.is_some_and(|i| self.owners.get(i) != Some(&Some(seat)) || self.developed(i))
                || cash < pay
                || (cash - pay).checked_add(receive).is_none()
            {
                return Err("Trade exceeds available deeds or cash");
            }
        }
        Ok(())
    }

    fn apply(&mut self, cmd: Command) -> Result<(), &'static str> {
        let a = self.turn;
        let i = self.players[a].pos;
        match cmd {
            Command::Build { actor, tile } if actor == a && self.phase == Phase::Roll => {
                let q = self
                    .builds
                    .iter()
                    .find(|q| q.tile == tile)
                    .ok_or("This improvement is not available")?;
                if self.players[a].cash < q.cost {
                    return Err("Not enough cash to improve");
                }
                self.players[a].cash -= q.cost;
                for &k in &q.tiles {
                    self.levels[k] += 1
                }
                self.events.push(format!(
                    "Seat {} improved {} to level {} for ${}.",
                    a + 1,
                    self.rules.tiles[tile].group,
                    self.levels[tile],
                    q.cost
                ));
            }
            Command::Grant { actor } | Command::Insure { actor }
                if actor == a && self.phase == Phase::Guild =>
            {
                let t = &self.rules.tiles[i];
                let p = &mut self.players[a];
                if matches!(cmd, Command::Grant { .. }) {
                    p.cash += t.cash_offer;
                    self.events.push(format!(
                        "Seat {} took a ${} guild grant.",
                        a + 1,
                        t.cash_offer
                    ))
                } else {
                    p.cover = p.cover.max(t.cover_offer);
                    self.events.push(format!(
                        "Seat {} holds ${} next-rent cover.",
                        a + 1,
                        p.cover
                    ))
                }
                self.phase = Phase::End;
            }
            Command::Roll { actor } if actor == a && self.phase == Phase::Roll => {
                self.last_card = None;
                self.dice = (0..self.rules.dice.count)
                    .map(|_| 1 + self.random(self.rules.dice.sides))
                    .collect();
                let path = i + self.dice.iter().sum::<usize>();
                let n = self.rules.tiles.len();
                let j = path % n;
                self.players[a].pos = j;
                self.phase = Phase::End;
                self.events.push(format!(
                    "Seat {} rolled {}.",
                    a + 1,
                    self.dice
                        .iter()
                        .map(usize::to_string)
                        .collect::<Vec<_>>()
                        .join(" + ")
                ));
                if path >= n {
                    self.players[a].cash += self.rules.salary * (path / n) as i32;
                    self.events.push(format!(
                        "Port salary: +${}.",
                        self.rules.salary * (path / n) as i32
                    ))
                }
                let tile = &self.rules.tiles[j];
                match tile.kind {
                    Kind::Deed => match self.owners[j] {
                        None => self.phase = Phase::Offer,
                        Some(b) if b != a => {
                            let rent = self.rents[j];
                            self.events
                                .push(format!("Rent due to seat {}: ${rent}.", b + 1));
                            let covered = rent.min(self.players[a].cover);
                            if covered > 0 {
                                self.players[a].cover = 0;
                                self.players[b].cash += covered;
                                self.events
                                    .push(format!("Guild paid ${covered} of the rent."))
                            }
                            self.charge(rent - covered, Some(b));
                        }
                        _ => {}
                    },
                    Kind::Fee => {
                        let fee = tile.price;
                        self.events.push(format!("Harbor dues: ${fee}."));
                        self.charge(fee, None)
                    }
                    Kind::Guild => self.phase = Phase::Guild,
                    Kind::Exchange => {
                        if let Some(tile) = (1..n).map(|k| (j + k) % n).find(|&k| {
                            self.rules.tiles[k].kind == Kind::Deed && self.owners[k].is_none()
                        }) {
                            self.auction = Some(Auction {
                                actor: a,
                                tile,
                                high_bid: 0,
                                leader: None,
                                bidders: self.players.iter().map(|p| !p.out).collect(),
                            });
                            self.phase = Phase::Auction;
                            self.events.push(format!(
                                "Exchange called a public auction for deed {tile:02}."
                            ));
                        } else {
                            self.events
                                .push("Exchange closed: all deeds are owned.".into())
                        }
                    }
                    Kind::Notice if !self.rules.cards.is_empty() => {
                        if self.deck.is_empty() {
                            self.deck = (0..self.rules.cards.len()).collect();
                            for k in (1..self.deck.len()).rev() {
                                let j = self.random(k + 1);
                                self.deck.swap(k, j)
                            }
                        }
                        let k = self.deck.pop().unwrap();
                        self.last_card = Some(k);
                        let c = &self.rules.cards[k];
                        let units = match c.kind {
                            CardKind::Deeds => {
                                self.owners.iter().filter(|o| **o == Some(a)).count() as i32
                            }
                            CardKind::Levels => self
                                .levels
                                .iter()
                                .zip(&self.owners)
                                .filter(|(_, o)| **o == Some(a))
                                .map(|(l, _)| *l as i32)
                                .sum(),
                            _ => 1,
                        };
                        let value = c.amount * units;
                        if matches!(c.kind, CardKind::Cover) {
                            self.players[a].cover = self.players[a].cover.max(value);
                            self.events.push(format!(
                                "{}: next-rent cover ${}.",
                                c.title, self.players[a].cover
                            ))
                        } else {
                            self.events.push(format!("{}: {value:+} dollars.", c.title));
                            if value < 0 {
                                self.charge(-value, None)
                            } else {
                                self.players[a].cash += value
                            }
                        }
                    }
                    Kind::Notice => {
                        let k = self.random(self.rules.notices.len());
                        let v = self.rules.notices[k];
                        self.events.push(format!("Port notice: {v:+} dollars."));
                        if v < 0 {
                            self.charge(-v, None)
                        } else {
                            self.players[a].cash += v
                        }
                    }
                    _ => {}
                }
            }
            Command::Buy { actor } if actor == a && self.phase == Phase::Offer => {
                let price = self.rules.tiles[i].price;
                if self.players[a].cash < price {
                    return Err("Not enough cash");
                }
                self.players[a].cash -= price;
                self.owners[i] = Some(a);
                self.phase = Phase::End;
                self.events.push(format!(
                    "Seat {} purchased deed {:02} for ${price}.",
                    a + 1,
                    i
                ));
            }
            Command::Pass { actor } if actor == a && self.phase == Phase::Offer => {
                self.phase = Phase::Auction;
                self.auction = Some(Auction {
                    actor,
                    tile: i,
                    high_bid: 0,
                    leader: None,
                    bidders: self.players.iter().map(|p| !p.out).collect(),
                });
                self.events
                    .push(format!("Seat {} sent deed {:02} to auction.", a + 1, i));
            }
            Command::Bid { actor, amount } => self.auction_action(actor, Some(amount))?,
            Command::Withdraw { actor } => self.auction_action(actor, None)?,
            Command::Propose(t) if self.phase == Phase::Roll && !self.traded => {
                self.validate_trade(&t)?;
                self.trade = Some(t);
                self.traded = true;
                self.phase = Phase::Trade;
            }
            Command::Accept { actor } | Command::Reject { actor } if self.phase == Phase::Trade => {
                let t = self.trade.as_ref().ok_or("No pending trade")?;
                if actor != t.to {
                    return Err("Only the recipient can answer the proposal");
                }
                if matches!(cmd, Command::Accept { .. }) {
                    // Pending trades freeze the table, so the validated assets are still available.
                    self.players[t.from].cash += t.take_cash - t.give_cash;
                    self.players[t.to].cash += t.give_cash - t.take_cash;
                    if let Some(i) = t.give_deed {
                        self.owners[i] = Some(t.to);
                    }
                    if let Some(i) = t.take_deed {
                        self.owners[i] = Some(t.from);
                    }
                    self.events.push(format!(
                        "Seat {} accepted seat {}'s trade.",
                        t.to + 1,
                        t.from + 1
                    ));
                } else {
                    self.events.push(format!(
                        "Seat {} rejected seat {}'s trade.",
                        t.to + 1,
                        t.from + 1
                    ));
                }
                self.trade = None;
                self.phase = Phase::Roll;
            }
            Command::End { actor } if actor == a && self.phase == Phase::End => {
                self.traded = false;
                loop {
                    self.turn = (self.turn + 1) % self.players.len();
                    if self.turn == 0 {
                        if self.round == self.rules.rounds {
                            self.finish();
                            self.refresh();
                            return Ok(());
                        }
                        self.round += 1
                    }
                    if !self.players[self.turn].out {
                        break;
                    }
                }
                self.phase = Phase::Roll;
            }
            _ => return Err("Action is not legal for this seat and phase"),
        }
        self.refresh();
        Ok(())
    }
}

// Synchronous JSON ABI. Returned bytes remain valid until the next dispatch.
thread_local! {
    static GAME:RefCell<Option<Game>>=const{RefCell::new(None)};
    static INPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};
    static OUTPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};
}
#[no_mangle]
pub extern "C" fn reserve(n: usize) -> *mut u8 {
    INPUT.with_borrow_mut(|b| {
        b.resize(n, 0);
        b.as_mut_ptr()
    })
}
#[no_mangle]
pub extern "C" fn length() -> usize {
    OUTPUT.with_borrow(Vec::len)
}
#[no_mangle]
pub extern "C" fn dispatch() -> *const u8 {
    let result = GAME.with_borrow_mut(|slot| -> Result<Vec<u8>, String> {
        let cmd: Command = INPUT
            .with_borrow(|b| serde_json::from_slice(b))
            .map_err(|e| e.to_string())?;
        match cmd {
            Command::Start { rules, seats, seed } => *slot = Some(Game::new(rules, seats, seed)?),
            c => slot.as_mut().ok_or("Start a game first")?.apply(c)?,
        }
        serde_json::to_vec(slot).map_err(|e| e.to_string())
    });
    OUTPUT.with_borrow_mut(|b| {
        *b = result.unwrap_or_else(|e| serde_json::json!({"error":e}).to_string().into_bytes());
        b.as_ptr()
    })
}
