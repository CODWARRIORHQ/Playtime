use keyring::Entry;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io, sync::Mutex, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::oneshot,
    task::JoinSet,
    time::timeout,
};
use url::{form_urlencoded, Url};
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.proyectosteam.dashboard";
const KEYRING_API_KEY: &str = "steam-web-api-key";
const STEAM_OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";
const STEAM_ID_PREFIX: &str = "https://steamcommunity.com/openid/id/";

#[derive(Default)]
struct SteamAuthState {
    pending: Mutex<Option<PendingSteamAuth>>,
}

struct PendingSteamAuth {
    receiver: Option<oneshot::Receiver<Result<String, String>>>,
    cancel: Option<oneshot::Sender<()>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamProfile {
    steam_id: String,
    name: String,
    avatar_url: String,
    profile_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamGame {
    app_id: u32,
    name: String,
    playtime_minutes: u64,
    playtime_two_weeks_minutes: u64,
    cover_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamAchievement {
    app_id: u32,
    game_name: String,
    name: String,
    description: String,
    unlocked_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnavailableAchievementGame {
    app_id: u32,
    game_name: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamDashboard {
    profile: SteamProfile,
    games: Vec<SteamGame>,
    achievements: Vec<SteamAchievement>,
    achievement_games_checked: usize,
    unavailable_achievement_games: Vec<UnavailableAchievementGame>,
    incomplete_achievement_metadata_games: usize,
}

#[derive(Deserialize)]
struct PlayerSummariesResponse {
    response: PlayerSummaries,
}

#[derive(Deserialize)]
struct PlayerSummaries {
    players: Vec<PlayerSummary>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSummary {
    steamid: String,
    personaname: String,
    avatarfull: String,
    profileurl: String,
}

#[derive(Deserialize)]
struct OwnedGamesResponse {
    response: OwnedGames,
}

#[derive(Deserialize)]
struct OwnedGames {
    games: Option<Vec<OwnedGame>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnedGame {
    appid: u32,
    name: Option<String>,
    #[serde(rename = "playtime_forever")]
    playtime_forever: u64,
    #[serde(rename = "playtime_2weeks")]
    playtime_2weeks: Option<u64>,
}

#[derive(Deserialize)]
struct PlayerAchievementsResponse {
    playerstats: PlayerStats,
}

#[derive(Deserialize)]
struct PlayerStats {
    achievements: Option<Vec<PlayerAchievement>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct PlayerAchievement {
    apiname: String,
    achieved: u8,
    unlocktime: Option<i64>,
}

#[derive(Deserialize)]
struct GameSchemaResponse {
    game: Option<GameSchema>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameSchema {
    available_game_stats: Option<AvailableGameStats>,
}

#[derive(Deserialize)]
struct AvailableGameStats {
    achievements: Option<Vec<AchievementSchema>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AchievementSchema {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
}

#[tauri::command]
fn start_steam_login(state: State<'_, SteamAuthState>) -> Result<String, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("No se pudo iniciar el acceso local a Steam: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("No se pudo preparar el acceso a Steam: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("No se pudo obtener el puerto local: {error}"))?
        .port();
    let callback_state = Uuid::new_v4().to_string();
    let return_to = format!("http://127.0.0.1:{port}/callback?state={callback_state}");

    let mut query = form_urlencoded::Serializer::new(String::new());
    query
        .append_pair("openid.ns", "http://specs.openid.net/auth/2.0")
        .append_pair("openid.mode", "checkid_setup")
        .append_pair("openid.return_to", &return_to)
        .append_pair("openid.realm", &format!("http://127.0.0.1:{port}/"))
        .append_pair(
            "openid.identity",
            "http://specs.openid.net/auth/2.0/identifier_select",
        )
        .append_pair(
            "openid.claimed_id",
            "http://specs.openid.net/auth/2.0/identifier_select",
        );
    let login_url = format!("{STEAM_OPENID_ENDPOINT}?{}", query.finish());

    let (sender, receiver) = oneshot::channel();
    let (cancel_sender, mut cancel_receiver) = oneshot::channel();
    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| "No se pudo preparar la conexión con Steam.".to_string())?;
        if pending.is_some() {
            return Err("Ya hay un inicio de sesión de Steam en curso.".to_string());
        }
        *pending = Some(PendingSteamAuth {
            receiver: Some(receiver),
            cancel: Some(cancel_sender),
        });
    }

    tauri::async_runtime::spawn(async move {
        let login_result = async {
            let listener = TcpListener::from_std(listener)
                .map_err(|error| format!("No se pudo preparar el acceso a Steam: {error}"))?;
            receive_steam_callback(listener, return_to, callback_state).await
        };
        let result = tokio::select! {
            result = login_result => result,
            _ = &mut cancel_receiver => Err("Inicio de sesión con Steam cancelado.".to_string()),
        };
        let _ = sender.send(result);
    });

    Ok(login_url)
}

#[tauri::command]
async fn finish_steam_login(state: State<'_, SteamAuthState>) -> Result<String, String> {
    let receiver = state
        .pending
        .lock()
        .map_err(|_| "No se pudo completar el inicio de sesión.".to_string())?
        .as_mut()
        .and_then(|pending| pending.receiver.take())
        .ok_or_else(|| "No hay un inicio de sesión de Steam pendiente.".to_string())?;

    let result = match receiver.await {
        Ok(result) => result,
        Err(_) => Err("Se interrumpió el inicio de sesión con Steam.".to_string()),
    };
    state
        .pending
        .lock()
        .map_err(|_| "No se pudo finalizar el inicio de sesión.".to_string())?
        .take();
    result
}

#[tauri::command]
fn cancel_steam_login(state: State<'_, SteamAuthState>) -> Result<(), String> {
    let pending = state
        .pending
        .lock()
        .map_err(|_| "No se pudo cancelar el inicio de sesión.".to_string())?
        .take()
        .ok_or_else(|| "No hay un inicio de sesión de Steam pendiente.".to_string())?;
    pending
        .cancel
        .ok_or_else(|| "El inicio de sesión de Steam ya había terminado.".to_string())?
        .send(())
        .map_err(|_| "El inicio de sesión de Steam ya había terminado.".to_string())
}

#[tauri::command]
fn save_steam_api_key(api_key: String) -> Result<(), String> {
    if api_key.len() != 32 || !api_key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("La clave de Steam debe tener 32 caracteres hexadecimales.".to_string());
    }

    api_key_entry()?.set_password(&api_key).map_err(|error| {
        format!("Windows no pudo guardar la clave de Steam de forma segura: {error}")
    })
}

#[tauri::command]
fn disconnect_steam() -> Result<(), String> {
    match api_key_entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "No se pudo eliminar la clave de Steam guardada: {error}"
        )),
    }
}

#[tauri::command]
fn has_steam_api_key() -> Result<bool, String> {
    match api_key_entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(format!(
            "Windows no pudo comprobar la clave guardada: {error}"
        )),
    }
}

#[tauri::command]
async fn steam_sync(steam_id: String) -> Result<SteamDashboard, String> {
    if steam_id.len() != 17 || !steam_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("El identificador de Steam no tiene un formato válido.".to_string());
    }

    let api_key = api_key_entry()?
        .get_password()
        .map_err(|error| match error {
            keyring::Error::NoEntry => {
                "Añade tu clave de Steam Web API en Ajustes para cargar tus datos.".to_string()
            }
            other => format!("Windows no pudo leer la clave guardada de Steam: {other}"),
        })?;
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Playtime/0.2.0")
        .build()
        .map_err(|error| format!("No se pudo preparar la conexión con Steam: {error}"))?;

    let player_response: PlayerSummariesResponse = client
        .get("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/")
        .query(&[("key", &api_key), ("steamids", &steam_id)])
        .send()
        .await
        .map_err(|_| {
            "No se pudo consultar tu perfil de Steam. Comprueba tu conexión a Internet.".to_string()
        })?
        .error_for_status()
        .map_err(|_| {
            "Steam rechazó la consulta del perfil. Comprueba que la clave de Web API sea válida."
                .to_string()
        })?
        .json()
        .await
        .map_err(|_| "Steam devolvió una respuesta de perfil no válida.".to_string())?;
    let player = player_response
        .response
        .players
        .into_iter()
        .next()
        .ok_or_else(|| "Steam no encontró el perfil de esa cuenta.".to_string())?;

    let owned_response: OwnedGamesResponse = client
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
        .query(&[
            ("key", api_key.as_str()),
            ("steamid", steam_id.as_str()),
            ("include_appinfo", "1"),
            ("include_played_free_games", "1"),
        ])
        .send()
        .await
        .map_err(|_| "No se pudo consultar tu biblioteca de Steam. Comprueba tu conexión a Internet.".to_string())?
        .error_for_status()
        .map_err(|_| "Steam rechazó la consulta de la biblioteca. Comprueba tu clave de Web API y la privacidad de los detalles de tus juegos.".to_string())?
        .json()
        .await
        .map_err(|_| "Steam devolvió una respuesta de biblioteca no válida.".to_string())?;
    let mut owned_games = owned_response.response.games.ok_or_else(|| {
        "Steam no ha compartido tu biblioteca. En tu perfil, pon en público los detalles de los juegos y vuelve a sincronizar.".to_string()
    })?;
    owned_games.sort_by(|left, right| right.playtime_forever.cmp(&left.playtime_forever));

    let games = owned_games
        .iter()
        .map(|game| SteamGame {
            app_id: game.appid,
            name: game
                .name
                .clone()
                .unwrap_or_else(|| format!("Juego {}", game.appid)),
            playtime_minutes: game.playtime_forever,
            playtime_two_weeks_minutes: game.playtime_2weeks.unwrap_or_default(),
            cover_url: format!(
                "https://cdn.akamai.steamstatic.com/steam/apps/{}/header.jpg",
                game.appid
            ),
        })
        .collect();
    let (
        achievements,
        achievement_games_checked,
        unavailable_achievement_games,
        incomplete_achievement_metadata_games,
    ) = fetch_achievements(&client, &api_key, &steam_id, &owned_games).await;

    Ok(SteamDashboard {
        profile: SteamProfile {
            steam_id: player.steamid,
            name: player.personaname,
            avatar_url: player.avatarfull,
            profile_url: player.profileurl,
        },
        games,
        achievements,
        achievement_games_checked,
        unavailable_achievement_games,
        incomplete_achievement_metadata_games,
    })
}

fn api_key_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_API_KEY)
        .map_err(|error| format!("No se pudo acceder al almacén seguro de Windows: {error}"))
}

