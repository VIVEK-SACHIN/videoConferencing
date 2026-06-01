//! Minimal WebRTC signaling server.
//!
//! WebRTC peers can't find each other on their own — they need a "signaling
//! channel" to swap SDP offers/answers and ICE candidates before the direct
//! peer-to-peer connection forms. This server is exactly that channel: a dumb
//! relay. It never inspects the WebRTC payloads, it just shuttles them between
//! the (at most two) peers sharing a room code.
//!
//! Protocol (JSON text frames):
//!   client -> server : {"type":"join","room":"<code>"}
//!   client -> server : {"type":"signal","data": <opaque>}   (relayed to the peer)
//!   server -> client : {"type":"joined","peers":<n>}        (ack of your join)
//!   server -> client : {"type":"peer-joined"}               (a peer joined AFTER you -> you initiate)
//!   server -> client : {"type":"signal","data": <opaque>}   (relayed from the peer)
//!   server -> client : {"type":"peer-left"}
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

/// Per-connection outbound message sender.
type Tx = mpsc::UnboundedSender<Message>;

#[derive(Default)]
struct AppState {
    /// room code -> { client id -> sender }
    rooms: Mutex<HashMap<String, HashMap<usize, Tx>>>,
    next_id: AtomicUsize,
}

/// Messages we accept from clients.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientMsg {
    Join { room: String },
    Signal { data: Value },
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState::default());

    let app = Router::new()
        // A plain GET so you can sanity-check the server is up in a browser.
        .route("/", get(|| async { "WebRTC signaling server is running. Connect to /ws" }))
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
            Ok(ClientMsg::Join { room }) => {
                let mut rooms = state.rooms.lock().unwrap();
                let peers = rooms.entry(room.clone()).or_default();

                // Cap rooms at 2 for a 1:1 peer connection.
                if peers.len() >= 2 {
                    let _ = tx.send(text_frame(json!({"type":"error","message":"room is full"})));
                    continue;
                }

                // Tell everyone already in the room that a new peer arrived.
                // Whoever receives "peer-joined" becomes the offer initiator.
                for peer_tx in peers.values() {
                    let _ = peer_tx.send(text_frame(json!({"type":"peer-joined"})));
                }

                peers.insert(id, tx.clone());
                let count = peers.len();
                current_room = Some(room.clone());
                drop(rooms);

                let _ = tx.send(text_frame(json!({"type":"joined","peers":count})));
                println!("client {id} joined room '{}' ({count} peer(s))", room);
            }

            Ok(ClientMsg::Signal { data }) => {
                if let Some(room) = &current_room {
                    let rooms = state.rooms.lock().unwrap();
                    if let Some(peers) = rooms.get(room) {
                        let frame = text_frame(json!({"type":"signal","data":data}));
                        for (peer_id, peer_tx) in peers.iter() {
                            if *peer_id != id {
                                let _ = peer_tx.send(frame.clone());
                            }
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
            for peer_tx in peers.values() {
                let _ = peer_tx.send(text_frame(json!({"type":"peer-left"})));
            }
            if peers.is_empty() {
                rooms.remove(&room);
            }
        }
        println!("client {id} left room '{}'", room);
    }
    send_task.abort();
}

fn text_frame(value: Value) -> Message {
    Message::Text(value.to_string())
}
