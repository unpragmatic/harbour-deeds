use serde::{Deserialize, Serialize};
use std::cell::RefCell;

#[derive(Deserialize)]
struct Rules {
    cash: i32,
    salary: i32,
    auction_increment: i32,
    rounds: usize,
    tiles: Vec<Tile>,
    notices: Vec<i32>,
}
#[derive(Deserialize)]
struct Tile {
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
    Start,
    Deed,
    Fee,
    Notice,
    Rest,
}
#[derive(Serialize, Default)]
struct Player {
    cash: i32,
    pos: usize,
    out: bool,
}
#[derive(Serialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Phase {
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
    #[serde(skip)]
    rules: Rules,
    #[serde(skip)]
    seed: u32,
    players: Vec<Player>,
    owners: Vec<Option<usize>>,
    turn: usize,
    round: usize,
    dice: [usize; 2],
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
            || rules.notices.is_empty()
            || rules.cash <= 0
            || rules.salary < 0
            || rules.auction_increment <= 0
            || rules.tiles.iter().any(|t| t.price < 0 || t.rent < 0)
        {
            return Err("Invalid game configuration");
        }
        Ok(Self {
            players: (0..seats)
                .map(|_| Player {
                    cash: rules.cash,
                    ..Default::default()
                })
                .collect(),
            owners: vec![None; rules.tiles.len()],
            rules,
            seed: seed.max(1),
            turn: 0,
            round: 1,
            dice: [0, 0],
            phase: Phase::Roll,
            auction: None,
            trade: None,
            traded: false,
            events: vec!["The table is open. All players begin at Port Office.".into()],
            winners: vec![],
        })
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
            for o in &mut self.owners {
                if *o == Some(a) {
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
            if deed.is_some_and(|i| self.owners.get(i) != Some(&Some(seat)))
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
            Command::Roll { actor } if actor == a && self.phase == Phase::Roll => {
                self.dice = [1 + self.random(6), 1 + self.random(6)];
                let path = i + self.dice.iter().sum::<usize>();
                let n = self.rules.tiles.len();
                let j = path % n;
                self.players[a].pos = j;
                self.phase = Phase::End;
                self.events.push(format!(
                    "Seat {} rolled {} + {}.",
                    a + 1,
                    self.dice[0],
                    self.dice[1]
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
                            let set = self
                                .rules
                                .tiles
                                .iter()
                                .enumerate()
                                .filter(|(_, t)| t.kind == Kind::Deed && t.group == tile.group)
                                .all(|(k, _)| self.owners[k] == Some(b));
                            let rent = tile.rent * if set { 2 } else { 1 };
                            self.events
                                .push(format!("Rent due to seat {}: ${rent}.", b + 1));
                            self.charge(rent, Some(b));
                        }
                        _ => {}
                    },
                    Kind::Fee => {
                        let fee = tile.price;
                        self.events.push(format!("Harbor dues: ${fee}."));
                        self.charge(fee, None)
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
