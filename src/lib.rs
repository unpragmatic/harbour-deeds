mod board_cards;

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Rules {
    #[serde(default)]
    dice: Dice,
    #[serde(default)]
    cards: Vec<Card>,
    #[serde(default)]
    named_cards: Vec<board_cards::Entry>,
    development: Development,
    #[serde(default)]
    network_fares: BTreeMap<String, Vec<i32>>,
    #[serde(default)]
    utility_multipliers: BTreeMap<String, Vec<i32>>,
    // Frozen tables without a bank-sale rule keep their original economy.
    bank_sale: Option<BankSale>,
    #[serde(default)]
    victory: Victory,
    #[serde(default)]
    liquidation: Liquidation,
    cash: i32,
    salary: i32,
    salary_land: Option<i32>,
    doubles_limit: Option<u8>,
    prison_entry: Option<usize>,
    bail_cost: Option<i32>,
    #[serde(default = "yes")]
    auction_declined: bool,
    #[serde(default = "yes")]
    collect_rent_in_jail: bool,
    auction_increment: i32,
    rounds: usize,
    tiles: Vec<Tile>,
    notices: Vec<i32>,
}
fn yes() -> bool {
    true
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
    label: Option<String>,
    cost_pct: Option<i32>,
    rent_pct: Option<i32>,
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
    name: Option<String>,
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
    deck: Option<String>,
    rent_levels: Option<Vec<i32>>,
    build_costs: Option<Vec<i32>>,
    cash_tax_pct: Option<i32>,
    move_to: Option<usize>,
    skip_turns: Option<u8>,
}
impl Tile {
    fn tier_cost(&self, d: &Development, tier: usize) -> i64 {
        self.build_costs.as_ref().map_or_else(
            || {
                percent(
                    self.price,
                    d.levels[tier].cost_pct.expect("validated cost curve"),
                )
            },
            |costs| i64::from(costs[tier]),
        )
    }
    // Level zero is the intact but undeveloped district.
    fn set_rent(&self, d: &Development, level: usize) -> i64 {
        if level == 0 {
            return percent(self.rent, d.set_rent_pct);
        }
        self.rent_levels.as_ref().map_or_else(
            || {
                percent(
                    self.rent,
                    d.levels[level - 1].rent_pct.expect("validated rent curve"),
                )
            },
            |rents| i64::from(rents[level - 1]),
        )
    }
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
    #[serde(skip_serializing_if = "no_skips")]
    skip_turns: u8,
    #[serde(skip_serializing_if = "no_skips")]
    pardons: u8,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    in_prison: bool,
}
fn no_skips(n: &u8) -> bool {
    *n == 0
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
struct RentReceipt {
    owner: usize,
    due: i32,
    paid: i32,
    covered: i32,
    waived: bool,
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
    #[serde(skip_serializing_if = "no_skips")]
    doubles_in_row: u8,
    #[serde(skip)]
    deck: Vec<usize>,
    #[serde(skip)]
    piles: board_cards::Piles,
    #[serde(skip_serializing_if = "Option::is_none")]
    card_receipt: Option<board_cards::Receipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rent_receipt: Option<RentReceipt>,
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
    Pardon {
        actor: usize,
    },
    Bail {
        actor: usize,
    },
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
        rules: Box<Rules>,
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
    fn new(mut rules: Rules, seats: usize, seed: u32) -> Result<Self, &'static str> {
        if !(2..=4).contains(&seats)
            || rules.tiles.len() < 4
            || rules.rounds == 0
            || (rules.notices.is_empty() && rules.cards.is_empty() && rules.named_cards.is_empty())
            || (rules.notices.is_empty()
                && rules.cards.is_empty()
                && rules
                    .tiles
                    .iter()
                    .any(|t| t.kind == Kind::Notice && t.deck.is_none()))
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
            || rules.salary_land.is_some_and(|land| land < 0)
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
        if rules.doubles_limit.is_some()
            || rules.bail_cost.is_some()
            || rules.prison_entry.is_some()
        {
            if rules.dice.count != 2
                || rules.doubles_limit == Some(0)
                || rules.bail_cost.is_some_and(|cost| cost < 0)
            {
                return Err("Invalid prison or doubles rules");
            }
            let entries = rules.tiles.iter().enumerate().filter(|(_, t)| {
                t.kind == Kind::Rest
                    && t.move_to.is_some_and(|k| k < rules.tiles.len())
                    && t.skip_turns.unwrap_or(0) > 0
            });
            let mut candidates = entries.map(|(i, _)| i);
            if let Some(entry) = rules.prison_entry {
                if !candidates.any(|k| k == entry) {
                    return Err("Invalid prison entry tile");
                }
            } else {
                rules.prison_entry = candidates.next();
                if rules.prison_entry.is_none() || candidates.next().is_some() {
                    return Err("Expected one prison entry tile");
                }
            }
        }
        board_cards::validate(&rules)?;
        for (schedules, utility) in [
            (&rules.network_fares, false),
            (&rules.utility_multipliers, true),
        ] {
            for (group, rates) in schedules {
                if group.trim().is_empty() || utility && rules.network_fares.contains_key(group) {
                    return Err("Missing or conflicting rent schedule group");
                }
                if rates.is_empty()
                    || rates[0] < i32::from(utility)
                    || rates.windows(2).any(|pair| pair[0] >= pair[1])
                {
                    return Err("Invalid ownership rent schedule");
                }
                if utility
                    && rates
                        .last()
                        .unwrap()
                        .checked_mul((rules.dice.count * rules.dice.sides) as i32)
                        .is_none()
                {
                    return Err("Utility rent too large for these dice");
                }
                let base = if utility { 0 } else { rates[0] };
                let mut members = 0;
                for tile in rules.tiles.iter().filter(|t| &t.group == group) {
                    if tile.kind != Kind::Deed || tile.rent != base {
                        return Err("Every scheduled member must be a deed with the base rent");
                    }
                    members += 1;
                }
                if rates.len() != members {
                    return Err("Rent schedule must have one rate per deed in the group");
                }
            }
        }
        let d = &rules.development;
        if d.set_rent_pct < 100 {
            return Err("Invalid improvement curve");
        }
        let percent_curve = d
            .levels
            .iter()
            .any(|l| l.cost_pct.is_some() || l.rent_pct.is_some());
        let mut previous = d.set_rent_pct;
        for l in &d.levels {
            match (l.cost_pct, l.rent_pct) {
                (Some(cost), Some(rent)) if cost > 0 && rent > previous => previous = rent,
                (None, None)
                    if !percent_curve && l.label.as_ref().is_some_and(|s| !s.trim().is_empty()) => {
                }
                _ => return Err("Invalid improvement curve"),
            }
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
        for t in &rules.tiles {
            if t.cash_tax_pct
                .is_some_and(|pct| t.kind != Kind::Fee || !(0..=100).contains(&pct))
                || (t.move_to.is_some() || t.skip_turns.is_some()) && t.kind != Kind::Rest
                || t.move_to.is_some_and(|k| k >= rules.tiles.len())
            {
                return Err("Invalid fee or rest tile effect");
            }
            if t.kind != Kind::Deed
                || rules.network_fares.contains_key(&t.group)
                || rules.utility_multipliers.contains_key(&t.group)
            {
                if t.build_costs.is_some() || t.rent_levels.is_some() {
                    return Err("Only developable deeds can have improvement schedules");
                }
                continue;
            }
            match (&t.build_costs,&t.rent_levels) {
                (None,None) if percent_curve || d.levels.is_empty() => {}
                (Some(costs),Some(rents)) if costs.len() == d.levels.len() && rents.len() == d.levels.len() => {}
                _ => return Err("Deed needs paired costs and rents for every level or a complete percentage curve"),
            }
            let mut largest = 0;
            let mut rent = t.set_rent(d, 0);
            for tier in 0..d.levels.len() {
                let c = t.tier_cost(d, tier);
                let next = t.set_rent(d, tier + 1);
                if c <= 0 || t.rent_levels.is_some() && next <= rent {
                    return Err("Invalid deed development values");
                }
                largest = largest.max(c);
                rent = next;
            }
            if rent + percent(t.rent, max_bonus) > i32::MAX as i64
                || percent(t.rent, max_fee) > i32::MAX as i64
            {
                return Err("Rent or refit quote too large");
            }
            max_cost += largest;
            if max_cost > i32::MAX as i64 {
                return Err("Improvement costs too large");
            }
        }
        let opening = format!(
            "The table is open. All players begin at {}.",
            rules.tiles[0].name.as_deref().unwrap_or("space 00")
        );
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
            doubles_in_row: 0,
            deck: vec![],
            piles: Default::default(),
            card_receipt: None,
            rent_receipt: None,
            last_card: None,
            rules,
            seed: seed.max(1),
            turn: 0,
            round: 1,
            phase: Phase::Roll,
            auction: None,
            trade: None,
            traded: false,
            events: vec![opening],
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
    fn held(&self, group: &[usize], owner: usize) -> usize {
        group
            .iter()
            .filter(|&&k| self.owners[k] == Some(owner))
            .count()
    }
    fn owned_rent(&self, i: usize, held: usize, group_size: usize) -> i32 {
        let t = &self.rules.tiles[i];
        if let Some(fares) = self.rules.network_fares.get(&t.group) {
            return fares[held - 1];
        }
        if let Some(rates) = self.rules.utility_multipliers.get(&t.group) {
            return rates[held - 1] * self.dice.iter().sum::<usize>() as i32;
        }
        let base = if held == group_size {
            t.set_rent(&self.rules.development, self.levels[i]) as i32
        } else {
            t.rent
        };
        base + self.bonuses[i]
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
        tiles
            .iter()
            .map(|&k| self.rules.tiles[k].tier_cost(&self.rules.development, tier) as i32)
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
            let held = self.held(&group, owner);
            self.rents[i] = self.owned_rent(i, held, group.len());
            self.locked[i] = group.iter().any(|&k| self.levels[k] > 0);
            let player = &self.players[owner];
            if owner == self.turn
                && !self.locked[i]
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
            // Both types of scheduled deed can be sold but not developed or refitted.
            if self.rules.network_fares.contains_key(&t.group)
                || self.rules.utility_multipliers.contains_key(&t.group)
            {
                continue;
            }
            if owner == self.turn && self.phase == Phase::Works && self.bonuses[i] == 0 {
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
            if held != group.len() {
                continue;
            }
            let lv = self.levels[i];
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
                gain += x.set_rent(d, lv + 1) - x.set_rent(d, lv);
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
                self.resume_after_card_bill();
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

    fn send_to_prison(&mut self, a: usize, entry_index: usize) -> Result<(), &'static str> {
        let entry = self
            .rules
            .tiles
            .get(entry_index)
            .ok_or("Missing prison entry")?;
        let to = entry.move_to.ok_or("Missing prison destination")?;
        let attempts = entry
            .skip_turns
            .filter(|&s| s > 0)
            .ok_or("Missing detention duration")?;
        self.phase = Phase::End;
        self.doubles_in_row = 0;
        self.players[a].pos = to;
        self.events.push(format!(
            "Seat {} was sent to prison at space {to:02}.",
            a + 1
        ));
        self.players[a].in_prison = true;
        self.players[a].skip_turns = attempts;
        Ok(())
    }

    fn roll(&mut self, a: usize) -> Result<(), &'static str> {
        self.last_card = None;
        self.card_receipt = None;
        self.rent_receipt = None;
        self.dice = (0..self.rules.dice.count)
            .map(|_| 1 + self.random(self.rules.dice.sides))
            .collect();
        self.events.push(format!(
            "Seat {} rolled {}.",
            a + 1,
            self.dice
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(" + ")
        ));
        let double = self.dice.len() == 2 && self.dice[0] == self.dice[1];
        let p = &mut self.players[a];
        if p.in_prison {
            self.doubles_in_row = 0;
            if !double {
                p.skip_turns -= 1;
                p.in_prison = p.skip_turns > 0;
                self.events.push(if p.in_prison {
                    format!(
                        "Seat {} remains in prison ({} attempts left).",
                        a + 1,
                        p.skip_turns
                    )
                } else {
                    format!("Seat {} served their time and can move next turn.", a + 1)
                });
                self.phase = Phase::End;
                return Ok(());
            }
            p.in_prison = false;
            p.skip_turns = 0;
            self.events
                .push(format!("Seat {} rolled doubles and left prison.", a + 1));
        } else if let Some(limit) = self.rules.doubles_limit {
            self.doubles_in_row = if double { self.doubles_in_row + 1 } else { 0 };
            if self.doubles_in_row == limit {
                return self.send_to_prison(a, self.rules.prison_entry.unwrap());
            }
        }
        let path = p.pos + self.dice.iter().sum::<usize>();
        let n = self.rules.tiles.len();
        let j = path % n;
        if path >= n {
            let last = if j == 0 {
                self.rules.salary_land.unwrap_or(self.rules.salary)
            } else {
                self.rules.salary
            };
            let payout = i64::from(self.rules.salary) * (path / n - 1) as i64 + i64::from(last);
            let paid = payout.min(i64::from(i32::MAX - p.cash)) as i32;
            p.cash += paid;
            self.events.push(format!("Port salary: +${paid}."));
        }
        self.land(a, j)
    }

    // Both dice and card movement resolve the destination here. Crossing
    // salary is a property of the journey, not of landing on space zero.
    fn land(&mut self, a: usize, j: usize) -> Result<(), &'static str> {
        let tile = &self.rules.tiles[j];
        self.players[a].pos = j;
        self.phase = Phase::End;
        match tile.kind {
            Kind::Deed => match self.owners[j] {
                None => self.phase = Phase::Offer,
                Some(b) if b != a => {
                    if self.players[b].in_prison && !self.rules.collect_rent_in_jail {
                        self.events
                            .push(format!("No rent: Seat {} is in jail.", b + 1));
                        self.rent_receipt = Some(RentReceipt {
                            owner: b,
                            due: 0,
                            paid: 0,
                            covered: 0,
                            waived: true,
                        });
                        return Ok(());
                    }
                    // Snapshots from before this roll reflect the previous dice.
                    let group = self.district(j);
                    let rent = self.owned_rent(j, self.held(&group, b), group.len());
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
                    self.rent_receipt = Some(RentReceipt {
                        owner: b,
                        due: rent,
                        paid: (rent - covered).min(self.players[a].cash),
                        covered,
                        waived: false,
                    });
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
                let fee = tile
                    .cash_tax_pct
                    .map_or(tile.price, |pct| percent(self.players[a].cash, pct) as i32);
                self.events.push(format!("Harbor dues: ${fee}."));
                self.charge(fee, None)
            }
            Kind::Rest => {
                if self.rules.prison_entry == Some(j) {
                    return self.send_to_prison(a, j);
                }
                if let Some(to) = tile.move_to {
                    self.players[a].pos = to;
                    self.events
                        .push(format!("Seat {} moved to space {to:02}.", a + 1));
                }
                let skip = tile.skip_turns.unwrap_or(0);
                if skip > 0 {
                    self.doubles_in_row = 0;
                    self.players[a].skip_turns = skip;
                    self.events.push(format!(
                        "Seat {} will miss {skip} turn{}.",
                        a + 1,
                        if skip == 1 { "" } else { "s" }
                    ));
                }
            }
            Kind::Guild => self.phase = Phase::Guild,
            Kind::Works => self.phase = Phase::Works,
            Kind::Exchange => {
                let n = self.rules.tiles.len();
                if let Some(tile) = (1..n)
                    .map(|k| (j + k) % n)
                    .find(|&k| self.rules.tiles[k].kind == Kind::Deed && self.owners[k].is_none())
                {
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
            Kind::Notice if tile.deck.is_some() => self.draw_named(a, j)?,
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
                    CardKind::Deeds => self.owners.iter().filter(|o| **o == Some(a)).count() as i32,
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
            Command::Pardon { actor } | Command::Bail { actor }
                if actor == a && self.phase == Phase::Roll && self.players[a].in_prison =>
            {
                if matches!(cmd, Command::Bail { .. }) {
                    let cost = self.rules.bail_cost.ok_or("Bail is not available")?;
                    if self.players[a].cash < cost {
                        return Err("Not enough cash for bail");
                    }
                    self.players[a].cash -= cost;
                    self.events
                        .push(format!("Seat {} paid ${cost} bail.", a + 1));
                } else if !self.consume_pardon(a) {
                    return Err("This seat holds no pardon");
                }
                self.players[a].in_prison = false;
                self.players[a].skip_turns = 0;
                self.doubles_in_row = 0;
                self.phase = Phase::End;
            }
            Command::Roll { actor } if actor == a && self.phase == Phase::Roll => self.roll(a)?,
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
            Command::Pass { actor }
                if actor == a && self.phase == Phase::Offer && !self.rules.auction_declined =>
            {
                self.phase = Phase::End;
                self.events.push(format!(
                    "Seat {} declined deed {i:02}. It stays on the market.",
                    a + 1
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
                if self.doubles_in_row == 0 || self.players[a].out {
                    self.doubles_in_row = 0;
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
                        let next = &mut self.players[self.turn];
                        if next.out {
                            continue;
                        }
                        if next.skip_turns == 0 || next.in_prison {
                            break;
                        }
                        next.skip_turns -= 1;
                        self.events.push(format!(
                            "Seat {} missed a turn ({} left).",
                            self.turn + 1,
                            next.skip_turns
                        ));
                    }
                }
                self.phase = Phase::Roll;
            }
            _ => return Err("Action is not legal for this seat and phase"),
        }
        if self.phase == Phase::Roll {
            self.open_card_bill();
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
            Command::Start { rules, seats, seed } => *slot = Some(Game::new(*rules, seats, seed)?),
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

    fn classic_rules() -> serde_json::Value {
        serde_json::from_str(include_str!("../web/richup-classic.json")).unwrap()
    }

    fn game(r: serde_json::Value, seed: u32) -> Game {
        Game::new(serde_json::from_value(r).unwrap(), 2, seed).unwrap()
    }

    #[test]
    fn jail_rent_applies_to_the_owner_only_during_detention() {
        for configured in [None, Some(true), Some(false)] {
            let mut rules = classic_rules();
            if let Some(on) = configured {
                rules["collect_rent_in_jail"] = on.into();
            }
            for tile in [1, 5, 12] {
                // city, airport, company
                let mut g = game(rules.clone(), 10);
                g.dice = vec![2, 3];
                g.owners[tile] = Some(1);
                g.players[0].cover = 1;
                if tile == 1 {
                    g.bonuses[tile] = 50;
                }
                g.send_to_prison(1, 30).unwrap();
                g.land(0, tile).unwrap();
                let receipt = g.rent_receipt.as_ref().unwrap();
                assert_eq!(receipt.waived, configured == Some(false));
                if receipt.waived {
                    assert_eq!(
                        (g.players[0].cash, g.players[1].cash, g.players[0].cover),
                        (1500, 1500, 1)
                    );
                    assert!(g.debt.is_none());
                    if tile == 1 {
                        assert_eq!(g.bonuses[tile], 50);
                    }
                    // Still on the prison space, but now only visiting.
                    g.players[1].in_prison = false;
                    g.land(0, tile).unwrap();
                }
                let receipt = g.rent_receipt.as_ref().unwrap();
                assert!(!receipt.waived && receipt.due > 0);
                assert_eq!(receipt.covered, 1);
                assert_eq!(g.bonuses[tile], 0);
                assert_eq!(g.players[0].cash, 1500 - receipt.paid);
                assert_eq!(g.players[1].cash, 1500 + receipt.due);
            }
        }
    }

    #[test]
    fn exact_tables_price_every_build_gain_and_salvage() {
        let mut r = classic_rules();
        r["development"]["policy"] = "district".into();
        r["development"]["levels"] = serde_json::json!([
            {"label":"1 house"},{"label":"2 houses"},{"label":"3 houses"},{"label":"4 houses"},{"label":"Hotel"}
        ]);
        r["tiles"][3]["build_costs"][4] = 79.into();
        let mut g = game(r, 1);
        for i in [1, 3] {
            g.owners[i] = Some(0);
        }
        g.refresh();
        for (cost, gain) in [(100, 24), (100, 60), (100, 190), (100, 200), (129, 220)] {
            let q = &g.builds[0];
            assert_eq!((&q.tiles[..], q.cost, q.gain), (&[1, 3][..], cost, gain));
            let cash = g.players[0].cash;
            g.apply(Command::Build { actor: 0, tile: 1 }).unwrap();
            assert_eq!(g.players[0].cash, cash - cost);
        }
        assert_eq!((g.rents[1], g.rents[3]), (240, 460));
        g.players[0].cash = 0;
        g.charge(50, None);
        g.refresh();
        assert_eq!(g.salvages[0].price, 65);
        g.apply(Command::Salvage { actor: 0, tile: 1 }).unwrap();
        assert_eq!((g.rents[1], g.rents[3], g.players[0].cash), (150, 330, 15));
    }

    #[test]
    fn utilities_charge_this_roll_not_the_previous_snapshot() {
        let mut r = classic_rules();
        r["tiles"][0] = serde_json::json!({"kind":"works","cost_pct":50,"bonus_pct":100});
        let mut g = game(r, 10);
        g.owners[12] = Some(1);
        g.owners[27] = Some(0);
        g.players[0].pos = 10;
        g.refresh();
        assert_eq!(g.rents[12], 0);
        let cash = g.players[0].cash;
        g.apply(Command::Roll { actor: 0 }).unwrap(); // 1 + 1
        assert_eq!(
            (g.rents[12], g.rents[27], g.players[0].cash),
            (8, 8, cash - 8)
        );
        g.apply(Command::End { actor: 0 }).unwrap();
        g.owners[27] = Some(1);
        g.players[0].pos = 5;
        g.refresh();
        assert_eq!(g.rents[12], 20);
        g.apply(Command::Roll { actor: 0 }).unwrap(); // 2 + 5
        assert_eq!(
            (g.rents[12], g.rents[27], g.players[1].cash),
            (70, 70, cash + 78)
        );
        g.apply(Command::End { actor: 0 }).unwrap();
        assert!(g.apply(Command::Build { actor: 1, tile: 12 }).is_err());
        g.land(1, 0).unwrap();
        g.refresh();
        assert!(g.apply(Command::Commission { actor: 1, tile: 27 }).is_err());
    }

    #[test]
    fn exact_salary_percentage_tax_and_no_auction_on_pass() {
        let mut g = game(classic_rules(), 10);
        let cash = g.players[0].cash;
        g.players[0].pos = 38;
        g.apply(Command::Roll { actor: 0 }).unwrap();
        assert_eq!((g.players[0].pos, g.players[0].cash), (0, cash + 300));
        g.apply(Command::End { actor: 0 }).unwrap();
        g.players[0].pos = 38;
        g.apply(Command::Roll { actor: 0 }).unwrap(); // passes Start, lands at 5
        assert_eq!((g.players[0].pos, g.players[0].cash), (5, cash + 500));
        g.apply(Command::Pass { actor: 0 }).unwrap();
        assert!(g.phase == Phase::End && g.auction.is_none() && g.owners[5].is_none());
        for (before, tax) in [(14, 1), (15, 2), (i32::MAX, 214_748_365)] {
            g.players[0].cash = before;
            g.land(0, 4).unwrap();
            assert_eq!(g.players[0].cash, before - tax);
        }
    }

    #[test]
    fn third_double_sends_to_prison_and_last_failed_attempt_ends_the_turn() {
        let mut r = classic_rules();
        r.as_object_mut().unwrap().remove("prison_entry"); // infer the sending rest
        let mut g = game(r, 75);
        let cash = g.players[0].cash;
        g.players[0].pos = 2;
        for (streak, pos) in [(1, 10), (2, 12)] {
            g.apply(Command::Roll { actor: 0 }).unwrap();
            assert_eq!((g.doubles_in_row, g.players[0].pos), (streak, pos));
            assert!(!g.players[0].in_prison); // ordinary visit to space 10
            if g.phase == Phase::Offer {
                g.apply(Command::Pass { actor: 0 }).unwrap();
            }
            g.apply(Command::End { actor: 0 }).unwrap();
            assert_eq!((g.turn, g.round), (0, 1));
        }
        g.players[0].pos = 39; // third double must NOT cross Start
        g.apply(Command::Roll { actor: 0 }).unwrap();
        assert_eq!(
            (g.players[0].pos, g.players[0].skip_turns, g.players[0].cash),
            (10, 3, cash)
        );
        for left in [2, 1, 0] {
            g.apply(Command::End { actor: 0 }).unwrap();
            assert_eq!(g.turn, 1);
            g.land(1, 10).unwrap();
            g.apply(Command::End { actor: 1 }).unwrap();
            g.seed = 1; // 4 + 2
            g.apply(Command::Roll { actor: 0 }).unwrap();
            assert!(g.phase == Phase::End);
            assert_eq!(g.players[0].in_prison, left != 0);
            assert_eq!(
                (g.players[0].pos, g.players[0].skip_turns, g.players[0].cash),
                (10, left, cash)
            );
        }
    }

    #[test]
    fn detention_release_requires_a_double_or_explicit_spend_not_an_extra_roll() {
        let mut r = classic_rules();
        for tile in r["tiles"].as_array_mut().unwrap() {
            if tile.get("deck").is_some() {
                tile["deck"] = "Aid".into();
            }
        }
        r["named_cards"] = serde_json::json!([
            {"deck":"Aid","title":"Receipt","kind":"cash","amount":0},
            {"deck":"Aid","title":"Release","kind":"pardon"}
        ]);
        for release in ["roll", "bail", "pardon"] {
            let mut g = game(r.clone(), 10);
            if release == "pardon" {
                for _ in 0..2 {
                    if g.players[0].pardons == 0 {
                        g.land(0, 2).unwrap();
                    }
                }
                assert_eq!(g.players[0].pardons, 1);
            }
            g.land(0, 30).unwrap();
            assert!(g.players[0].in_prison);
            g.apply(Command::End { actor: 0 }).unwrap();
            g.land(1, 10).unwrap();
            g.apply(Command::End { actor: 1 }).unwrap();
            match release {
                "roll" => {
                    g.seed = 10;
                    g.apply(Command::Roll { actor: 0 }).unwrap();
                    assert_eq!(g.players[0].pos, 12);
                    g.apply(Command::Pass { actor: 0 }).unwrap();
                }
                "bail" => {
                    g.players[0].cash = 49;
                    assert!(g.apply(Command::Bail { actor: 0 }).is_err());
                    assert!(g.apply(Command::Pardon { actor: 0 }).is_err());
                    g.players[0].cash = 50;
                    g.apply(Command::Bail { actor: 0 }).unwrap();
                    assert_eq!((g.players[0].cash, g.players[0].pos), (0, 10));
                }
                _ => {
                    g.apply(Command::Pardon { actor: 0 }).unwrap();
                    assert_eq!((g.players[0].pardons, g.players[0].pos), (0, 10));
                }
            }
            assert!(g.phase == Phase::End && !g.players[0].in_prison);
            assert_eq!(g.players[0].skip_turns, 0);
            g.apply(Command::End { actor: 0 }).unwrap();
            assert_eq!((g.turn, g.round), (1, 2));
        }
    }

    #[test]
    fn vacation_consumes_one_turn_and_respects_the_final_round() {
        for rounds in [2, 3] {
            let mut r = classic_rules();
            r["rounds"] = rounds.into();
            r["victory"] = "net_worth".into();
            let mut g = game(r, 10);
            g.players[0].pos = 18;
            g.apply(Command::Roll { actor: 0 }).unwrap();
            assert_eq!((g.doubles_in_row, g.players[0].skip_turns), (0, 1));
            g.apply(Command::End { actor: 0 }).unwrap();
            g.land(1, 10).unwrap();
            g.apply(Command::End { actor: 1 }).unwrap();
            assert_eq!((g.turn, g.round, g.players[0].skip_turns), (1, 2, 0));
            g.land(1, 10).unwrap();
            g.apply(Command::End { actor: 1 }).unwrap();
            assert_eq!(g.phase == Phase::Over, rounds == 2);
            if rounds == 3 {
                assert_eq!((g.turn, g.round), (0, 3));
            }
        }
    }

    #[test]
    fn incomplete_tables_or_partial_fallback_curves_fail_before_play() {
        let invalid = |r| Game::new(serde_json::from_value(r).unwrap(), 2, 1).is_err();
        let mut r = config();
        r["development"]["levels"][1]
            .as_object_mut()
            .unwrap()
            .remove("cost_pct");
        assert!(invalid(r));
        let mut r = config();
        r["development"]["levels"] = serde_json::json!([{"label":"Improved"}]);
        assert!(invalid(r)); // ordinary deeds still need a percentage curve
        let mut r = classic_rules();
        r["tiles"][1].as_object_mut().unwrap().remove("rent_levels");
        assert!(invalid(r)); // cost and rent overrides always travel together
    }

    #[test]
    fn reject_invalid_classic_tile_and_group_effects() {
        for (pointer, value) in [
            ("/tiles/1/build_costs", serde_json::json!([50])),
            ("/tiles/1/build_costs/4", 0.into()),
            ("/tiles/1/rent_levels/3", 90.into()),
            ("/tiles/1/rent_levels/0", 2.into()),
            ("/tiles/4/cash_tax_pct", 101.into()),
            ("/tiles/30/move_to", 40.into()),
            ("/prison_entry", 10.into()),
            ("/doubles_limit", 0.into()),
            ("/bail_cost", (-1).into()),
            ("/utility_multipliers/Companies", serde_json::json!([4])),
            ("/utility_multipliers/Companies/1", i32::MAX.into()),
            ("/tiles/12/rent", 4.into()),
        ] {
            let mut r = classic_rules();
            *r.pointer_mut(pointer).unwrap() = value;
            assert!(
                Game::new(serde_json::from_value(r).unwrap(), 2, 1).is_err(),
                "{pointer}"
            );
        }
    }

    #[test]
    fn two_networks_count_separately_and_leave_street_development_intact() {
        let mut r = config();
        r["network_fares"] = serde_json::json!({"Ferries":[25,55], "Trams":[15,40]});
        r["tiles"] = serde_json::json!([
            {"kind":"works","cost_pct":50,"bonus_pct":100},
            {"kind":"deed","group":"Ferries","price":180,"rent":25},
            {"kind":"deed","group":"Ferries","price":180,"rent":25},
            {"kind":"deed","group":"Trams","price":120,"rent":15},
            {"kind":"deed","group":"Trams","price":120,"rent":15},
            {"kind":"deed","group":"Street","price":80,"rent":20}
        ]);
        let mut g = Game::new(serde_json::from_value(r).unwrap(), 2, 1).unwrap();
        g.owners[1..].copy_from_slice(&[Some(0), Some(0), Some(0), Some(1), Some(0)]);
        g.refresh();
        assert_eq!(g.rents, [0, 55, 55, 15, 15, 40]);
        assert_eq!(g.builds.len(), 1);
        g.apply(Command::Build { actor: 0, tile: 5 }).unwrap();
        g.phase = Phase::Works;
        g.refresh();
        assert_eq!(g.commissions.len(), 1);
        g.apply(Command::Commission { actor: 0, tile: 5 }).unwrap();
        assert_eq!(g.rents, [0, 55, 55, 15, 15, 80]);
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