async fn fetch_achievements(
    client: &Client,
    api_key: &str,
    steam_id: &str,
    owned_games: &[OwnedGame],
) -> (
    Vec<SteamAchievement>,
    usize,
    Vec<UnavailableAchievementGame>,
    usize,
) {
    let mut pending = JoinSet::new();
    let mut games = owned_games.iter();
    let mut achievements = Vec::new();
    let mut unavailable = Vec::new();
    let mut checked = 0;
    let mut incomplete_metadata = 0;

    loop {
        while pending.len() < 4 {
            let Some(game) = games.next() else {
                break;
            };
            let client = client.clone();
            let api_key = api_key.to_string();
            let steam_id = steam_id.to_string();
            let game = game.clone();
            pending.spawn(async move {
                fetch_game_achievements(&client, &api_key, &steam_id, game).await
            });
        }

        let Some(result) = pending.join_next().await else {
            break;
        };
        match result {
            Ok(Ok((game_achievements, metadata_incomplete))) => {
                achievements.extend(game_achievements);
                checked += 1;
                if metadata_incomplete {
                    incomplete_metadata += 1;
                }
            }
            Ok(Err(game)) => unavailable.push(game),
            Err(error) => {
                eprintln!("Falló la consulta de logros de una tarea: {error}");
            }
        }
    }

    achievements.sort_by(|left, right| right.unlocked_at.cmp(&left.unlocked_at));
    (achievements, checked, unavailable, incomplete_metadata)
}

