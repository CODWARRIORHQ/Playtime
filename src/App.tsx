import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";

type Page = "Inicio" | "Biblioteca" | "Logros" | "Estadísticas" | "Ajustes";
type LibraryGame = {
  appId: number;
  name: string;
  genre: string;
  hours: number;
  progress?: number;
  color: string;
  initials: string;
  status: string;
  iconUrl?: string;
};
type SteamDashboard = {
  profile: { steamId: string; name: string; avatarUrl: string; profileUrl: string };
  games: { appId: number; name: string; playtimeMinutes: number; playtimeTwoWeeksMinutes: number; iconUrl?: string }[];
  achievements: { appId: number; gameName: string; name: string; description: string; unlockedAt?: string }[];
  unavailableAchievementGames: number;
  incompleteAchievementMetadataGames: number;
};

function makeLibraryGames(data: SteamDashboard | null): LibraryGame[] {
  if (!data) {
    return games.map((game, index) => ({ ...game, appId: index }));
  }
  return data.games.map((game, index) => ({
    appId: game.appId,
    name: game.name,
    genre: "Juego de Steam",
    hours: Math.round((game.playtimeMinutes / 60) * 10) / 10,
    color: ["violet", "red", "green", "blue", "yellow", "pink"][index % 6],
    initials: game.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    status: game.playtimeTwoWeeksMinutes > 0 ? "Jugado en las últimas 2 semanas" : "Horas registradas en Steam",
    iconUrl: game.iconUrl,
  }));
}

function makeAchievements(data: SteamDashboard | null) {
  if (!data) return achievements;
  return data.achievements.map((achievement) => ({
    game: achievement.gameName,
    title: achievement.name,
    detail: achievement.description || "Logro desbloqueado",
    date: achievement.unlockedAt
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(achievement.unlockedAt))
      : "Fecha no disponible",
    mark: achievement.gameName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    color: ["violet", "red", "green", "blue", "yellow", "pink"][achievement.appId % 6],
  }));
}

const games = [
  { name: "Baldur's Gate 3", genre: "RPG · Larian Studios", hours: 184, progress: 78, color: "violet", initials: "BG3", status: "Última sesión: ayer" },
  { name: "Hades II", genre: "Acción · Supergiant Games", hours: 62, progress: 44, color: "red", initials: "H₂", status: "Última sesión: hoy" },
  { name: "Stardew Valley", genre: "Simulación · ConcernedApe", hours: 126, progress: 91, color: "green", initials: "SV", status: "Última sesión: hace 3 días" },
  { name: "Hollow Knight", genre: "Metroidvania · Team Cherry", hours: 48, progress: 65, color: "blue", initials: "HK", status: "Última sesión: hace 1 semana" },
  { name: "Cyberpunk 2077", genre: "RPG · CD PROJEKT RED", hours: 97, progress: 52, color: "yellow", initials: "2077", status: "Última sesión: hace 2 semanas" },
  { name: "Celeste", genre: "Plataformas · Maddy Makes Games", hours: 31, progress: 83, color: "pink", initials: "C", status: "Última sesión: hace 1 mes" },
];

const achievements = [
  { game: "Hades II", title: "Hasta la eternidad", detail: "Completa tu primera ruta", date: "Hoy", mark: "H₂", color: "red" },
  { game: "Baldur's Gate 3", title: "Héroe de los Reinos", detail: "Alcanza el nivel 12", date: "Ayer", mark: "BG3", color: "violet" },
  { game: "Stardew Valley", title: "Una granja completa", detail: "Completa el centro cívico", date: "12 oct", mark: "SV", color: "green" },
];

const navItems: { label: Page; icon: string }[] = [
  { label: "Inicio", icon: "home" },
  { label: "Biblioteca", icon: "library" },
  { label: "Logros", icon: "trophy" },
  { label: "Estadísticas", icon: "chart" },
];

