use serde::{Deserialize, Serialize};
use std::cell::RefCell;

#[derive(Deserialize)]
struct Rules {
    #[serde(default)]
    dice: Dice,
    #[serde(default)]
    cards: Vec<Card>,
    development: Development,
    // Frozen tables without a bank-sale rule keep their original economy.
    bank_sale: Option<BankSale>,
    #[serde(default)]
    victory: Victory,
    #[serde(default)]
    liquidation: Liquidation,
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
#[derive(Deserialize)]
struct BankSale {
    rate_pct: i32,
    basis: Basis,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Basis {
    List,
    Acquisition,
}
#[derive(Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Victory {
    #[default]
    NetWorth,
    Elimination,
}
#[derive(Deserialize)]
#[serde(default)]
struct Liquidation {
    deeds: bool,
    improvements: bool,
    improvement_rate_pct: i32,
}
impl Default for Liquidation {
    fn default() -> Self {
        Self {
            deeds: false,
            improvements: false,
            improvement_rate_pct: 50,
        }
    }
}
#[derive(Serialize)]
struct Quote {
    tile: usize,
    cost: i32,
    tiles: Vec<usize>,
    gain: i64,
}
#[derive(Serialize)]
struct Sale {
    tile: usize,
    price: i32,
}
#[derive(Serialize)]
struct Salvage {
    tile: usize,
    tiles: Vec<usize>,
    price: i32,
}
#[derive(Serialize)]
struct Debt {
    debtor: usize,
    creditor: Option<usize>,
    amount: i32,
    paid: i32,
    remaining: i32,
}
#[derive(Serialize)]
struct Commission {
    tile: usize,
    cost: i32,
    gain: i32,
}
fn percent(n: i32, pct: i32) -> i64 {
    (i64::from(n) * i64::from(pct) + 50) / 100
}
#[derive(Deserialize)]
struct Tile {
    #[serde(default)]
    cost_pct: i32,
    #[serde(default)]
    bonus_pct: i32,
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
    Works,
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
    Works,
    Guild,
    Roll,
    Offer,
    Auction,
    Trade,
    Debt,
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
    bonuses: Vec<i32>,
    locked: Vec<bool>,
    acquisition: Vec<Option<i32>>,
    sells: Vec<Sale>,
    salvages: Vec<Salvage>,
    debt: Option<Debt>,
    commissions: Vec<Commission>,
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
    Salvage {
        actor: usize,
        tile: usize,
    },
    Bankrupt {
        actor: usize,
    },
    Sell {
        actor: usize,
        tile: usize,
    },
    Commission {
        actor: usize,
        tile: usize,
    },
    Skip {
        actor: usize,
    },
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
            || !(0..=100).contains(&rules.liquidation.improvement_rate_pct)
            || rules
                .bank_sale
                .as_ref()
                .is_some_and(|s| !(0..=100).contains(&s.rate_pct))
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
        let mut max_fee = 0;
        let mut max_bonus = 0;
        for w in rules.tiles.iter().filter(|t| t.kind == Kind::Works) {
            if w.cost_pct <= 0 || w.bonus_pct <= 0 {
                return Err("Invalid works terms");
            }
            max_fee = max_fee.max(w.cost_pct);
            max_bonus = max_bonus.max(w.bonus_pct);
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
            let peak_rent = d.levels.last().map_or(d.set_rent_pct, |l| l.rent_pct);
            if percent(t.rent, peak_rent) + percent(t.rent, max_bonus) > i32::MAX as i64
                || percent(t.rent, max_fee) > i32::MAX as i64
            {
                return Err("Rent or refit quote too large");
            }
            max_cost += largest;
            if max_cost > i32::MAX as i64 {
                return Err("Improvement costs too large");
            }
        }
        let mut game = Self {
            levels: vec![0; rules.tiles.len()],
            bonuses: vec![0; rules.tiles.len()],
            locked: vec![false; rules.tiles.len()],
            acquisition: vec![None; rules.tiles.len()],
            sells: vec![],
            salvages: vec![],
            debt: None,
            commissions: vec![],
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
    fn return_to_bank(&mut self, i: usize) {
        self.owners[i] = None;
        self.acquisition[i] = None;
        self.levels[i] = 0;
        self.bonuses[i] = 0;
    }
    fn sale_price(&self, i: usize) -> Option<i32> {
        let sale = self.rules.bank_sale.as_ref()?;
        let basis = match sale.basis {
            Basis::List => self.rules.tiles[i].price,
            Basis::Acquisition => self.acquisition[i]?,
        };
        Some(percent(basis, sale.rate_pct) as i32)
    }
    fn build_cost(&self, tiles: &[usize], tier: usize) -> i32 {
        let rate = self.rules.development.levels[tier].cost_pct;
        tiles
            .iter()
            .map(|&k| percent(self.rules.tiles[k].price, rate) as i32)
            .sum()
    }
    fn salvage_price(&self, tiles: &[usize], tier: usize) -> i32 {
        percent(
            self.build_cost(tiles, tier),
            self.rules.liquidation.improvement_rate_pct,
        ) as i32
    }
    // Even a zero-price removal may unlock a deed or an earlier, valuable tier.
    fn can_unlock_value(&self, group: &[usize]) -> bool {
        if self.rules.liquidation.deeds && group.iter().any(|&k| self.sale_price(k) > Some(0)) {
            return true;
        }
        if self.rules.development.policy == Policy::District {
            (0..self.levels[group[0]]).any(|l| self.salvage_price(group, l) > 0)
        } else {
            group
                .iter()
                .any(|&k| (0..self.levels[k]).any(|l| self.salvage_price(&[k], l) > 0))
        }
    }
    fn refresh(&mut self) {
        let d = &self.rules.development;
        self.builds.clear();
        self.commissions.clear();
        self.sells.clear();
        self.salvages.clear();
        self.locked.fill(false);
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
            self.locked[i] = group.iter().any(|&k| self.levels[k] > 0);
            self.rents[i] += self.bonuses[i];
            if owner == self.turn {
                let player = &self.players[owner];
                if !self.locked[i]
                    && (self.phase == Phase::Roll
                        || self.phase == Phase::Debt && self.rules.liquidation.deeds)
                {
                    if let Some(price) = self.sale_price(i) {
                        if player.cash.checked_add(price).is_some()
                            && (self.phase == Phase::Roll || price > 0)
                        {
                            self.sells.push(Sale { tile: i, price });
                        }
                    }
                }
                if self.phase == Phase::Works && self.bonuses[i] == 0 {
                    let works = &self.rules.tiles[player.pos];
                    let cost = percent(t.rent, works.cost_pct) as i32;
                    let gain = percent(t.rent, works.bonus_pct) as i32;
                    if cost > 0 && gain > 0 && cost <= player.cash {
                        self.commissions.push(Commission {
                            tile: i,
                            cost,
                            gain,
                        });
                    }
                }
            }
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
            ) as i32
                + self.bonuses[i];
            if owner != self.turn {
                continue;
            }
            if self.phase == Phase::Debt && self.rules.liquidation.improvements && lv > 0 {
                let tiles = match d.policy {
                    Policy::District if i == group[0] => group.clone(),
                    Policy::District => continue,
                    Policy::Even if group.iter().any(|&k| self.levels[k] > lv) => continue,
                    _ => vec![i],
                };
                let price = self.salvage_price(&tiles, lv - 1);
                if price > 0 || self.can_unlock_value(&group) {
                    self.salvages.push(Salvage {
                        tile: i,
                        tiles,
                        price,
                    });
                }
            }
            if self.phase != Phase::Roll || lv >= d.levels.len() {
                continue;
            }
            let tiles = match d.policy {
                Policy::District if i == group[0] => group,
                Policy::District => continue,
                Policy::Even if group.iter().any(|&k| self.levels[k] < lv) => continue,
                _ => vec![i],
            };
            let cost = self.build_cost(&tiles, lv);
            let mut gain = 0i64;
            for &k in &tiles {
                let x = &self.rules.tiles[k];
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
                gain,
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
    fn remit(&mut self, amount: i32, to: Option<usize>) -> i32 {
        let a = self.turn;
        let paid = amount.min(self.players[a].cash);
        self.players[a].cash -= paid;
        if let Some(b) = to {
            self.players[b].cash += paid
        }
        paid
    }
    fn charge(&mut self, amount: i32, creditor: Option<usize>) {
        let paid = self.remit(amount, creditor);
        if paid < amount {
            if self.rules.liquidation.deeds || self.rules.liquidation.improvements {
                self.debt = Some(Debt {
                    debtor: self.turn,
                    creditor,
                    amount,
                    paid,
                    remaining: amount - paid,
                });
                self.phase = Phase::Debt;
            } else {
                self.bankrupt();
            }
        }
    }
    // A landing is never run again. Only the outstanding part of its net bill
    // is remitted; excess sale proceeds stay with the solvent debtor.
    fn collect_proceeds(&mut self) {
        if let Some(mut debt) = self.debt.take() {
            let paid = self.remit(debt.remaining, debt.creditor);
            debt.paid += paid;
            debt.remaining -= paid;
            if debt.remaining == 0 {
                self.phase = Phase::End;
                self.events.push(format!(
                    "Seat {} settled the ${} bill.",
                    self.turn + 1,
                    debt.amount
                ));
            } else {
                self.debt = Some(debt);
            }
        }
    }
    fn bankrupt(&mut self) {
        let a = self.turn;
        // All cash (including any earlier asset-sale proceeds) has already
        // been remitted. Declaring forfeits the assets, not a second payment.
        if let Some(debt) = self.debt.take() {
            self.events.push(format!(
                "Seat {} paid ${} of ${}; ${} remains unpaid.",
                a + 1,
                debt.paid,
                debt.amount,
                debt.remaining
            ));
        }
        self.players[a].out = true;
        for i in 0..self.owners.len() {
            if self.owners[i] == Some(a) {
                self.return_to_bank(i);
            }
        }
        self.events.push(format!(
            "Seat {} is bankrupt. Their deeds return to market.",
            a + 1
        ));
        if self.players.iter().filter(|p| !p.out).count() == 1 {
            self.finish()
        } else {
            self.phase = Phase::End;
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
                    i64::from(p.cash)
                        + self
                            .owners
                            .iter()
                            .enumerate()
                            .filter(|(_, o)| **o == Some(i))
                            .map(|(n, _)| i64::from(self.rules.tiles[n].price))
                            .sum::<i64>(),
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
                self.acquisition[auction.tile] = Some(auction.high_bid);
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
            if deed.is_some_and(|i| self.owners.get(i) != Some(&Some(seat)) || self.locked[i])
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
            Command::Sell { actor, tile }
                if actor == a && matches!(self.phase, Phase::Roll | Phase::Debt) =>
            {
                let price = self
                    .sells
                    .iter()
                    .find(|q| q.tile == tile)
                    .ok_or("This deed cannot be sold to the bank")?
                    .price;
                self.players[a].cash += price;
                self.return_to_bank(tile);
                self.events.push(format!(
                    "Seat {} sold deed {tile:02} to the bank for ${price}.",
                    a + 1
                ));
                self.collect_proceeds();
            }
            Command::Salvage { actor, tile } if actor == a && self.phase == Phase::Debt => {
                let q = self
                    .salvages
                    .iter()
                    .find(|q| q.tile == tile)
                    .ok_or("This improvement cannot be salvaged")?;
                for &k in &q.tiles {
                    self.levels[k] -= 1;
                }
                self.players[a].cash += q.price;
                self.events.push(format!(
                    "Seat {} salvaged a level in {} for ${}.",
                    a + 1,
                    self.rules.tiles[tile].group,
                    q.price
                ));
                self.collect_proceeds();
            }
            Command::Bankrupt { actor } if actor == a && self.phase == Phase::Debt => {
                self.bankrupt();
            }
            Command::Commission { actor, tile } if actor == a && self.phase == Phase::Works => {
                let q = self
                    .commissions
                    .iter()
                    .find(|q| q.tile == tile)
                    .ok_or("This refit is not available")?;
                self.players[a].cash -= q.cost;
                self.bonuses[tile] = q.gain;
                self.events.push(format!(
                    "Seat {} paid ${} to refit deed {tile:02}: +${} on its next rent.",
                    a + 1,
                    q.cost,
                    q.gain
                ));
                self.phase = Phase::End;
            }
            Command::Skip { actor } if actor == a && self.phase == Phase::Works => {
                self.events
                    .push(format!("Seat {} passed on a refit.", a + 1));
                self.phase = Phase::End;
            }
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
                            if self.bonuses[j] > 0 {
                                self.events.push(format!(
                                    "Refit on deed {j:02} used (+${}).",
                                    self.bonuses[j]
                                ));
                                self.bonuses[j] = 0;
                            }
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
                    Kind::Works => self.phase = Phase::Works,
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
                self.acquisition[i] = Some(price);
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
                        self.bonuses[i] = 0;
                    }
                    if let Some(i) = t.take_deed {
                        self.owners[i] = Some(t.from);
                        self.bonuses[i] = 0;
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
                        if self.rules.victory == Victory::NetWorth
                            && self.round == self.rules.rounds
                        {
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
        if self.phase == Phase::Debt && self.sells.is_empty() && self.salvages.is_empty() {
            self.bankrupt();
            self.refresh();
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> serde_json::Value {
        serde_json::from_str(include_str!("../web/rules.json")).unwrap()
    }

    #[test]
    fn reject_invalid_designer_terms_before_play() {
        for rate in [-1, 101] {
            let mut r = config();
            r["liquidation"]["improvement_rate_pct"] = rate.into();
            assert!(Game::new(serde_json::from_value(r).unwrap(), 2, 1).is_err());
            let mut r = config();
            r["bank_sale"]["rate_pct"] = rate.into();
            assert!(Game::new(serde_json::from_value(r).unwrap(), 2, 1).is_err());
        }
        for (fee, bonus) in [(0, 100), (50, -1), (50, i32::MAX)] {
            let mut r = config();
            r["tiles"][0] = serde_json::json!({"kind":"works","cost_pct":fee,"bonus_pct":bonus});
            r["tiles"][1]["rent"] = 200.into();
            assert!(Game::new(serde_json::from_value(r).unwrap(), 2, 1).is_err());
        }
    }

    #[test]
    fn affordable_refit_and_receipt_clear_on_default() {
        let mut r = config();
        r["tiles"][0] = serde_json::json!({"kind":"works","cost_pct":50,"bonus_pct":100});
        let mut g = Game::new(serde_json::from_value(r).unwrap(), 3, 10).unwrap();
        // Isolate a visit where the visitor owns a $20-base-rent deed and
        // cannot afford its $10 refit; then exercise the exact-cash boundary.
        g.owners[1] = Some(0);
        g.acquisition[1] = Some(30);
        g.phase = Phase::Works;
        g.players[0].cash = 9;
        g.refresh();
        assert!(g.commissions.is_empty());
        assert!(g.apply(Command::Commission { actor: 0, tile: 1 }).is_err());
        g.players[0].cash = 10;
        g.refresh();
        g.apply(Command::Commission { actor: 0, tile: 1 }).unwrap();
        assert_eq!((g.players[0].cash, g.rents[1]), (0, 40));
        g.charge(1, None);
        g.refresh();
        assert!(g.players[0].out);
        assert_eq!(
            (g.acquisition[1], g.owners[1], g.bonuses[1]),
            (None, None, 0)
        );
        assert_eq!(g.rents[1], 20);
    }

    // Give the active seat a complete pair. Rolls, builds, salvage and payments
    // below still go through their real validators and refresh transitions.
    fn district_game(policy: &str, rate: i32, deeds: bool, fee: i32) -> Game {
        let mut r = config();
        r["salary"] = 0.into();
        r["development"] = serde_json::json!({"policy":policy,"set_rent_pct":200,
            "levels":[{"cost_pct":10,"rent_pct":300},{"cost_pct":33,"rent_pct":410}]});
        r["liquidation"] =
            serde_json::json!({"deeds":deeds,"improvements":true,"improvement_rate_pct":rate});
        r["tiles"] = serde_json::json!([{"kind":"start"},{"kind":"deed","group":"A","price":101,"rent":20},
            {"kind":"fee","price":fee},{"kind":"deed","group":"A","price":119,"rent":25}]);
        let mut g = Game::new(serde_json::from_value(r).unwrap(), 3, 10).unwrap();
        for i in [1, 3] {
            g.owners[i] = Some(0);
            // Deliberately unlike list; build/salvage use the actual build cost.
            g.acquisition[i] = Some(10);
        }
        g.refresh();
        g
    }

    #[test]
    fn even_and_free_salvage_top_tiers_without_repricing_a_level_based_bill() {
        for policy in ["even", "free"] {
            let mut g = district_game(policy, 50, false, 0);
            g.rules.tiles[2].kind = Kind::Notice;
            g.rules.cards.push(Card {
                title: "Inspection".into(),
                kind: CardKind::Levels,
                amount: -8,
            });
            for tile in [1, 3, 1] {
                g.apply(Command::Build { actor: 0, tile }).unwrap();
            }
            assert_eq!(g.players[0].cash, 750 - 10 - 12 - 33);
            assert!(g.apply(Command::Build { actor: 0, tile: 1 }).is_err());
            assert!(g.apply(Command::Salvage { actor: 0, tile: 1 }).is_err());
            g.players[0].cash = 7;
            g.apply(Command::Roll { actor: 0 }).unwrap();
            assert_eq!(g.debt.as_ref().unwrap().amount, 24); // 3 levels x $8
            assert_eq!(g.debt.as_ref().unwrap().remaining, 17);
            assert!(g.sells.is_empty() && g.builds.is_empty());
            assert_eq!(g.salvages[0].price, 17); // half of the rounded $33 tier
            if policy == "even" {
                assert!(g.apply(Command::Salvage { actor: 0, tile: 3 }).is_err());
            } else {
                g.apply(Command::Salvage { actor: 0, tile: 3 }).unwrap();
                let d = g.debt.as_ref().unwrap();
                assert_eq!((d.amount, d.paid, d.remaining), (24, 13, 11));
                assert_eq!(g.levels[3], 0);
            }
            g.apply(Command::Salvage { actor: 0, tile: 1 }).unwrap();
            assert!(g.phase == Phase::End && g.debt.is_none() && !g.players[0].out);
            assert_eq!(g.players[0].cash, if policy == "even" { 0 } else { 6 });
            assert_eq!((g.levels[1], g.rents[1]), (1, 60));
            assert!(g.locked[3] && g.salvages.is_empty());
            assert_eq!(
                g.events
                    .iter()
                    .filter(|e| e.starts_with("Inspection:"))
                    .count(),
                1
            );
        }
    }

    #[test]
    fn district_salvage_reverses_one_whole_build_then_unlocks_deeds() {
        let mut g = district_game("district", 50, true, 105);
        for _ in 0..2 {
            g.apply(Command::Build { actor: 0, tile: 1 }).unwrap();
        }
        assert_eq!(g.players[0].cash, 750 - 22 - 72);
        g.players[0].cash = 7;
        g.apply(Command::Roll { actor: 0 }).unwrap();
        for price in [36, 11] {
            assert!(g.apply(Command::Sell { actor: 0, tile: 3 }).is_err());
            assert!(g.apply(Command::Salvage { actor: 0, tile: 3 }).is_err());
            assert_eq!(g.salvages.len(), 1);
            assert_eq!(g.salvages[0].tiles, [1, 3]);
            assert_eq!(g.salvages[0].price, price);
            g.apply(Command::Salvage { actor: 0, tile: 1 }).unwrap();
            assert_eq!(g.levels[1], g.levels[3]);
        }
        assert_eq!(g.debt.as_ref().unwrap().remaining, 51);
        assert!(g.salvages.is_empty() && !g.locked[3]);
        assert_eq!(g.rents[3], 50); // intact set, no levels
        g.apply(Command::Sell { actor: 0, tile: 1 }).unwrap();
        assert_eq!(g.rents[3], 25); // set broken
        assert_eq!(g.players[0].cash, 0);
        assert!(g.phase == Phase::End && !g.players[0].out);
    }

    #[test]
    fn zero_price_removal_can_unlock_a_sale_but_cannot_stall_bankruptcy() {
        for deeds in [true, false] {
            let mut g = district_game("even", 0, deeds, 160);
            g.apply(Command::Build { actor: 0, tile: 3 }).unwrap();
            g.players[0].cash = 1;
            g.apply(Command::Roll { actor: 0 }).unwrap();
            if deeds {
                assert_eq!(g.salvages[0].price, 0);
                g.apply(Command::Salvage { actor: 0, tile: 3 }).unwrap();
                for tile in [3, 1] {
                    g.apply(Command::Sell { actor: 0, tile }).unwrap();
                }
                assert!(g.events.iter().any(|e| e.contains("$48 remains unpaid")));
            }
            assert!(g.players[0].out && g.debt.is_none() && g.phase == Phase::End);
            assert!(g.owners.iter().all(Option::is_none));
        }
    }
}
