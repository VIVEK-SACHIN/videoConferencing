//! Mesh WebRTC signaling server.
//!
//! WebRTC peers can't find each other on their own — they need a "signaling
//! channel" to swap SDP offers/answers and ICE candidates before the direct
//! peer-to-peer connection forms. This server is exactly that channel: a dumb
//! relay. It never inspects the WebRTC payloads, it just shuttles them between
//! the peers sharing a room code.
//!
//! Topology is a full **mesh**: every participant opens a direct connection to
//! every other participant, so the server's only job is identity + targeted
//! routing. To stay glare-free, whoever is *already* in the room initiates the
//! offer to each newcomer (the server processes joins one at a time under its
//! mutex, giving a deterministic total order).
//!
//! Rooms are capped at 4 — mesh fan-out (each peer uploads its camera N-1
//! times) makes larger groups impractical without an SFU.
//!
//! Protocol (JSON text frames):
//!   client -> server : {"type":"join","room":"<code>","name":"<display>"}
//!   client -> server : {"type":"signal","to":<peerId>,"data": <opaque>}
//!   server -> client : {"type":"joined","you":<id>,"peers":[{"id":..,"name":..}]}
//!   server -> client : {"type":"peer-joined","id":<id>,"name":<name>}  (you initiate to them)
//!   server -> client : {"type":"signal","from":<id>,"data": <opaque>}  (relayed from a peer)
//!   server -> client : {"type":"peer-left","id":<id>}
//!   server -> client : {"type":"error","message":"<why>"}

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::mpsc;

/// Max participants per room. Mesh fan-out makes more than this impractical.
const MAX_PEERS: usize = 4;

/// Per-connection outbound message sender.
type Tx = mpsc::UnboundedSender<Message>;

/// What we track for each peer in a room: how to reach it + its display name.
struct PeerInfo {
    tx: Tx,
    name: String,
}

#[derive(Default)]
struct AppState {
    /// room code -> { client id -> peer info }
    rooms: Mutex<HashMap<String, HashMap<usize, PeerInfo>>>,
    next_id: AtomicUsize,
}

/// Messages we accept from clients.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientMsg {
    Join { room: String, name: String },
    /// `to` is the id of the peer this signal is destined for.
    Signal { to: usize, data: Value },
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState::default());

    let app = Router::new()
        // A plain GET so you can sanity-check the server is up in a browser.
        .route("/", get(|| async { "WebRTC mesh signaling server is running. Connect to /ws" }))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = "0.0.0.0:9000";
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("Signaling server listening on http://{addr}  (ws path: /ws)");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();

    // Each connection owns an mpsc channel. Anything pushed here gets written to
    // the socket by the send task below. This lets *other* connections deliver
    // messages to us without holding our socket directly.
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut current_room: Option<String> = None;

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        match serde_json::from_str::<ClientMsg>(&text) {
            Ok(ClientMsg::Join { room, name }) => {
                let mut rooms = state.rooms.lock().unwrap();
                let peers = rooms.entry(room.clone()).or_default();

                // Cap the mesh size.
                if peers.len() >= MAX_PEERS {
                    let _ = tx.send(text_frame(json!({"type":"error","message":"room is full"})));
                    continue;
                }

                // Snapshot the peers already here so the newcomer knows who to
                // expect offers from.
                let existing: Vec<Value> = peers
                    .iter()
                    .map(|(pid, info)| json!({"id": pid, "name": info.name}))
                    .collect();

                // Tell everyone already in the room that a new peer arrived.
                // Whoever receives "peer-joined" becomes the offer initiator
                // toward this newcomer.
                for info in peers.values() {
                    let _ = info
                        .tx
                        .send(text_frame(json!({"type":"peer-joined","id":id,"name":name})));
                }

                peers.insert(
                    id,
                    PeerInfo {
                        tx: tx.clone(),
                        name: name.clone(),
                    },
                );
                current_room = Some(room.clone());
                drop(rooms);

                let _ = tx.send(text_frame(
                    json!({"type":"joined","you":id,"peers":existing}),
                ));
                println!("client {id} ('{name}') joined room '{room}'");
            }

            Ok(ClientMsg::Signal { to, data }) => {
                if let Some(room) = &current_room {
                    let rooms = state.rooms.lock().unwrap();
                    if let Some(peers) = rooms.get(room) {
                        // Route only to the intended recipient, tagged with sender.
                        if let Some(target) = peers.get(&to) {
                            let frame = text_frame(json!({"type":"signal","from":id,"data":data}));
                            let _ = target.tx.send(frame);
                        }
                    }
                }
            }

            Err(_) => { /* ignore malformed frames */ }
        }
    }

    // --- cleanup on disconnect ---
    if let Some(room) = current_room {
        let mut rooms = state.rooms.lock().unwrap();
        if let Some(peers) = rooms.get_mut(&room) {
            peers.remove(&id);
            for info in peers.values() {
                let _ = info.tx.send(text_frame(json!({"type":"peer-left","id":id})));
            }
            if peers.is_empty() {
                rooms.remove(&room);
            }
        }
        println!("client {id} left room '{room}'");
    }
    send_task.abort();
}

fn text_frame(value: Value) -> Message {
    Message::Text(value.to_string())
}
