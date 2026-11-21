use super::{Game, Kind, Phase, Rules};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize)]
pub(super) struct Entry {
    deck: String,
    title: String,
    #[serde(flatten)]
    effect: Effect,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Effect {
    Cash { amount: i32 },
    Each { amount: i32 },
    Repairs { house: i32, hotel: i32 },
    Advance { target: usize, salary: bool },
    Nearest { group: String, salary: bool },
    Steps { steps: i32 },
    Prison { entry: usize },
    Pardon,
}

#[derive(Default)]
pub(super) struct Piles {
    draws: BTreeMap<String, Vec<usize>>,
    cursors: BTreeMap<String, usize>,
    held: BTreeMap<usize, usize>,
    pending: BTreeMap<usize, i32>,
    resume_roll: Option<usize>,
}

#[derive(Serialize, Default)]
pub(super) struct Receipt {
    draws: Vec<Draw>,
}

#[derive(Serialize)]
struct Draw {
    card: usize,
    source: usize,
    event: usize,
    result: String,
    before: i32,
    after: i32,
}

fn destinations(r: &Rules, source: usize, effect: &Effect) -> Vec<usize> {
    let n = r.tiles.len();
    match effect {
        Effect::Advance { target, .. } => vec![*target],
        Effect::Nearest { group, .. } => (1..=n)
            .map(|k| (source + k) % n)
            .find(|&j| r.tiles[j].kind == Kind::Deed && &r.tiles[j].group == group)
            .into_iter()
            .collect(),
        Effect::Steps { steps } => {
            vec![(source as i64 + i64::from(*steps)).rem_euclid(n as i64) as usize]
        }
        _ => vec![],
    }
}

pub(super) fn validate(r: &Rules) -> Result<(), &'static str> {
    let decks: BTreeSet<_> = r.tiles.iter().filter_map(|t| t.deck.as_deref()).collect();
    if r.tiles
        .iter()
        .any(|t| t.deck.is_some() && t.kind != Kind::Notice)
        || decks.iter().any(|&deck| {
            deck.trim().is_empty()
                || !r
                    .named_cards
                    .iter()
                    .any(|c| c.deck == deck && !matches!(c.effect, Effect::Pardon))
        })
    {
        return Err("Notice needs a nonempty named deck");
    }
    let mut routes = vec![vec![]; r.tiles.len()];
    for c in &r.named_cards {
        if c.title.trim().is_empty()
            || !decks.contains(c.deck.as_str())
            || !match &c.effect {
                Effect::Cash { amount } | Effect::Each { amount } => amount.unsigned_abs() <= 10000,
                Effect::Repairs { house, hotel } => {
                    (0..=10000).contains(house) && (0..=10000).contains(hotel)
                }
                Effect::Advance { target, .. } => *target < r.tiles.len(),
                Effect::Prison { entry } => r
                    .tiles
                    .get(*entry)
                    .is_some_and(|t| t.move_to.is_some() && t.skip_turns.unwrap_or(0) > 0),
                Effect::Nearest { group, .. } => r
                    .tiles
                    .iter()
                    .any(|t| t.kind == Kind::Deed && t.group == *group),
                Effect::Steps { steps } => steps.unsigned_abs() as usize <= r.tiles.len(),
                Effect::Pardon => true,
            }
        {
            return Err("Invalid named card");
        }
        for (i, _) in r
            .tiles
            .iter()
            .enumerate()
            .filter(|(_, t)| t.deck.as_ref() == Some(&c.deck))
        {
            for j in destinations(r, i, &c.effect) {
                if r.tiles[j].deck.is_some() {
                    routes[i].push(j);
                }
            }
        }
    }
    // Redirects may draw a second card, but no designed route may loop forever.
    fn acyclic(i: usize, routes: &[Vec<usize>], marks: &mut [u8]) -> bool {
        if marks[i] != 0 {
            return marks[i] == 2;
        }
        marks[i] = 1;
        if !routes[i].iter().all(|&j| acyclic(j, routes, marks)) {
            return false;
        }
        marks[i] = 2;
        true
    }
    let mut marks = vec![0; routes.len()];
    if !(0..routes.len()).all(|i| acyclic(i, &routes, &mut marks)) {
        return Err("Named deck redirects form a cycle");
    }
    Ok(())
}

impl Game {
    pub(super) fn open_card_bill(&mut self) {
        if self.phase != Phase::Roll {
            return;
        }
        let a = self.turn;
        if let Some(bill) = self.piles.pending.remove(&a) {
            self.events.push(format!(
                "Seat {} settles an outstanding ${bill} card bill.",
                a + 1
            ));
            self.charge(bill, None);
            if self.phase == Phase::Debt {
                self.piles.resume_roll = Some(a);
            }
        }
    }