async fn fetch_game_achievements(
    client: &Client,
    api_key: &str,
    steam_id: &str,
    game: OwnedGame,
) -> Result<(Vec<SteamAchievement>, bool), UnavailableAchievementGame> {
    let game_name = game
        .name
        .clone()
        .unwrap_or_else(|| format!("Juego {}", game.appid));
    let mut response = None;
    let mut failure_reason = "Steam no respondió a la consulta.".to_string();
    for attempt in 0..3 {
        match client
            .get("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/")
            .query(&[
                ("key", api_key),
                ("steamid", steam_id),
                ("appid", &game.appid.to_string()),
            ])
            .send()
            .await
        {
            Ok(result) if result.status().is_success() => {
                response = Some(result);
                break;
            }
            Ok(result)
                if !result.status().is_server_error()
                    && result.status().as_u16() != reqwest::StatusCode::TOO_MANY_REQUESTS =>
            {
                return Err(UnavailableAchievementGame {
                    app_id: game.appid,
                    game_name,
                    reason: format!("Steam respondió con HTTP {}.", result.status().as_u16()),
                });
            }
            Ok(result) => {
                failure_reason = format!("Steam respondió con HTTP {}.", result.status().as_u16());
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                }
            }
            Err(_) => {
                failure_reason = "No se pudo conectar con Steam.".to_string();
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                }
            }
        }
    }
    let Some(response) = response else {
        return Err(UnavailableAchievementGame {
            app_id: game.appid,
            game_name,
            reason: failure_reason,
        });
    };
    let response = response
        .json::<PlayerAchievementsResponse>()
        .await
        .map_err(|_| UnavailableAchievementGame {
            app_id: game.appid,
            game_name: game_name.clone(),
            reason: "Steam devolvió una respuesta de logros no válida.".to_string(),
        })?;
    if let Some(error) = response.playerstats.error {
        let message: String = error.trim().chars().take(180).collect();
        return Err(UnavailableAchievementGame {
            app_id: game.appid,
            game_name,
            reason: if message.is_empty() {
                "Steam indicó que las estadísticas de este juego no están disponibles.".to_string()
            } else {
                format!("Steam: {message}")
            },
        });
    }
    let unlocked: Vec<PlayerAchievement> = response
        .playerstats
        .achievements
        .ok_or_else(|| UnavailableAchievementGame {
            app_id: game.appid,
            game_name: game_name.clone(),
            reason: "La respuesta de Steam no incluyó la lista de logros.".to_string(),
        })?
        .into_iter()
        .filter(|achievement| achievement.achieved == 1)
        .collect();
    if unlocked.is_empty() {
        return Ok((Vec::new(), false));
    }

    let schema = client
        .get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/")
        .query(&[("key", api_key), ("appid", &game.appid.to_string())])
        .send()
        .await
        .and_then(reqwest::Response::error_for_status);
    let (schema, metadata_incomplete): (HashMap<String, String>, bool) = match schema {
        Ok(response) => match response.json::<GameSchemaResponse>().await {
            Ok(response) => match response
                .game
                .and_then(|game_schema| game_schema.available_game_stats)
                .and_then(|stats| stats.achievements)
            {
                Some(achievements) => (
                    achievements
                        .into_iter()
                        .map(|achievement| {
                            (
                                achievement.name,
                                format!(
                                    "{}\n{}",
                                    achievement.display_name.unwrap_or_default(),
                                    achievement.description.unwrap_or_default()
                                ),
                            )
                        })
                        .collect(),
                    false,
                ),
                None => (HashMap::new(), true),
            },
            Err(_) => (HashMap::new(), true),
        },
        Err(_) => (HashMap::new(), true),
    };
    let result = unlocked
        .into_iter()
        .map(|achievement| {
            let details = schema.get(&achievement.apiname);
            let (display_name, description) = details
                .map(|details| {
                    let (name, description) = details.split_once('\n').unwrap_or((details, ""));
                    (name.to_string(), description.to_string())
                })
                .unwrap_or_else(|| (achievement.apiname.clone(), String::new()));
            SteamAchievement {
                app_id: game.appid,
                game_name: game_name.clone(),
                name: if display_name.is_empty() {
                    achievement.apiname
                } else {
                    display_name
                },
                description,
                unlocked_at: achievement.unlocktime.and_then(|timestamp| {
                    if timestamp > 0 {
                        chrono::DateTime::from_timestamp(timestamp, 0)
                            .map(|date| date.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                    } else {
                        None
                    }
                }),
            }
        })
        .collect();
    Ok((result, metadata_incomplete))
}