const iconPaths: Record<string, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  library: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  trophy: <><path d="M8 21h8m-4-4v4m-6-17h12v5a6 6 0 0 1-12 0V4Z" /><path d="M6 6H3v2a4 4 0 0 0 4 4m11-6h3v2a4 4 0 0 1-4 4" /></>,
  chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.2a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1)" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  gamepad: <><path d="M6 12h4m-2-2v4m8-3h.01M18 13h.01" /><path d="M6.5 7h11a4 4 0 0 1 3.8 5l-1.1 4a2.5 2.5 0 0 1-4.2 1l-1.4-1.5h-5.2L8 17a2.5 2.5 0 0 1-4.2-1l-1.1-4a4 4 0 0 1 3.8-5Z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4.9 9A8 8 0 0 1 19 7l1 5M4 17v-5h5" /><path d="M19.1 15A8 8 0 0 1 5 17l-1-5" /></>,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {iconPaths[name]}
    </svg>
  );
}

function App() {
  const [page, setPage] = useState<Page>("Inicio");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [accent, setAccent] = useState(() => localStorage.getItem("steam-dashboard-accent") || "#a78bfa");
  const [compact, setCompact] = useState(() => localStorage.getItem("steam-dashboard-compact") === "true");
  const [steamId, setSteamId] = useState(() => localStorage.getItem("playtime-steam-id") || "");
  const [steamData, setSteamData] = useState<SteamDashboard | null>(null);
  const [steamKey, setSteamKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const libraryGames = useMemo(() => makeLibraryGames(steamData), [steamData]);
  const recentAchievements = useMemo(() => makeAchievements(steamData), [steamData]);
  const filteredGames = useMemo(
    () => libraryGames.filter((game) => game.name.toLowerCase().includes(query.trim().toLowerCase())),
    [libraryGames, query],
  );

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const keySaved = await invoke<boolean>("has_steam_api_key");
        setHasApiKey(keySaved);
        const savedSteamId = localStorage.getItem("playtime-steam-id");
        if (savedSteamId && keySaved) {
          setIsBusy(true);
          setSteamData(await invoke<SteamDashboard>("steam_sync", { steamId: savedSteamId }));
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setIsBusy(false);
      }
    })();
  }, []);

  function updateAccent(color: string) {
    setAccent(color);
    localStorage.setItem("steam-dashboard-accent", color);
  }

  function updateCompact(value: boolean) {
    setCompact(value);
    localStorage.setItem("steam-dashboard-compact", String(value));
  }

  async function syncSteam(id = steamId) {
    if (!id) {
      setNotice("Inicia sesión con Steam antes de sincronizar tu biblioteca.");
      return;
    }
    setIsBusy(true);
    setNotice("Sincronizando perfil, biblioteca, horas y logros de Steam…");
    try {
      setSteamData(await invoke<SteamDashboard>("steam_sync", { steamId: id }));
      setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function connectSteam() {
    if (!isTauri()) {
      setNotice("El inicio de sesión con Steam solo funciona en la aplicación de escritorio.");
      return;
    }
    setIsBusy(true);
    try {
      const loginUrl = await invoke<string>("start_steam_login");
      try {
        await openUrl(loginUrl);
      } catch (error) {
        await invoke("cancel_steam_login");
        throw error;
      }
      setLoginPending(true);
      const id = await invoke<string>("finish_steam_login");
      setLoginPending(false);
      localStorage.setItem("playtime-steam-id", id);
      setSteamId(id);
      setSteamData(null);
      setPage("Ajustes");
      setNotice(hasApiKey
        ? "Steam confirmó tu cuenta. Actualizando biblioteca y logros…"
        : "Steam confirmó tu cuenta. Añade tu clave de Web API en esta pantalla para cargar tus datos.");
      if (hasApiKey) {
        setSteamData(await invoke<SteamDashboard>("steam_sync", { steamId: id }));
        setNotice("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice(message.includes("cancelado") ? "Inicio de sesión con Steam cancelado." : message);
    } finally {
      setLoginPending(false);
      setIsBusy(false);
    }
  }

  async function cancelSteamLogin() {
    try {
      await invoke("cancel_steam_login");
      setLoginPending(false);
      setIsBusy(false);
      setNotice("Inicio de sesión con Steam cancelado.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveSteamKey() {
    if (!isTauri()) {
      setNotice("Guarda la clave desde la aplicación de escritorio para protegerla con Windows.");
      return;
    }
    setIsBusy(true);
    try {
      await invoke("save_steam_api_key", { apiKey: steamKey.trim() });
      setSteamKey("");
      setHasApiKey(true);
      if (steamId) {
        setNotice("Clave guardada. Sincronizando tu perfil, biblioteca y logros…");
        setSteamData(await invoke<SteamDashboard>("steam_sync", { steamId }));
        setNotice("");
      } else {
        setNotice("Clave guardada de forma segura. Ahora inicia sesión con Steam.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function disconnectSteam() {
    if (!isTauri()) return;
    setIsBusy(true);
    try {
      await invoke("disconnect_steam");
      localStorage.removeItem("playtime-steam-id");
      setSteamId("");
      setSteamData(null);
      setHasApiKey(false);
      setNotice("Se eliminó la clave de API guardada en Windows y se desconectó la cuenta.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function openSteamApiKeyPage() {
    try {
      await openUrl("https://steamcommunity.com/dev/apikey");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkForAppUpdate() {
    if (!isTauri()) {
      setNotice("La búsqueda de actualizaciones solo funciona en la aplicación de escritorio.");
      return;
    }

    setIsCheckingUpdate(true);
    setNotice("Buscando actualizaciones de Playtime…");
    try {
      const update = await check({ timeout: 20_000 });
      if (!update) {
        setNotice("Ya tienes la versión más reciente de Playtime.");
        return;
      }

      setNotice(`Descargando Playtime ${update.version}…`);
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setNotice(`Descargando Playtime ${update.version}…`);
        }
      });
      setNotice("Actualización descargada. El instalador de Windows va a reiniciar Playtime.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  return (
    <main className={`app-shell${compact ? " compact" : ""}`} style={{ "--accent": accent } as React.CSSProperties}>
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("Inicio"); }}>
          <span className="brand-mark"><Icon name="gamepad" size={21} /></span>
          <span className="brand-name">playtime<span>.</span></span>
        </a>

        <div className="sidebar-caption">TU ESPACIO</div>
        <nav className="main-nav" aria-label="Navegación principal">
          {navItems.map((item) => (
            <button className={`nav-item${page === item.label ? " active" : ""}`} key={item.label} onClick={() => setPage(item.label)}>
              <Icon name={item.icon} /><span>{item.label}</span>
              {item.label === "Logros" && <span className="nav-count">{steamData ? recentAchievements.length.toLocaleString("es-ES") : "12"}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-caption sidebar-caption-spaced">PERSONALIZACIÓN</div>
        <button className={`nav-item${page === "Ajustes" ? " active" : ""}`} onClick={() => setPage("Ajustes")}>
          <Icon name="settings" /><span>Ajustes</span>
        </button>

        <div className="sidebar-spacer" />
        <div className="profile-card">
          {steamData ? <img className="profile-avatar" src={steamData.profile.avatarUrl} alt="" /> : <div className="profile-avatar">P</div>}
          <div className="profile-details"><strong>{steamData?.profile.name || "Jugador"}</strong><span>{steamData ? "Steam conectado" : "Modo demostración"}</span></div>
          <span className="status-dot" title={steamData ? "Steam conectado" : "Modo demostración"} />
        </div>
        <div className="sidebar-footer">HECHO PARA JUGADORES <span>♥</span></div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumb">PLAYTIME <Icon name="chevron" size={13} /><span>{page.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input aria-label="Buscar juego" placeholder="Buscar en tu biblioteca..." value={query} onChange={(event) => setQuery(event.target.value)} />
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button notification-button" aria-label="Notificaciones" onClick={() => setNotice("No tienes notificaciones nuevas.")}><Icon name="bell" /></button>
            <button className={`icon-button update-button${isCheckingUpdate ? " checking" : ""}`} aria-label="Buscar actualizaciones" title="Buscar actualizaciones" onClick={() => void checkForAppUpdate()} disabled={isCheckingUpdate}><Icon name="refresh" /><span className="sr-only">{isCheckingUpdate ? "Buscando actualización" : "Buscar actualizaciones"}</span></button>
            <button className="connect-button" onClick={() => loginPending ? void cancelSteamLogin() : void connectSteam()} disabled={isBusy && !loginPending}><span className="steam-symbol">S</span> {loginPending ? "Cancelar inicio" : isBusy ? steamId ? "Sincronizando…" : "Conectando…" : steamData ? "Steam conectado" : "Conectar Steam"}</button>
          </div>
        </header>

        {notice && <div className="notice" role="status">{notice}<button aria-label="Cerrar aviso" onClick={() => setNotice("")}>×</button></div>}

        <div className="content">
          {page === "Inicio" && <Dashboard onNavigate={setPage} onConnect={() => void connectSteam()} games={libraryGames} achievements={recentAchievements} steamData={steamData} isBusy={isBusy} onSync={() => void syncSteam()} />}
          {page === "Biblioteca" && <Library games={filteredGames} query={query} />}
          {page === "Logros" && <Achievements data={steamData} items={recentAchievements} />}
          {page === "Estadísticas" && <Statistics data={steamData} games={libraryGames} />}
          {page === "Ajustes" && <Settings accent={accent} compact={compact} onAccentChange={updateAccent} onCompactChange={updateCompact} steamId={steamId} steamData={steamData} apiKey={steamKey} hasApiKey={hasApiKey} isBusy={isBusy} loginPending={loginPending} onApiKeyChange={setSteamKey} onSaveApiKey={() => void saveSteamKey()} onConnect={() => void connectSteam()} onCancelLogin={() => void cancelSteamLogin()} onSync={() => void syncSteam()} onDisconnect={() => void disconnectSteam()} onOpenApiKeyPage={() => void openSteamApiKeyPage()} />}
          <footer className="demo-disclaimer">{steamData ? "DATOS DE STEAM · Según la visibilidad de tu perfil y los datos disponibles en Steam." : "VISTA DE DEMOSTRACIÓN · Los datos son ilustrativos y no proceden de una cuenta de Steam."}</footer>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  onNavigate,
  onConnect,
  onSync,
  games: library,
  achievements: unlockedAchievements,
  steamData,
  isBusy,
}: {
  onNavigate: (page: Page) => void;
  onConnect: () => void;
  onSync: () => void;
  games: LibraryGame[];
  achievements: ReturnType<typeof makeAchievements>;
  steamData: SteamDashboard | null;
  isBusy: boolean;
}) {
  const favorite = library[0];
  const totalMinutes = steamData?.games.reduce((total, game) => total + game.playtimeMinutes, 0) ?? 0;
  const totalHours = Math.floor(totalMinutes / 60);
  const playedGames = steamData?.games.filter((game) => game.playtimeMinutes > 0).length ?? 0;
  const playedPercent = steamData?.games.length ? Math.round((playedGames / steamData.games.length) * 100) : 0;
  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="live-dot" /> TU RESUMEN DE JUEGO</div>
          <h1>Tu mundo, <span>en juego.</span></h1>
          <p className="welcome-copy">{steamData ? `Hola, ${steamData.profile.name}. Aquí está tu biblioteca de Steam.` : "Todo lo que has jugado, en un mismo lugar."}</p>
        </div>
        {steamData && <button className="period-button" onClick={onSync} disabled={isBusy}><span className="period-dot" /> {isBusy ? "Sincronizando…" : "Actualizar Steam"} <Icon name="chevron" size={14} /></button>}
      </section>

      <section className="stats-grid" aria-label="Resumen de actividad">
        <StatCard icon="gamepad" label="JUEGOS EN BIBLIOTECA" value={steamData ? library.length.toLocaleString("es-ES") : "248"} change={steamData ? `${playedGames.toLocaleString("es-ES")} con horas jugadas` : "+12 este mes"} tone="purple" />
        <StatCard icon="clock" label="HORAS JUGADAS" value={steamData ? totalHours.toLocaleString("es-ES") : "1,284"} change={steamData ? "tiempo total registrado" : "+36 esta semana"} tone="blue" />
        <StatCard icon="trophy" label="LOGROS DESBLOQUEADOS" value={steamData ? unlockedAchievements.length.toLocaleString("es-ES") : "1,092"} change={steamData ? "en juegos con estadísticas disponibles" : "+8 este mes"} tone="gold" />
        <StatCard icon="chart" label={steamData ? "BIBLIOTECA JUGADA" : "COMPLETADO"} value={steamData ? `${playedPercent}%` : "34.8%"} change={steamData ? `${playedGames} de ${library.length} juegos` : "de tu biblioteca"} tone="green" />
      </section>

      <section className="dashboard-grid">
        <div className="panel playtime-panel">
          <PanelHeading title="Tiempo de juego" subtitle={steamData ? "Horas totales registradas por juego" : "Tu actividad durante esta semana"} action={steamData ? undefined : "Esta semana"} />
          <div className="chart-total"><strong>{steamData ? totalHours.toLocaleString("es-ES") : "36"}<span>h</span>{!steamData && <> 24<span>m</span></>}</strong>{steamData && <span className="chart-growth">{library.length} juegos</span>}{!steamData && <span className="chart-growth">↗ 18.6%</span>}</div>
          {steamData ? <div className="steam-hours-list">
            {library.slice(0, 5).map((game) => <div className="steam-hours-row" key={game.appId}><span>{game.name}</span><div className="progress-track"><span style={{ width: `${favorite?.hours ? Math.max(3, (game.hours / favorite.hours) * 100) : 0}%` }} /></div><strong>{game.hours.toLocaleString("es-ES")} h</strong></div>)}
            {!library.length && <div className="empty-chart">Steam no ha devuelto juegos con horas jugadas.</div>}
          </div> : <div className="chart-area" role="img" aria-label="Gráfico de horas jugadas de lunes a domingo">
            <div className="chart-y-labels"><span>12h</span><span>8h</span><span>4h</span><span>0h</span></div>
            <div className="chart-plot">
              <div className="chart-grid-lines"><i /><i /><i /><i /></div>
              <svg className="chart-svg" viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true">
                <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".27" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
                <path d="M0 118 C35 112 46 103 86 108 S142 130 172 98 S228 83 258 91 S315 105 344 63 S401 67 430 76 S485 38 516 50 S565 25 600 18 V150 H0Z" fill="url(#chartFill)" />
                <path d="M0 118 C35 112 46 103 86 108 S142 130 172 98 S228 83 258 91 S315 105 344 63 S401 67 430 76 S485 38 516 50 S565 25 600 18" fill="none" stroke="var(--accent)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                <circle cx="600" cy="18" r="5" fill="var(--accent)" stroke="#17171d" strokeWidth="3" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="chart-days"><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span></div>
            </div>
          </div>}
          {!steamData && <div className="chart-legend"><span><i className="legend-dot" /> Horas jugadas</span><span>Actualizado hace un momento</span></div>}
        </div>

        <div className="panel favorite-panel">
          <PanelHeading title="Tu juego favorito" subtitle="El que siempre te hace volver" />
          <div className={`favorite-cover${favorite?.iconUrl ? " favorite-cover-image" : " cover-violet"}`} style={favorite?.iconUrl ? { backgroundImage: `linear-gradient(#11111566, #111115aa), url("${favorite.iconUrl.replace(/"/g, "")}")` } : undefined}>{steamData ? <span className="favorite-live-title">{favorite?.name || "Aún sin juegos"}</span> : <><span className="cover-orbit orbit-one" /><span className="cover-orbit orbit-two" /><span className="cover-title">BALDUR'S<br /><b>GATE III</b></span><span className="cover-year">FORGET THE RULES</span></>}</div>
          <div className="favorite-info"><div><span className="muted-label">MÁS JUGADO</span><h3>{steamData ? favorite?.name || "Sin datos de juego" : "Baldur's Gate 3"}</h3><p>{steamData ? "Según las horas registradas" : "RPG · Aventura narrativa"}</p></div><span className="favorite-hours">{steamData ? favorite?.hours.toLocaleString("es-ES") ?? "0" : "184"} <small>horas</small></span></div>
          <button className="text-link" onClick={() => onNavigate("Biblioteca")}>Ver en biblioteca <Icon name="arrow" size={14} /></button>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel library-panel">
          <PanelHeading title="Seguir jugando" subtitle={steamData ? "Tus juegos con más horas" : "Tus juegos más recientes"} action="Ver biblioteca" onAction={() => onNavigate("Biblioteca")} />
          <div className="recent-list">
          {library.slice(0, 3).map((game) => <GameRow game={game} key={game.appId} />)}
          </div>
        </div>
        <div className="panel achievements-panel">
          <PanelHeading title="Últimos logros" subtitle="Pequeñas grandes victorias" action="Ver todos" onAction={() => onNavigate("Logros")} />
          <div className="achievement-list">
            {unlockedAchievements.slice(0, 2).map((item) => (
              <div className="achievement-row" key={item.title}>
                <div className={`achievement-mark cover-${item.color}`}>{item.mark}</div>
                <div className="achievement-copy"><strong>{item.title}</strong><span>{item.game} · {item.detail}</span></div>
                <span className="achievement-date">{item.date}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      {!steamData && <section className="connect-banner">
        <div className="banner-icon"><Icon name="gamepad" size={22} /></div>
        <div><strong>¿Listo para ver tus estadísticas reales?</strong><span>Conecta Steam y descubre tu historia de juego.</span></div>
        <button onClick={onConnect}>Conectar cuenta <Icon name="arrow" size={14} /></button>
      </section>}
    </>
  );
}

function StatCard({ icon, label, value, change, tone }: { icon: string; label: string; value: string; change: string; tone: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon} size={18} /></div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-change">{change}</span></div>;
}

function PanelHeading({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action && <button className="panel-action" onClick={onAction}>{action}{onAction && <Icon name="chevron" size={13} />}</button>}</div>;
}

function GameRow({ game }: { game: LibraryGame }) {
  return (
    <div className="game-row">
      {game.iconUrl ? <img className="game-cover" src={game.iconUrl} alt="" /> : <div className={`game-cover cover-${game.color}`}><span>{game.initials}</span></div>}
      <div className="game-row-main"><div className="game-title-line"><strong>{game.name}</strong><span>{game.hours} h</span></div><div className="game-meta">{game.status}</div>{game.progress !== undefined && <div className="progress-track"><span style={{ width: `${game.progress}%` }} /></div>}</div>
    </div>
  );
}

function Library({ games: visibleGames, query }: { games: LibraryGame[]; query: string }) {
  return (
    <>
      <PageHeading eyebrow="TU COLECCIÓN" title="Biblioteca" description="Todos tus mundos, aventuras y horas de juego." />
      <div className="library-toolbar"><span>{visibleGames.length.toLocaleString("es-ES")} juegos <span className="toolbar-separator">·</span> Ordenados por horas jugadas</span><button className="filter-button"><Icon name="filter" size={16} /> Filtrar</button></div>
      {visibleGames.length ? <div className="library-grid">{visibleGames.map((game) => <div className="library-card" key={game.appId}><div className={`library-art cover-${game.color}`} style={game.iconUrl ? { backgroundImage: `linear-gradient(#11111555, #111115bb), url("${game.iconUrl.replace(/"/g, "")}")` } : undefined}><span>{game.iconUrl ? "" : game.initials}</span><small>{game.genre.split(" · ")[0].toUpperCase()}</small></div><div className="library-card-info"><strong>{game.name}</strong><span>{game.hours.toLocaleString("es-ES")} horas jugadas</span>{game.progress !== undefined && <div className="progress-track"><span style={{ width: `${game.progress}%` }} /></div>}</div></div>)}</div> : <div className="empty-state"><Icon name="search" size={24} /><strong>{query ? `No encontramos “${query}”` : "No hay juegos para mostrar"}</strong><span>{query ? "Prueba con otro nombre de juego." : "Comprueba que tu biblioteca de Steam sea pública."}</span></div>}
    </>
  );
}

function Achievements({ data, items }: { data: SteamDashboard | null; items: ReturnType<typeof makeAchievements> }) {
  return (
    <>
      <PageHeading eyebrow="CADA LOGRO CUENTA" title="Logros" description="Celebra todo lo que has conseguido jugando." />
      <section className="stats-grid achievement-stats"><StatCard icon="trophy" label="LOGROS DESBLOQUEADOS" value={data ? items.length.toLocaleString("es-ES") : "1,092"} change={data ? "en juegos con estadísticas disponibles" : "en todos tus juegos"} tone="gold" /><StatCard icon="chart" label={data ? "JUEGOS JUGADOS" : "TASA COMPLETADO"} value={data ? data.games.filter((game) => game.playtimeMinutes > 0).length.toLocaleString("es-ES") : "34.8%"} change={data ? `${data.unavailableAchievementGames} sin datos · ${data.incompleteAchievementMetadataGames} sin nombres` : "+2.4% este mes"} tone="green" /><StatCard icon="gamepad" label="BIBLIOTECA" value={data ? data.games.length.toLocaleString("es-ES") : "6"} change={data ? "juegos consultados" : "juegos perfectos"} tone="purple" /><StatCard icon="clock" label="ÚLTIMO LOGRO" value={data ? items[0]?.date || "—" : "Hoy"} change={data ? items[0]?.game || "Sin logros desbloqueados" : "Hades II"} tone="blue" /></section>
      <div className="panel page-panel"><PanelHeading title="Desbloqueados recientemente" subtitle={data ? "Logros visibles en las estadísticas de tus juegos" : "Tus últimas victorias"} /><div className="achievement-list full-list">{items.length ? items.map((item, index) => <div className="achievement-row" key={`${item.game}-${item.title}-${index}`}><div className={`achievement-mark cover-${item.color}`}>{item.mark}</div><div className="achievement-copy"><strong>{item.title}</strong><span>{item.game} · {item.detail}</span></div><span className="achievement-date">{item.date}</span></div>) : <div className="empty-state"><Icon name="trophy" size={24} /><strong>{data ? "No encontramos logros desbloqueados" : "Todavía no hay conexión con Steam"}</strong><span>{data ? "Puede que tus estadísticas de juego sean privadas o que aún no haya logros." : "Conecta tu cuenta para consultar los logros disponibles."}</span></div>}</div></div>
    </>
  );
}

function Statistics({ data, games: library }: { data: SteamDashboard | null; games: LibraryGame[] }) {
  const hours = (data ? library : [...library].sort((left, right) => right.hours - left.hours)).slice(0, 5);
  const totalMinutes = data?.games.reduce((total, game) => total + game.playtimeMinutes, 0) ?? 0;
  const totalHours = Math.floor(totalMinutes / 60);
  const mostPlayed = hours[0];
  return (
    <>
      <PageHeading eyebrow="TUS NÚMEROS, TU HISTORIA" title="Estadísticas" description="Una mirada a cómo repartes tu tiempo entre mundos." />
      <section className="stats-grid"><StatCard icon="clock" label="TIEMPO TOTAL" value={`${(data ? totalHours : 1284).toLocaleString("es-ES")} h`} change="desde que empezaste" tone="blue" /><StatCard icon="gamepad" label="JUEGO MÁS LARGO" value={`${(mostPlayed?.hours ?? 184).toLocaleString("es-ES")} h`} change={mostPlayed?.name ?? "Baldur's Gate 3"} tone="purple" /><StatCard icon="chart" label="PROMEDIO SEMANAL" value={data ? "—" : "18.2 h"} change={data ? "Steam no ofrece este dato" : "+3.1 h esta semana"} tone="green" /><StatCard icon="trophy" label="LOGROS DESBLOQUEADOS" value={(data ? data.achievements.length : 146).toLocaleString("es-ES")} change={data ? "en estadísticas accesibles" : "en 23 juegos"} tone="gold" /></section>
      <section className="panel page-panel hours-panel"><PanelHeading title="Tus juegos más jugados" subtitle="Horas acumuladas en tu biblioteca" action="Ver biblioteca" /><div className="hours-list">{hours.map((game, index) => <div className="hours-row" key={game.appId}><span className="hours-rank">{String(index + 1).padStart(2, "0")}</span><strong>{game.name}</strong><div className="hours-track"><span className={`bar-${game.color}`} style={{ width: `${mostPlayed?.hours ? (game.hours / mostPlayed.hours) * 100 : 0}%` }} /></div><span className="hours-value">{game.hours.toLocaleString("es-ES")} h</span></div>)}</div></section>
    </>
  );
}

function Settings({
  accent,
  compact,
  onAccentChange,
  onCompactChange,
  steamId,
  steamData,
  apiKey,
  hasApiKey,
  isBusy,
  loginPending,
  onApiKeyChange,
  onSaveApiKey,
  onConnect,
  onCancelLogin,
  onSync,
  onDisconnect,
  onOpenApiKeyPage,
}: {
  accent: string;
  compact: boolean;
  onAccentChange: (color: string) => void;
  onCompactChange: (value: boolean) => void;
  steamId: string;
  steamData: SteamDashboard | null;
  apiKey: string;
  hasApiKey: boolean;
  isBusy: boolean;
  loginPending: boolean;
  onApiKeyChange: (value: string) => void;
  onSaveApiKey: () => void;
  onConnect: () => void;
  onCancelLogin: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenApiKeyPage: () => void;
}) {
  const colors = [{ name: "Lavanda", value: "#a78bfa" }, { name: "Azul", value: "#60a5fa" }, { name: "Verde", value: "#4ade80" }, { name: "Rosa", value: "#f472b6" }, { name: "Naranja", value: "#fb923c" }];
  return (
    <>
      <PageHeading eyebrow="A TU MANERA" title="Ajustes" description="Haz que Playtime se sienta como tu espacio." />
      <div className="settings-layout">
        <section className="panel settings-panel"><PanelHeading title="Apariencia" subtitle="Personaliza el aspecto de tu aplicación." />
          <div className="setting-row"><div><strong>Color de acento</strong><span>Elige el tono que resalta en la interfaz.</span></div><div className="color-options" role="group" aria-label="Color de acento">{colors.map((color) => <button key={color.value} className={`color-swatch${accent === color.value ? " selected" : ""}`} style={{ "--swatch": color.value } as React.CSSProperties} aria-label={color.name} aria-pressed={accent === color.value} onClick={() => onAccentChange(color.value)} />)}</div></div>
          <div className="setting-row"><div><strong>Interfaz compacta</strong><span>Reduce el espacio entre elementos.</span></div><button className={`toggle${compact ? " on" : ""}`} role="switch" aria-checked={compact} aria-label="Interfaz compacta" onClick={() => onCompactChange(!compact)}><span /></button></div>
          <div className="setting-row"><div><strong>Tema</strong><span>El tema oscuro está optimizado para jugar.</span></div><span className="theme-pill"><span /> Oscuro</span></div>
        </section>
        <section className="panel account-panel">
          <PanelHeading title="Steam" subtitle="Conecta tu cuenta y sincroniza tus datos públicos." />
          <div className="steam-account-content">
            <div className="steam-account-status">
              {steamData?.profile.avatarUrl ? <img className="steam-profile-avatar" src={steamData.profile.avatarUrl} alt="" /> : <div className="account-steam">S</div>}
              <div><strong>{steamData?.profile.name || (steamId ? "Cuenta de Steam vinculada" : "Aún no hay una cuenta conectada")}</strong><span>{steamId ? `Steam ID: ${steamId}` : "El inicio de sesión se verifica con Steam OpenID."}</span></div>
            </div>
            {!steamId && <button className="steam-action-button" onClick={loginPending ? onCancelLogin : onConnect} disabled={isBusy && !loginPending}><span className="steam-symbol">S</span> {loginPending ? "Cancelar inicio de sesión" : isBusy ? "Abriendo Steam…" : "Iniciar sesión con Steam"}</button>}
            <div className="api-key-section">
              <strong>Clave personal de Steam Web API</strong>
              <p>Necesaria para consultar biblioteca, horas y logros. Consíguela en Steam y usa <b>localhost</b> como dominio si te lo solicita.</p>
              <button className="api-key-link" onClick={onOpenApiKeyPage}>Abrir la página oficial para obtener la clave <Icon name="arrow" size={13} /></button>
              <label className="api-key-label" htmlFor="steam-api-key">{hasApiKey ? "Cambiar clave guardada" : "Pega aquí tu clave de 32 caracteres"}</label>
              <input id="steam-api-key" className="api-key-input" type="password" autoComplete="off" spellCheck={false} placeholder="••••••••••••••••••••••••••••••••" value={apiKey} onChange={(event) => onApiKeyChange(event.currentTarget.value)} />
              <button className="steam-action-button save-key-button" onClick={onSaveApiKey} disabled={isBusy || !apiKey.trim()}>{isBusy ? "Guardando y sincronizando…" : hasApiKey ? "Guardar clave nueva" : "Guardar clave y sincronizar"}</button>
              <span className="key-storage-note">La clave se guarda en el Administrador de credenciales de Windows. No se incluye en el instalador ni se envía a otro servidor.</span>
            </div>
            {hasApiKey && <div className="steam-account-actions"><button className="filter-button" onClick={onSync} disabled={isBusy}>{isBusy ? "Sincronizando…" : "Actualizar datos"}</button><button className="disconnect-button" onClick={onDisconnect} disabled={isBusy}>Desconectar y borrar clave</button></div>}
            <div className="steam-limitations">Solo se pueden leer datos que Steam expone y el perfil permite ver. Steam no ofrece el historial completo de compras en su Web API.</div>
          </div>
        </section>
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></section>;
}

export default App;