    pub(super) fn resume_after_card_bill(&mut self) {
        if self.piles.resume_roll.take() == Some(self.turn) {
            self.phase = Phase::Roll;
        }
    }

    pub(super) fn consume_pardon(&mut self, a: usize) -> bool {
        if let Some((&card, _)) = self.piles.held.iter().find(|(_, &owner)| owner == a) {
            self.piles.held.remove(&card);
            self.players[a].pardons -= 1;
            self.events.push(format!("Seat {} used a pardon.", a + 1));
            true
        } else {
            false
        }
    }

    pub(super) fn draw_named(&mut self, a: usize, j: usize) -> Result<(), &'static str> {
        let deck = self.rules.tiles[j]
            .deck
            .clone()
            .ok_or("Missing card deck")?;
        self.piles.held.retain(|_, owner| !self.players[*owner].out);
        if !self.piles.draws.contains_key(&deck) {
            let mut cards: Vec<_> = self
                .rules
                .named_cards
                .iter()
                .enumerate()
                .filter(|(_, c)| c.deck == deck)
                .map(|(k, _)| k)
                .collect();
            for k in (1..cards.len()).rev() {
                let other = self.random(k + 1);
                cards.swap(k, other);
            }
            self.piles.draws.insert(deck.clone(), cards);
        }
        let stack = &self.piles.draws[&deck];
        let cursor = self.piles.cursors.entry(deck).or_default();
        let card = loop {
            let k = stack[*cursor];
            *cursor = (*cursor + 1) % stack.len();
            if !self.piles.held.contains_key(&k) {
                break k;
            }
        };
        let c = self.rules.named_cards[card].clone();
        let before = self.players[a].cash;
        let mut dest = None;
        let result = match c.effect {
            Effect::Cash { amount } => {
                if amount < 0 {
                    self.charge(-amount, None);
                } else {
                    self.players[a].cash += amount;
                }
                if amount < 0 {
                    format!("Charged ${}.", -amount)
                } else {
                    format!("Received ${amount}.")
                }
            }
            Effect::Each { amount } => {
                let rivals: Vec<_> = (0..self.players.len())
                    .filter(|&b| b != a && !self.players[b].out)
                    .collect();
                let total = amount.abs() * rivals.len() as i32;
                if amount > 0 {
                    for b in rivals {
                        let paid = amount.min(self.players[b].cash);
                        self.players[b].cash -= paid;
                        if paid < amount {
                            *self.piles.pending.entry(b).or_default() += amount - paid;
                        }
                    }
                    self.players[a].cash += total;
                } else {
                    for b in rivals {
                        self.players[b].cash += -amount;
                    }
                    self.charge(total, None);
                }
                format!(
                    "{} ${total} across the table.",
                    if amount > 0 { "Collected" } else { "Charged" }
                )
            }
            Effect::Repairs { house, hotel } => {
                let mut fee: i64 = 0;
                for (i, _) in self
                    .owners
                    .iter()
                    .enumerate()
                    .filter(|(_, o)| **o == Some(a))
                {
                    let level = self.levels[i];
                    fee += if level > 0 && level == self.rules.development.levels.len() {
                        i64::from(hotel)
                    } else {
                        level as i64 * i64::from(house)
                    };
                }
                let fee = i32::try_from(fee).map_err(|_| "Repair bill overflow")?;
                self.charge(fee, None);
                format!("Repair bill: ${fee}.")
            }
            Effect::Pardon => {
                self.piles.held.insert(card, a);
                self.players[a].pardons += 1;
                "Pardon held. Redeem it on a prison turn.".into()
            }
            Effect::Prison { entry } => {
                self.send_to_prison(a, entry)?;
                "Sent to prison.".into()
            }
            ref effect => {
                let k = destinations(&self.rules, j, effect)[0];
                let crossed = match effect {
                    Effect::Advance { salary, .. } | Effect::Nearest { salary, .. } => {
                        *salary && k <= j
                    }
                    Effect::Steps { steps } => *steps > 0 && k <= j,
                    _ => false,
                };
                let reward = if !crossed {
                    0
                } else if k == 0 {
                    self.rules.salary_land.unwrap_or(self.rules.salary)
                } else {
                    self.rules.salary
                };
                self.players[a].cash += reward;
                self.players[a].pos = k;
                dest = Some(k);
                format!(
                    "Moved to space {k:02}.{}",
                    if reward > 0 {
                        format!(" Start paid ${reward}.")
                    } else {
                        String::new()
                    }
                )
            }
        };
        let event = self.events.len();
        self.events.push(format!("{}: {result}", c.title));
        self.card_receipt
            .get_or_insert_with(Default::default)
            .draws
            .push(Draw {
                card,
                source: j,
                event,
                result,
                before,
                after: self.players[a].cash,
            });
        if let Some(k) = dest {
            self.phase = Phase::End;
            self.land(a, k)?;
        }
        Ok(())
    }
}