async fn receive_steam_callback(
    listener: TcpListener,
    return_to: String,
    callback_state: String,
) -> Result<String, String> {
    let (mut stream, _) = timeout(Duration::from_secs(300), listener.accept())
        .await
        .map_err(|_| "Se agotó el tiempo de espera del inicio de sesión con Steam.".to_string())?
        .map_err(|error| format!("No se recibió la respuesta de Steam: {error}"))?;
    let mut request = Vec::with_capacity(4096);
    let mut chunk = [0; 2048];
    timeout(Duration::from_secs(10), async {
        loop {
            let bytes_read = stream.read(&mut chunk).await?;
            if bytes_read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..bytes_read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") || request.len() > 16_384 {
                break;
            }
        }
        Ok::<(), io::Error>(())
    })
    .await
    .map_err(|_| "Steam no respondió al retorno del inicio de sesión.".to_string())?
    .map_err(|error| format!("No se pudo leer la respuesta de Steam: {error}"))?;
    let request = std::str::from_utf8(&request)
        .map_err(|_| "Steam devolvió una respuesta de inicio de sesión no válida.".to_string())?;
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| {
            "Steam devolvió una solicitud de inicio de sesión incompleta.".to_string()
        })?;
    let callback = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| "La dirección de retorno de Steam no es válida.".to_string())?;
    let mut params = HashMap::new();
    for (key, value) in callback.query_pairs() {
        if params
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return Err("Steam devolvió parámetros duplicados en el inicio de sesión.".to_string());
        }
    }

    let response_body = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Playtime</title><body style=\"font-family:system-ui;background:#111115;color:#eee;padding:3rem\"><h2>Ya puedes volver a Playtime</h2><p>Esta ventana se puede cerrar.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_body.len(),
        response_body
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("No se pudo confirmar la respuesta de Steam: {error}"))?;

    if params.get("state") != Some(&callback_state) {
        return Err("La respuesta no coincide con el inicio de sesión solicitado.".to_string());
    }
    if params.get("openid.mode").map(String::as_str) != Some("id_res")
        || params.get("openid.return_to") != Some(&return_to)
        || params.get("openid.op_endpoint").map(String::as_str) != Some(STEAM_OPENID_ENDPOINT)
    {
        return Err("Steam no confirmó este inicio de sesión.".to_string());
    }
    let signed_fields: Vec<&str> = params
        .get("openid.signed")
        .ok_or_else(|| "Steam devolvió una confirmación incompleta.".to_string())?
        .split(',')
        .collect();
    if ["claimed_id", "identity", "return_to", "op_endpoint"]
        .iter()
        .any(|field| !signed_fields.contains(field))
    {
        return Err(
            "La respuesta de Steam no firma los datos de identidad necesarios.".to_string(),
        );
    }

    let claimed_id = params
        .get("openid.claimed_id")
        .and_then(|id| id.strip_prefix(STEAM_ID_PREFIX))
        .ok_or_else(|| "Steam devolvió un identificador de cuenta no válido.".to_string())?;
    if claimed_id.len() != 17 || !claimed_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Steam devolvió un identificador de cuenta no válido.".to_string());
    }
    if params.get("openid.identity") != params.get("openid.claimed_id") {
        return Err("La identidad de Steam no coincide con la cuenta devuelta.".to_string());
    }

    let mut verification: Vec<(String, String)> = params
        .iter()
        .filter(|(key, _)| key.starts_with("openid."))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let mode = verification
        .iter_mut()
        .find(|(key, _)| key == "openid.mode")
        .ok_or_else(|| "Steam devolvió una confirmación incompleta.".to_string())?;
    mode.1 = "check_authentication".to_string();

    let verification_response = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("No se pudo preparar la validación de Steam: {error}"))?
        .post(STEAM_OPENID_ENDPOINT)
        .form(&verification)
        .send()
        .await
        .map_err(|error| format!("No se pudo verificar la identidad con Steam: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Steam rechazó la verificación de identidad: {error}"))?
        .text()
        .await
        .map_err(|error| format!("No se pudo leer la verificación de Steam: {error}"))?;

    if !verification_response
        .lines()
        .any(|line| line.trim() == "is_valid:true")
    {
        return Err("Steam no pudo verificar la autenticidad de la sesión.".to_string());
    }
    Ok(claimed_id.to_string())
}

fn show_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("No se encontró la ventana principal de Playtime.");
        return;
    };
    if let Err(error) = window.show() {
        eprintln!("No se pudo mostrar Playtime desde la bandeja: {error}");
        return;
    }
    if let Err(error) = window.unminimize() {
        eprintln!("No se pudo restaurar la ventana de Playtime: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("No se pudo enfocar la ventana de Playtime: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .app_name("Playtime")
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SteamAuthState::default())
        .setup(|app| {
            if !cfg!(debug_assertions) {
                app.autolaunch().enable()?;
            }

            let open_item = MenuItem::with_id(app, "open", "Abrir Playtime", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| std::io::Error::other("No se encontró el icono de Playtime."))?;

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if std::env::args().any(|argument| argument == "--hidden") {
                let window = app.get_webview_window("main").ok_or_else(|| {
                    std::io::Error::other("No se encontró la ventana principal de Playtime.")
                })?;
                window.hide()?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("No se pudo ocultar Playtime en la bandeja: {error}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_steam_login,
            finish_steam_login,
            cancel_steam_login,
            save_steam_api_key,
            disconnect_steam,
            has_steam_api_key,
            steam_sync
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
