package com.jj.kartiseret

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.DialogProperties
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.*
import androidx.navigation.navArgument
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.CustomCredential
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.browser.customtabs.CustomTabsIntent
import coil.compose.AsyncImage
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64

private val canvas = Color(0xff212121)
private val surface = Color(0xff303030)
private val raised = Color(0xff393939)
private val LocalKartiseretAccent = compositionLocalOf { Color(0xffa66ae3) }
private val violet: Color @Composable get() = LocalKartiseretAccent.current
private val secondaryText = Color.White.copy(alpha = .68f)
private data class IncomingLinkIntent(val sequence: Long, val uri: Uri?)

class MainActivity : ComponentActivity() {
    private val incoming = androidx.compose.runtime.mutableStateOf<IncomingLinkIntent?>(null)
    private var incomingSequence = 0L
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        incoming.value = IncomingLinkIntent(++incomingSequence, intent?.data)
        setContent { KartiseretApp(incoming.value) }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incoming.value = IncomingLinkIntent(++incomingSequence, intent.data)
    }
}

@Composable
private fun KartiseretApp(incoming: IncomingLinkIntent?) {
    val vm: KartiseretViewModel = viewModel()
    val state by vm.state.collectAsState()
    val nav = rememberNavController()
    val context = LocalContext.current
    val backStack by nav.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route.orEmpty()
    val tab = when {
        currentRoute.startsWith("showtimes") -> AppTab.SHOWTIMES
        currentRoute.startsWith("cinematheques") || currentRoute.startsWith("cinema/") -> AppTab.CINEMATHEQUES
        currentRoute.startsWith("you") || currentRoute.startsWith("account/") -> AppTab.YOU
        else -> AppTab.DISCOVER
    }
    LaunchedEffect(incoming?.sequence) {
        val uri = incoming?.uri ?: return@LaunchedEffect
        val link = runCatching { java.net.URI(uri.toString()) }.getOrNull() ?: return@LaunchedEffect
        if (link.host == BuildConfig.APP_LINK_HOST) {
            vm.setLink(link)
            val route = parseIncomingLink(link, state.selectedCity)
            when (route) {
                is IncomingRoute.Tab -> nav.navigate(route.tab.route()) { launchSingleTop = true }
                is IncomingRoute.Catalog -> nav.navigate("catalog/${if (route.soon) "soon" else "now"}") { launchSingleTop = true }
                is IncomingRoute.Movie -> {
                    nav.navigate("discover") { popUpTo("discover") { inclusive = false }; launchSingleTop = true }
                }
                is IncomingRoute.Cinema -> nav.navigate("cinema/${Uri.encode(route.id)}")
                is IncomingRoute.Delete -> nav.navigate("account/delete")
                null -> android.widget.Toast.makeText(context, "This Kartiseret link is available on the website.", android.widget.Toast.LENGTH_SHORT).show()
            }
        }
    }

    LaunchedEffect(state.pendingMovieCode, state.allMovies, state.catalogLoaded) {
        val code = state.pendingMovieCode ?: return@LaunchedEffect
        val item = state.allMovies.firstOrNull { it.movieCode == code } ?: return@LaunchedEffect
        vm.consumePendingMovieLink()
        nav.navigate("movie/${item.tmdbId}") { launchSingleTop = true }
    }

    LaunchedEffect(state.pendingMovieCode, state.allMovies, state.catalogLoaded) {
        val code = state.pendingMovieCode ?: return@LaunchedEffect
        if (state.catalogLoaded && state.allMovies.none { it.movieCode == code }) vm.markPendingMovieLinkUnavailable()
    }

    val appAccent = remember(state.preferences.siteColor) {
        runCatching { Color(android.graphics.Color.parseColor(state.preferences.siteColor)) }.getOrDefault(Color(0xffa66ae3))
    }
    CompositionLocalProvider(LocalKartiseretAccent provides appAccent) {
    MaterialTheme(colorScheme = darkColorScheme(primary = appAccent, secondary = appAccent, background = canvas, surface = surface, onSurface = Color.White)) {
        Scaffold(
            containerColor = canvas,
            bottomBar = {
                if (currentRoute !in listOf("account/preferences", "account/alerts", "account/watches", "account/letterboxd", "account/security", "account/delete") && !currentRoute.startsWith("movie/") && !currentRoute.startsWith("cinema/")) {
                    NavigationBar(containerColor = Color(0xff181818)) {
                        listOf(AppTab.DISCOVER, AppTab.SHOWTIMES, AppTab.CINEMATHEQUES, AppTab.YOU).forEach { item ->
                            NavigationBarItem(
                                selected = tab == item,
                                onClick = { nav.navigate(item.route()) { launchSingleTop = true; restoreState = true; popUpTo("discover") { saveState = true } } },
                                icon = { Icon(item.icon(), contentDescription = item.label) },
                                label = { Text(item.label, maxLines = 1) }
                            )
                        }
                    }
                }
            }
        ) { insets ->
            NavHost(navController = nav, startDestination = "discover", modifier = Modifier.padding(insets)) {
        composable("discover") { DiscoverScreen(state, vm, openMovie = { nav.navigate("movie/${it.tmdbId}") }, openCatalog = { nav.navigate("catalog/$it") }) }
                composable("catalog/{mode}", arguments = listOf(navArgument("mode") { type = NavType.StringType })) { entry ->
                    CatalogScreen(entry.arguments?.getString("mode") == "soon", state, vm) { nav.navigate("movie/${it.tmdbId}") }
                }
                composable("showtimes") { ShowtimeScreen(state, vm, openMovie = { nav.navigate("movie/${it.tmdbId}") }, openCinema = { nav.navigate("cinema/${Uri.encode(it)}") }) }
                composable("cinematheques") { CinemathequesScreen(state, vm, openMovie = { nav.navigate("movie/${it.tmdbId}") }, openCinema = { nav.navigate("cinema/${Uri.encode(it)}") }) }
                composable("cinema/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                    val id = Uri.decode(entry.arguments?.getString("id").orEmpty())
                    LaunchedEffect(id) { vm.loadCinema(id) }
                    CinemaDetailScreen(state.cinemaPage, hiddenMovieIds = state.displayRules.filter { it.treatment == "remove" }.mapTo(mutableSetOf(), DisplayRule::tmdbId), onBack = { nav.popBackStack() }, openMovie = { nav.navigate("movie/${it.tmdbId}") })
                }
                composable("movie/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                    val id = entry.arguments?.getString("id")
                    LaunchedEffect(id) { vm.selectMovie(id) }
                    MovieScreen(state, vm, onBack = { nav.popBackStack() }, openShowtimes = { vm.selectTab(AppTab.SHOWTIMES); nav.navigate("showtimes") { popUpTo("discover") } }, openAccount = { nav.navigate("you") { popUpTo("discover") } })
                }
                composable("you") { AccountScreen(state, vm, navigate = { nav.navigate("account/$it") }, openWeb = { openExternal(context, it) }) }
                composable("account/preferences") { PreferencesScreen(state, vm, onBack = { nav.popBackStack() }) }
                composable("account/alerts") { TicketAlertsScreen(state, vm, onBack = { nav.popBackStack() }) }
                composable("account/watches") { WatchesScreen(state, vm, onBack = { nav.popBackStack() }) }
                composable("account/letterboxd") { LetterboxdScreen(state, vm, onBack = { nav.popBackStack() }) }
                composable("account/security") { SecurityScreen(state, vm, onBack = { nav.popBackStack() }, openWeb = { openExternal(context, it) }) }
                composable("account/delete") { DeleteConfirmationScreen(state, vm, onBack = { nav.popBackStack() }) }
            }
        }
    }
    }
}

private fun AppTab.route() = when (this) { AppTab.DISCOVER -> "discover"; AppTab.SHOWTIMES -> "showtimes"; AppTab.CINEMATHEQUES -> "cinematheques"; AppTab.YOU -> "you" }
private val AppTab.label get() = when (this) { AppTab.DISCOVER -> "Discover"; AppTab.SHOWTIMES -> "Showtimes"; AppTab.CINEMATHEQUES -> "Cinematheques"; AppTab.YOU -> "You" }
@Composable private fun AppTab.icon() = when (this) { AppTab.DISCOVER -> Icons.Default.AutoAwesome; AppTab.SHOWTIMES -> Icons.Default.ConfirmationNumber; AppTab.CINEMATHEQUES -> Icons.Default.Theaters; AppTab.YOU -> Icons.Default.AccountCircle }

@Composable private fun ScreenHeader(title: String, subtitle: String? = null, back: (() -> Unit)? = null, action: (@Composable RowScope.() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        if (back != null) IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        Column(Modifier.weight(1f)) { Text(title, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold); if (subtitle != null) Text(subtitle, color = secondaryText, fontSize = 13.sp) }
        if (action != null) Row(content = action)
    }
}

@Composable private fun DiscoverScreen(state: KartiseretState, vm: KartiseretViewModel, openMovie: (Movie) -> Unit, openCatalog: (String) -> Unit) {
    val query = state.query.trim()
    val searchMatches = state.allMovies.filter { vm.isMovieVisible(it) && query.isNotBlank() && (it.title.contains(query, true) || it.year.toString().contains(query)) }.distinctBy(Movie::tmdbId)
    val filteredNow = vm.visibleMovies(false)
    val filteredSoon = vm.visibleMovies(true)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 18.dp)) {
        item {
            Column(Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(raised, canvas))).padding(horizontal = 22.dp, vertical = 24.dp)) {
                Text("ISRAELI CINEMA, ALL IN ONE PLACE", color = violet, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp)
                Spacer(Modifier.height(8.dp)); Text("Find your next\nnight at the movies.", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold, lineHeight = 37.sp)
                Spacer(Modifier.height(8.dp)); Text("${state.selectedCity}  ·  Films, showtimes, and local cinemas", color = secondaryText, fontSize = 14.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 14.dp)) {
                    Button(onClick = { openCatalog("now") }) { Text("Now Playing") }
                    OutlinedButton(onClick = { openCatalog("soon") }) { Text("Coming Soon") }
                }
            }
        }
        if (query.isBlank() && state.featured?.highlights?.isNotEmpty() == true) item { FeaturedShelf(state, openMovie) }
        item { SearchBox(state.query, vm::setQuery) }
        if (state.error != null) item { ErrorCard(state.error) { vm.refreshPublic(); vm.clearError() } }
        state.pendingMovieLinkError?.let { message -> item {
            Column {
                InlineMessage(message, isError = true)
                TextButton(onClick = vm::retryPendingMovieLink, modifier = Modifier.padding(start = 10.dp)) { Text("Try again") }
            }
        } }
        if (query.isNotBlank()) {
            item { Text("Search results", Modifier.padding(horizontal = 18.dp, vertical = 6.dp), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold) }
            if (state.searchLoading) item { LoadingLine("Searching films…") }
            state.searchError?.let { message -> item { InlineMessage("Online title search is unavailable. $message", true) } }
            if (searchMatches.isEmpty() && !state.searchLoading) item { EmptyCard("No films found", "Try a different title. Online search starts after two characters.") {} }
            items(searchMatches, key = Movie::tmdbId) { MovieListRow(it, openMovie) }
        } else {
        item { MovieShelf("New Releases", "Now Playing", filteredNow.filter { it.year == 0 || it.year > java.time.Year.now().value - 3 }, openMovie, { openCatalog("now") }) }
        item { MovieShelf("Coming Soon", "On the horizon", filteredSoon, openMovie, { openCatalog("soon") }) }
        if (!state.preferences.hideReReleases) item { MovieShelf("Re-Releases", "Back on the big screen", filteredNow.filter { it.year in 1..(java.time.Year.now().value - 3) }, openMovie, { openCatalog("now") }) }
        }
        if (state.catalogLoading && state.nowPlaying.isEmpty()) item { LoadingLine("Finding films…") }
        if (!state.catalogLoading && state.nowPlaying.isEmpty() && state.comingSoon.isEmpty()) item { EmptyCard("No movies available", "Pull to refresh the catalogs.") { vm.refreshPublic() } }
    }
}

@Composable private fun SearchBox(value: String, onValue: (String) -> Unit) {
    OutlinedTextField(value, onValue, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), placeholder = { Text("Search titles or years") }, leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) }, trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { onValue("") }) { Icon(Icons.Default.Close, contentDescription = "Clear search") } }, singleLine = true, shape = RoundedCornerShape(14.dp))
}

@Composable private fun FeaturedShelf(state: KartiseretState, openMovie: (Movie) -> Unit) {
    val item = state.featured?.highlights?.firstOrNull() ?: return
    val movie = state.allMovies.firstOrNull { it.tmdbId == item.tmdbId } ?: return
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(18.dp)).background(surface).clickable { openMovie(movie) }) {
        MovieArtwork(item.backdropUrl ?: movie.backdropSrc ?: movie.imageSrc, item.title ?: movie.title, Modifier.fillMaxWidth().height(190.dp))
        Column(Modifier.padding(16.dp)) { Text(item.label ?: "Featured", color = violet, fontSize = 12.sp, fontWeight = FontWeight.Bold); Text(item.title ?: movie.title, color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Bold); item.subtitle?.let { Text(it, color = secondaryText) } }
    }
}

@Composable private fun MovieShelf(title: String, subtitle: String, movies: List<Movie>, openMovie: (Movie) -> Unit, seeAll: () -> Unit) {
    Column(Modifier.padding(top = 14.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(title, color = Color.White, fontSize = 21.sp, fontWeight = FontWeight.Bold); Text(subtitle, color = secondaryText, fontSize = 12.sp) }
            TextButton(onClick = seeAll) { Text("See all") }
        }
        if (movies.isEmpty()) Text("No films to show", Modifier.padding(horizontal = 18.dp, vertical = 12.dp), color = secondaryText, fontSize = 13.sp)
        else Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            movies.take(36).forEach { movie -> MoviePosterCard(movie, Modifier.width(128.dp), openMovie) }
        }
    }
}

@Composable private fun MoviePosterCard(movie: Movie, modifier: Modifier = Modifier, openMovie: (Movie) -> Unit) {
    Column(modifier.clickable { openMovie(movie) }) {
        MovieArtwork(movie.imageSrc, movie.title, Modifier.fillMaxWidth().height(190.dp).clip(RoundedCornerShape(10.dp)).background(surface))
        Spacer(Modifier.height(7.dp)); Text(movie.title, color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
        Text(movie.year.takeIf { it > 0 }?.toString() ?: "", color = secondaryText, fontSize = 12.sp)
    }
}

@Composable private fun CatalogScreen(soon: Boolean, state: KartiseretState, vm: KartiseretViewModel, openMovie: (Movie) -> Unit) {
    var query by rememberSaveable(soon) { mutableStateOf("") }
    val movies = vm.visibleMovies(soon).filter { query.isBlank() || it.title.contains(query, true) || it.year.toString().contains(query) }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(if (soon) "Coming Soon" else "Now Playing", if (soon) "Upcoming cinema releases" else "Films currently in cinemas")
        SearchBox(query, { query = it })
        if (movies.isEmpty()) EmptyCard("No films found", if (query.isBlank()) "The catalog is empty." else "Try another title or year.") { vm.refreshPublic() }
        else LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)) {
            items(movies, key = Movie::tmdbId) { movie -> MovieListRow(movie, openMovie) }
        }
    }
}

@Composable private fun MovieListRow(movie: Movie, openMovie: (Movie) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { openMovie(movie) }.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
        MovieArtwork(movie.imageSrc, movie.title, Modifier.size(width = 72.dp, height = 106.dp).clip(RoundedCornerShape(8.dp)).background(surface))
        Column(Modifier.weight(1f).padding(start = 13.dp)) {
            Text(movie.title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            Text(listOfNotNull(movie.year.takeIf { it > 0 }?.toString(), movie.runtime.takeIf { it > 0 }?.let { "$it min" }, movie.genres.firstOrNull()).joinToString(" · "), color = secondaryText, fontSize = 12.sp)
            movie.releaseDate?.let { Text("Release date $it", color = secondaryText, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp)) }
        }
        Icon(Icons.Default.ChevronRight, contentDescription = "Open ${movie.title}", tint = secondaryText)
    }
}

@Composable private fun MovieScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit, openShowtimes: () -> Unit, openAccount: () -> Unit) {
    val context = LocalContext.current
    val movie = state.selectedMovie
    if (movie == null) { Column { ScreenHeader("Film", back = onBack); LoadingLine("Loading film details…") }; return }
    val isNowPlaying = state.nowPlaying.any { it.tmdbId == movie.tmdbId }
    val isSoon = !isNowPlaying && (state.comingSoon.any { it.tmdbId == movie.tmdbId } || movie.releaseDate != null)
    val rows = state.showtimes.filter { it.tmdbId == movie.tmdbId && it.screeningCity == state.selectedCity && it.dateOfShowing == state.selectedDate && matchesRowPreferences(it, state.preferences.showtimePreferences) && isUpcoming(it) }
    val hasAlert = state.ticketAlerts.any { it.tmdbId == movie.tmdbId }
    val hasWatch = state.watches.any { it.tmdbId == movie.tmdbId }
    val sharePath = movie.movieCode?.let { MovieShareCodec.encode(it, state.selectedCity, runCatching { LocalDate.parse(state.selectedDate) }.getOrNull() ?: KartiseretApi.cinemaDay(), KartiseretApi.cinemaDay(), state.preferences.showtimePreferences.screeningFilters.unchecked, state.preferences.showtimePreferences.excludedCinemaIds) }
    var editingAlert by rememberSaveable(movie.tmdbId) { mutableStateOf(false) }
    val hideBackdrop = state.displayRules.firstOrNull { it.tmdbId == movie.tmdbId }?.hideBackdrop == true
    Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }; Text(movie.title, Modifier.weight(1f), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 19.sp, maxLines = 1, overflow = TextOverflow.Ellipsis); IconButton(enabled = sharePath != null, onClick = { sharePath?.let { share(context, "https://${BuildConfig.APP_LINK_HOST}$it") } }) { Icon(Icons.Default.Share, "Share film") } }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            if (!hideBackdrop) MovieArtwork(movie.backdropSrc ?: movie.imageSrc, movie.title, Modifier.fillMaxWidth().height(250.dp).background(surface))
            else Spacer(Modifier.fillMaxWidth().height(12.dp))
            Column(Modifier.padding(18.dp)) {
                Text(movie.title, color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.Bold)
                Text(listOfNotNull(movie.year.takeIf { it > 0 }?.toString(), movie.runtime.takeIf { it > 0 }?.let { "$it min" }, movie.genres.takeIf { it.isNotEmpty() }?.joinToString(" · ")).joinToString("  ·  "), color = secondaryText, modifier = Modifier.padding(top = 5.dp))
                Ratings(movie, state.preferences.ratingSources)
                movie.releaseDate?.let { Text("Release date · $it", color = secondaryText, modifier = Modifier.padding(top = 12.dp)) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 16.dp)) {
                    if (!isSoon) Button(onClick = openShowtimes) { Text("Showtimes") }
                    movie.trailerKey?.let { OutlinedButton(onClick = { openExternal(context, "https://www.youtube.com/watch?v=$it") }) { Icon(Icons.Default.PlayArrow, null); Text("Trailer") } }
                }
                if (!isSoon && !hasAlert) OutlinedButton(onClick = { if (state.isSignedIn) vm.createTicketAlert(movie) else openAccount() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Icon(Icons.Default.NotificationsActive, null); Spacer(Modifier.width(6.dp)); Text(if (state.isSignedIn) "Alert me when tickets are available" else "Sign in to create a ticket alert") }
                if (isSoon && !hasWatch) OutlinedButton(onClick = { if (state.isSignedIn) vm.createWatch(movie) else openAccount() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Icon(Icons.Default.Event, null); Spacer(Modifier.width(6.dp)); Text(if (state.isSignedIn) "Watch release date" else "Sign in to watch release date") }
                if (hasAlert) TextButton(onClick = { editingAlert = true }) { Icon(Icons.Default.NotificationsActive, null); Spacer(Modifier.width(6.dp)); Text("Ticket alert active · Edit settings") }
                if (hasWatch) Text("Release date watch is active", modifier = Modifier.padding(top = 12.dp), color = violet)
                if (!isSoon) {
                    Text("Showtimes in ${state.selectedCity}", Modifier.padding(top = 24.dp), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    if (rows.isEmpty()) Text("No screenings are listed for ${state.selectedDate}.", color = secondaryText, modifier = Modifier.padding(vertical = 12.dp))
                    rows.sortedBy { KartiseretApi.sortShowtime(it.showtime) }.forEach { row -> ScreeningCard(row) { url -> openExternal(context, url) } }
                }
            }
        }
    }
    if (editingAlert) {
        val alert = state.ticketAlerts.firstOrNull { it.tmdbId == movie.tmdbId }
        TicketAlertOverrideDialog(alert?.criteriaOverrides ?: AlertCriteriaOverride(), state.ticketAlertPreferences, state.selectedCity, onDismiss = { editingAlert = false }, onSave = { vm.saveTicketAlertCriteria(movie.tmdbId, it); editingAlert = false })
    }
}

@Composable private fun Ratings(movie: Movie, sources: List<String>) {
    val values = listOfNotNull(
        movie.imdbRating?.takeIf { "imdbRating" in sources }?.let { "IMDb ${"%.1f".format(it)}" },
        movie.rtAudienceRating?.takeIf { "rtAudienceRating" in sources }?.let { "RT audience ${"%.0f".format(it)}%" },
        movie.rtCriticRating?.takeIf { "rtCriticRating" in sources }?.let { "RT critics ${"%.0f".format(it)}%" },
        movie.lbRating?.takeIf { "lbRating" in sources }?.let { "Letterboxd ${"%.1f".format(it)}" },
        movie.tmdbRating?.takeIf { "tmdbRating" in sources }?.let { "TMDb ${"%.1f".format(it)}" }
    )
    if (values.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) { values.forEach { AssistChip(onClick = {}, label = { Text(it) }) } }
}

@Composable private fun ShowtimeScreen(state: KartiseretState, vm: KartiseretViewModel, openMovie: (Movie) -> Unit, openCinema: (String) -> Unit) {
    val context = LocalContext.current
    var choosingCity by rememberSaveable { mutableStateOf(false) }
    var showingFilters by rememberSaveable { mutableStateOf(false) }
    var choosingDate by rememberSaveable { mutableStateOf(false) }
    var cityQuery by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Showtimes", "${state.selectedCity} · ${state.selectedDate}", action = {
            IconButton(onClick = { showingFilters = true }) { Icon(Icons.Default.FilterList, "Filter screenings") }
        })
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { choosingCity = true; cityQuery = "" }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.LocationOn, null); Spacer(Modifier.width(6.dp)); Text(state.selectedCity, maxLines = 1) }
            IconButton(onClick = { runCatching { vm.setDate(LocalDate.parse(state.selectedDate).minusDays(1)) } }) { Icon(Icons.Default.ChevronLeft, "Previous day") }
            TextButton(onClick = { choosingDate = true }) { Text(LocalDate.parse(state.selectedDate).format(DateTimeFormatter.ofPattern("EEE, d MMM"))) }
            IconButton(onClick = { runCatching { vm.setDate(LocalDate.parse(state.selectedDate).plusDays(1)) } }) { Icon(Icons.Default.ChevronRight, "Next day") }
        }
        if (state.scheduleLoading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = violet)
        val moviesById = (state.allMovies + state.scheduleMovies).distinctBy(Movie::tmdbId).associateBy(Movie::tmdbId)
        val filtered = state.showtimes.filter { row -> row.screeningCity == state.selectedCity && row.dateOfShowing == state.selectedDate && matchesRowPreferences(row, state.preferences.showtimePreferences) && isUpcoming(row) && (moviesById[row.tmdbId]?.let(vm::isMovieVisible) ?: true) }
            .groupBy(Screening::tmdbId).toList().sortedBy { (_, rows) -> rows.minOfOrNull { KartiseretApi.sortShowtime(it.showtime) } ?: Int.MAX_VALUE }
        if (filtered.isEmpty() && !state.scheduleLoading) EmptyCard("No showtimes listed", "Try another day or city.") { vm.refreshPublic() }
        else LazyColumn(contentPadding = PaddingValues(bottom = 16.dp)) {
            items(filtered, key = { it.first }) { (movieId, rows) ->
                val movie = moviesById[movieId]
                Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp).clip(RoundedCornerShape(16.dp)).background(surface)) {
                    Row(Modifier.fillMaxWidth().clickable { movie?.let(openMovie) }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        MovieArtwork(movie?.imageSrc, movie?.title ?: "Film", Modifier.size(58.dp, 84.dp).clip(RoundedCornerShape(8.dp)).background(raised))
                        Column(Modifier.weight(1f).padding(start = 12.dp)) { Text(movie?.title ?: "Film", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp); Text(movie?.year?.takeIf { it > 0 }?.toString().orEmpty(), color = secondaryText, fontSize = 12.sp) }
                        IconButton(onClick = { movie?.let(openMovie) }) { Icon(Icons.Default.ChevronRight, "Film details") }
                    }
                    rows.groupBy(Screening::cinema).toSortedMap(String.CASE_INSENSITIVE_ORDER).forEach { (cinema, screenings) ->
                        val identity = CinemaIdentities.forScreening(state.selectedCity, cinema)
                        Row(Modifier.fillMaxWidth().then(if (identity != null) Modifier.clickable { openCinema(identity.id) } else Modifier).padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(cinema, Modifier.weight(1f), color = Color.White, fontWeight = FontWeight.SemiBold)
                            screenings.firstOrNull()?.let { row -> Text(row.screeningCity, color = secondaryText, fontSize = 11.sp) }
                        }
                FlowRowChips(screenings.sortedBy { KartiseretApi.sortShowtime(it.showtime) }, context)
                    }
                }
            }
        }
    }
    if (choosingDate) {
        val day = LocalDate.parse(state.selectedDate)
        val zone = ZoneId.of("Asia/Jerusalem")
        val picker = remember(context, day) { android.app.DatePickerDialog(context, { _, year, month, date -> vm.setDate(LocalDate.of(year, month + 1, date)); choosingDate = false }, day.year, day.monthValue - 1, day.dayOfMonth).apply {
            datePicker.minDate = KartiseretApi.cinemaDay().atStartOfDay(zone).toInstant().toEpochMilli()
            datePicker.maxDate = KartiseretApi.cinemaDay().plusDays(179).atStartOfDay(zone).toInstant().toEpochMilli()
            setOnDismissListener { choosingDate = false }
        } }
        LaunchedEffect(choosingDate) { if (choosingDate && !picker.isShowing) picker.show() }
    }
    if (choosingCity) AlertDialog(onDismissRequest = { choosingCity = false }, title = { Text("Choose a city") }, text = {
        Column(Modifier.heightIn(max = 520.dp)) { OutlinedTextField(cityQuery, { cityQuery = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search cities") }); LazyColumn { items(ALL_CITIES.filter { it.contains(cityQuery, true) }) { city -> ListItem(headlineContent = { Text(city) }, modifier = Modifier.clickable { vm.selectCity(city); choosingCity = false }) } } }
    }, confirmButton = { TextButton(onClick = { choosingCity = false }) { Text("Done") } })
    if (showingFilters) ShowtimeFilterDialog(state, vm) { showingFilters = false }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun FlowRowChips(rows: List<Screening>, context: android.content.Context) {
    androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        rows.forEach { row ->
            val ticket = row.englishHref ?: row.hebrewHref
            if (ticket == null) AssistChip(onClick = {}, label = { Text(row.showtime) }, leadingIcon = { Icon(Icons.Default.Schedule, null) })
            else AssistChip(onClick = { openExternal(context, ticket) }, label = { Text(row.showtime) }, leadingIcon = { Icon(Icons.Default.ConfirmationNumber, null) })
            val metadata = listOfNotNull(row.screeningTech, row.screeningType, row.dubLanguage).filterNot { it.isBlank() || it.equals("regular", true) }
            if (metadata.isNotEmpty()) Text(metadata.joinToString(" · "), Modifier.align(Alignment.CenterVertically), color = secondaryText, fontSize = 11.sp)
        }
    }
}

@Composable private fun ShowtimeFilterDialog(state: KartiseretState, vm: KartiseretViewModel, onDismiss: () -> Unit) {
    val selected = state.preferences.showtimePreferences.screeningFilters.unchecked
    var unchecked by remember(state.preferences.showtimePreferences) { mutableStateOf(selected) }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Showtime filters") }, text = {
        LazyColumn(Modifier.heightIn(max = 520.dp)) {
            FILTER_OPTIONS.forEach { (group, options) ->
                item { Text(group.displayFilterName(), Modifier.padding(top = 12.dp), color = violet, fontWeight = FontWeight.Bold) }
                items(options) { option ->
                    val chosen = option !in groupValues(unchecked, group)
                    Row(Modifier.fillMaxWidth().clickable { unchecked = toggleFilter(unchecked, group, option) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) { Checkbox(chosen, onCheckedChange = { unchecked = toggleFilter(unchecked, group, option) }); Text(option) }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { vm.saveShowtimeFilters(unchecked); onDismiss() }) { Text("Save") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

@Composable private fun CinemathequesScreen(state: KartiseretState, vm: KartiseretViewModel, openMovie: (Movie) -> Unit, openCinema: (String) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Cinematheques", "Two-week cinema schedule")
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val today = KartiseretApi.cinemaDay()
            (0..13).forEach { index -> val day = today.plusDays(index.toLong()); FilterChip(selected = day.toString() == state.selectedDate, onClick = { vm.setDate(day) }, label = { Text(day.format(DateTimeFormatter.ofPattern("EEE d"))) }) }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 10.dp)) { state.cities.forEach { city -> FilterChip(state.selectedCity == city.name, { vm.selectCity(city.name) }, label = { Text(city.name) }) } }
        val visibleMovieIds = (state.allMovies + state.scheduleMovies).filter(vm::isMovieVisible).mapTo(mutableSetOf(), Movie::tmdbId)
        val selected = state.cinematheques.filter { it.dateOfShowing == state.selectedDate && it.screeningCity == state.selectedCity && it.tmdbId in visibleMovieIds && matchesRowPreferences(it, state.preferences.showtimePreferences) && isUpcoming(it) }.sortedWith(compareBy({ it.cinema.lowercase() }, { KartiseretApi.sortShowtime(it.showtime) }))
        if (selected.isEmpty()) EmptyCard("No screenings listed", "Choose another date or city.") { vm.loadCinematheques() }
        else LazyColumn(contentPadding = PaddingValues(bottom = 16.dp)) { items(selected, key = { "${it.tmdbId}|${it.cinema}|${it.showtime}" }) { screening ->
            val movie = state.allMovies.firstOrNull { it.tmdbId == screening.tmdbId } ?: state.scheduleMovies.firstOrNull { it.tmdbId == screening.tmdbId }
            Row(Modifier.fillMaxWidth().clickable { movie?.let(openMovie) }.padding(horizontal = 14.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                MovieArtwork(movie?.imageSrc, movie?.title ?: "Film", Modifier.size(52.dp, 76.dp).clip(RoundedCornerShape(7.dp)).background(surface))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(movie?.title ?: "Film", color = Color.White, fontWeight = FontWeight.Bold); Text(screening.cinema, color = secondaryText); Text("${screening.showtime} · ${screening.screeningTech}", color = violet, fontSize = 12.sp) }
                (screening.englishHref ?: screening.hebrewHref)?.let { url -> IconButton(onClick = { openExternal(context, url) }) { Icon(Icons.AutoMirrored.Filled.OpenInNew, "Booking link") } }
            val identity = CinemaIdentities.forScreening(screening.screeningCity, screening.cinema)
            if (identity != null) IconButton(onClick = { openCinema(identity.id) }) { Icon(Icons.Default.ChevronRight, "Cinema details") }
            }
            HorizontalDivider(color = surface)
        } } }
}

@Composable private fun CinemaDetailScreen(page: CinemaPage?, hiddenMovieIds: Set<String>, onBack: () -> Unit, openMovie: (Movie) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        ScreenHeader(page?.displayName ?: "Cinema", page?.city, onBack)
        if (page == null) LoadingLine("Loading cinema details…") else {
            Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
                Text(page.address, color = secondaryText)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 10.dp)) {
                    OutlinedButton(onClick = { openExternal(context, page.mapUrl) }) { Icon(Icons.Default.Map, null); Text("Map") }
                    Text("${page.latitude}, ${page.longitude}", color = secondaryText, modifier = Modifier.align(Alignment.CenterVertically), fontSize = 12.sp)
                }
            }
            LazyColumn { items(page.screenings.filterNot { it.movie.tmdbId in hiddenMovieIds }, key = { "${it.movie.tmdbId}|${it.screening.showtime}|${it.screening.dateOfShowing}" }) { item ->
                Row(Modifier.fillMaxWidth().clickable { openMovie(item.movie) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    MovieArtwork(item.movie.imageSrc, item.movie.title, Modifier.size(56.dp, 82.dp).clip(RoundedCornerShape(8.dp)).background(surface))
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(item.movie.title, color = Color.White, fontWeight = FontWeight.Bold); Text("${item.screening.dateOfShowing} · ${item.screening.showtime}", color = secondaryText); Text(item.screening.screeningTech, color = violet, fontSize = 12.sp) }
                    (item.screening.englishHref ?: item.screening.hebrewHref)?.let { TextButton(onClick = { openExternal(context, it) }) { Text("Tickets") } }
                }
                HorizontalDivider(color = surface)
            } }
        }
    }
}

@Composable private fun ScreeningCard(row: Screening, onTicket: (String) -> Unit) {
    val url = row.englishHref ?: row.hebrewHref
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(row.cinema, color = Color.White, fontWeight = FontWeight.SemiBold); Text("${row.showtime} · ${row.screeningTech} · ${row.screeningType}", color = secondaryText, fontSize = 12.sp) }
        if (url != null) TextButton(onClick = { onTicket(url) }) { Text("Tickets") }
    }
}

@Composable private fun AccountScreen(state: KartiseretState, vm: KartiseretViewModel, navigate: (String) -> Unit, openWeb: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isSignup by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 20.dp)) {
        ScreenHeader("Your Kartiseret", state.user?.email ?: "Your account and preferences")
        state.accountError?.let { InlineMessage(it, isError = !it.startsWith("Check your email") && it != "Account deleted.") }
        if (state.accountLoading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = violet)
        val identity = state.user
        if (BuildConfig.FLAVOR == "fixture") {
            SectionCard("Offline fixture mode", "No network access and no account registrations") {
                Text("Explore deterministic sample films, screenings, cinema pages, search, and guest preferences without contacting Kartiseret or a production account.", color = secondaryText)
            }
            SectionCard("Guest preferences", "Choose your cinema city") { CitySelector(state, vm) }
        } else if (identity == null) {
            Column(Modifier.padding(horizontal = 18.dp)) {
                Text("Sign in to sync your preferences and manage ticket alerts.", color = secondaryText, modifier = Modifier.padding(vertical = 8.dp))
                if (isSignup) OutlinedTextField(name, { name = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Name") }, singleLine = true)
                OutlinedTextField(email, { email = it }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Email") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), singleLine = true)
                OutlinedTextField(password, { password = it }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true)
                Button(onClick = {
                    if (busy) return@Button
                    busy = true; message = null
                    scope.launch {
                        try {
                            if (isSignup) { val signedIn = vm.signUp(name, email, password); message = if (signedIn) "Account created." else "Check your email to verify your account, then sign in." }
                            else { vm.signIn(email, password); password = "" }
                        } catch (error: Exception) { message = error.message ?: "Could not sign in." }
                        busy = false
                    }
                }, modifier = Modifier.fillMaxWidth().padding(top = 14.dp), enabled = !busy && email.isNotBlank() && password.length >= 8 && (!isSignup || name.isNotBlank())) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(if (isSignup) "Create account" else "Sign in")
                }
                TextButton(onClick = { isSignup = !isSignup; message = null }) { Text(if (isSignup) "Already have an account? Sign in" else "Create account") }
                if ("google" in state.providers) OutlinedButton(onClick = {
                    if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) { message = "Google sign-in needs a web client ID configured for this build."; return@OutlinedButton }
                    busy = true; message = null
                    scope.launch {
                        try { vm.signInGoogle(requestGoogleIdToken(context)); password = "" }
                        catch (error: Exception) { if (error !is GetCredentialException) message = error.message ?: "Google sign-in failed." else message = "Google sign-in was cancelled or unavailable." }
                        busy = false
                    }
                }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp)) { Text("Continue with Google") }
                OutlinedButton(onClick = { openWeb("${BuildConfig.API_BASE_URL.trimEnd('/')}/user") }, modifier = Modifier.fillMaxWidth().padding(top = 7.dp)) { Text("Continue with Apple on the website") }
                TextButton(onClick = { openWeb("${BuildConfig.API_BASE_URL.trimEnd('/')}/reset-password") }) { Text("Forgot password?") }
                if (message != null) Text(message!!, Modifier.padding(vertical = 8.dp), color = if (message!!.startsWith("Check your email")) violet else secondaryText)
            }
            SectionCard("Guest preferences", "Choose your cinema city") { CitySelector(state, vm) }
        } else {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(surface).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AccountCircle, null, tint = violet, modifier = Modifier.size(42.dp))
                    Column(Modifier.weight(1f).padding(start = 12.dp)) { Text(identity.name ?: identity.email ?: "Kartiseret user", color = Color.White, fontWeight = FontWeight.Bold); Text(identity.email ?: "", color = secondaryText, fontSize = 12.sp) }
                }
                Spacer(Modifier.height(10.dp))
                AccountLink("Preferences", "City, ratings, showtime filters, and film display", Icons.Default.Tune) { navigate("preferences") }
                AccountLink("Ticket alerts", "${state.ticketAlerts.size} active alerts", Icons.Default.Notifications) { navigate("alerts") }
                AccountLink("Coming Soon watches", "${state.watches.size} films watched", Icons.Default.Event) { navigate("watches") }
                AccountLink("Letterboxd sources", "${state.letterboxdSources.size} lists connected", Icons.Default.Bookmarks) { navigate("letterboxd") }
                AccountLink("Account security", "Password, sign-in methods, and account deletion", Icons.Default.Security) { navigate("security") }
                OutlinedButton(onClick = { vm.signOut() }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Icon(Icons.AutoMirrored.Filled.Logout, null); Spacer(Modifier.width(7.dp)); Text("Sign out") }
            }
        }
    }
}

@Composable private fun PreferencesScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit) {
    var ruleQuery by rememberSaveable { mutableStateOf("") }
    val sources = listOf("imdbRating", "rtAudienceRating", "rtCriticRating", "lbRating", "tmdbRating")
    val labels = mapOf("imdbRating" to "IMDb", "rtAudienceRating" to "Rotten Tomatoes Audience", "rtCriticRating" to "Rotten Tomatoes Critics", "lbRating" to "Letterboxd", "tmdbRating" to "TMDb")
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Preferences", "Syncs with your Kartiseret account", onBack)
        LazyColumn(contentPadding = PaddingValues(bottom = 20.dp)) {
            item { SectionCard("Default city", "Used for showtimes and ticket alerts") { CitySelector(state, vm) } }
            item { SectionCard("Ratings", "Choose the rating sources shown on film cards") { sources.forEach { key -> Row(Modifier.fillMaxWidth().clickable { val next = state.preferences.ratingSources.toMutableList().also { if (key in it) it.remove(key) else it.add(key) }; vm.savePreference("ratingSources", vm.api.json.encodeToString(next)) }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) { Checkbox(key in state.preferences.ratingSources, { checked -> val next = state.preferences.ratingSources.toMutableList().also { if (checked) it.add(key) else it.remove(key) }; vm.savePreference("ratingSources", vm.api.json.encodeToString(next)) }); Text(labels.getValue(key), color = Color.White) } } } }
            item { SectionCard("Catalog", "Hide films from earlier release years in New Releases") { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("Hide Re-Releases", Modifier.weight(1f), color = Color.White); Switch(state.preferences.hideReReleases, { vm.savePreference("hideReReleases", it.toString()) }) } } }
            item { SectionCard("Accent color", "Choose the accent used across Kartiseret") { Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) { listOf("#e269ba", "#ed4c57", "#d97f3a", "#bebe2d", "#63ae3d", "#3caa8e", "#69b0e2", "#4375d9", "#a66ae3").forEach { hex -> val color = Color(android.graphics.Color.parseColor(hex)); Box(Modifier.size(36.dp).clip(CircleShape).background(color).clickable { vm.savePreference("siteColor", vm.api.json.encodeToString(hex)) }, contentAlignment = Alignment.Center) { if (state.preferences.siteColor.equals(hex, true)) Icon(Icons.Default.Check, null, tint = Color.White) } } } } }
            item { SectionCard("Showtime filters", "Filters apply to showtimes on this device and your account") { ShowtimeFilterEditor(state, vm) } }
            item { SectionCard("Cinema exclusions", "Hide venues from the showtimes and cinematheque lists") { CinemaExclusionEditor(state, vm) } }
            item { SectionCard("Film display", "Hide a title or backdrop when it needs correction") {
                OutlinedTextField(ruleQuery, { ruleQuery = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Find a film to customize") }, singleLine = true)
                TextButton(onClick = { vm.setQuery(ruleQuery) }, enabled = ruleQuery.trim().length >= 2) { Icon(Icons.Default.Search, null); Text("Search titles") }
                if (state.searchLoading && ruleQuery.isNotBlank()) LinearProgressIndicator(Modifier.fillMaxWidth(), color = violet)
                state.searchResults.filter { ruleQuery.trim().length >= 2 && it.title.contains(ruleQuery, true) }.take(8).forEach { result ->
                    val existing = state.displayRules.firstOrNull { it.tmdbId == result.tmdbId }
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(result.title, color = Color.White); Text(result.releaseYear?.toString() ?: "", color = secondaryText, fontSize = 12.sp) }
                        if (existing == null) TextButton(onClick = { vm.updateDisplayRule(DisplayRule(result.tmdbId, result.title, result.releaseYear)) }) { Text("Add rule") }
                    }
                }
                state.displayRules.forEach { rule ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(rule.title, color = Color.White); Text("${rule.releaseYear ?: ""} · ${rule.treatment}", color = secondaryText, fontSize = 12.sp) }; TextButton(onClick = { vm.updateDisplayRule(rule.copy(treatment = if (rule.treatment == "remove") "standard" else "remove")) }) { Text(if (rule.treatment == "remove") "Show title" else "Hide title") }; TextButton(onClick = { vm.setDisplayRuleBackdrop(rule.tmdbId, !rule.hideBackdrop) }) { Text(if (rule.hideBackdrop) "Show art" else "Hide art") }; IconButton(onClick = { vm.removeDisplayRule(rule.tmdbId) }) { Icon(Icons.Default.DeleteOutline, "Remove rule") } }
                }
                if (state.displayRules.isEmpty()) Text("Add a film above, then hide its title or replace its artwork treatment.", Modifier.padding(top = 5.dp), color = secondaryText, fontSize = 12.sp)
            } }
            item { state.accountError?.let { InlineMessage(it, true) } }
        }
    }
}

@Composable private fun ShowtimeFilterEditor(state: KartiseretState, vm: KartiseretViewModel) {
    var filters by remember(state.preferences.showtimePreferences) { mutableStateOf(state.preferences.showtimePreferences.screeningFilters.unchecked) }
    FILTER_OPTIONS.forEach { (group, options) ->
        Text(group.displayFilterName(), color = violet, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        options.forEach { option -> val checked = option !in groupValues(filters, group); Row(Modifier.fillMaxWidth().clickable { filters = toggleFilter(filters, group, option); vm.saveShowtimeFilters(filters) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(checked, { filters = toggleFilter(filters, group, option); vm.saveShowtimeFilters(filters) }); Text(option, color = Color.White) } }
    }
}

@Composable private fun CinemaExclusionEditor(state: KartiseretState, vm: KartiseretViewModel) {
    val excluded = state.preferences.showtimePreferences.excludedCinemaIds.toSet()
    CinemaIdentities.all.sortedWith(compareBy({ it.city }, { it.displayName })).forEach { cinema ->
        Row(Modifier.fillMaxWidth().clickable { vm.toggleCinemaExcluded(cinema.id, cinema.id !in excluded) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(cinema.id in excluded, { vm.toggleCinemaExcluded(cinema.id, it) })
            Column { Text(cinema.displayName, color = Color.White); Text(cinema.city, color = secondaryText, fontSize = 11.sp) }
        }
    }
}

@Composable private fun TicketAlertOverrideDialog(override: AlertCriteriaOverride, defaults: AlertCriteria, preferredCity: String, onDismiss: () -> Unit, onSave: (AlertCriteriaOverride) -> Unit) {
    var followDefaults by remember(override) { mutableStateOf(override.cities == null && override.notificationMode == null && override.filters == null) }
    var cities by remember(override, defaults, preferredCity) { mutableStateOf(override.cities ?: defaults.cities ?: listOf(preferredCity)) }
    var mode by remember(override, defaults) { mutableStateOf(override.notificationMode ?: defaults.notificationMode) }
    var filters by remember(override, defaults) { mutableStateOf(override.filters ?: defaults.filters) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Film alert settings") },
        text = {
            Column(Modifier.heightIn(max = 540.dp).verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(followDefaults, { followDefaults = it }); Text("Use my account defaults", color = Color.White) }
                if (!followDefaults) {
                    Text("Alert cities", color = violet, fontWeight = FontWeight.Bold)
                    ALL_CITIES.forEach { city -> Row(Modifier.fillMaxWidth().clickable { cities = cities.toMutableList().also { if (city in it) it.remove(city) else it.add(city) } }, verticalAlignment = Alignment.CenterVertically) { Checkbox(city in cities, { checked -> cities = cities.toMutableList().also { if (checked) it.add(city) else it.remove(city) } }); Text(city) } }
                    Text("An empty city list disables this film's alert.", color = secondaryText, fontSize = 12.sp)
                    Text("Notification timing", color = violet, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
                    Row { FilterChip(mode == "first_any_city", { mode = "first_any_city" }, label = { Text("First city") }); Spacer(Modifier.width(6.dp)); FilterChip(mode == "first_per_city", { mode = "first_per_city" }, label = { Text("Each city") }) }
                    AlertFilterEditor(filters) { filters = it }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(if (followDefaults) AlertCriteriaOverride() else AlertCriteriaOverride(cities, mode, filters)) }) { Text("Save") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}

@Composable private fun TicketAlertsScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit) {
    var criteria by remember(state.ticketAlertPreferences) { mutableStateOf(state.ticketAlertPreferences) }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Ticket alerts", "Get email when tickets appear", onBack)
        LazyColumn(contentPadding = PaddingValues(bottom = 20.dp)) {
            item { SectionCard("Default alert cities", "Film alerts follow this city list unless a film overrides it") {
                Row { FilterChip(criteria.cities == null, { criteria = criteria.copy(cities = null); vm.saveAlertPreferences(criteria) }, label = { Text("Use my default city") }) }
                ALL_CITIES.forEach { city -> Row(Modifier.fillMaxWidth().clickable { val cities = criteria.cities.orEmpty().toMutableList().also { if (city in it) it.remove(city) else it.add(city) }; criteria = criteria.copy(cities = cities); vm.saveAlertPreferences(criteria) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(criteria.cities?.contains(city) == true, { checked -> val cities = criteria.cities.orEmpty().toMutableList().also { if (checked) it.add(city) else it.remove(city) }; criteria = criteria.copy(cities = cities); vm.saveAlertPreferences(criteria) }); Text(city, color = Color.White) } }
                Text("An empty city list disables alerts for every city.", color = secondaryText, fontSize = 12.sp)
                Text("Notification timing", Modifier.padding(top = 8.dp), color = violet, fontWeight = FontWeight.Bold)
                Row { FilterChip(criteria.notificationMode == "first_any_city", { criteria = criteria.copy(notificationMode = "first_any_city"); vm.saveAlertPreferences(criteria) }, label = { Text("First city") }); Spacer(Modifier.width(8.dp)); FilterChip(criteria.notificationMode == "first_per_city", { criteria = criteria.copy(notificationMode = "first_per_city"); vm.saveAlertPreferences(criteria) }, label = { Text("Each city") }) }
                Text("Screening filters", Modifier.padding(top = 12.dp), color = violet, fontWeight = FontWeight.Bold)
                Text("Only send alerts for screenings that match these options.", color = secondaryText, fontSize = 12.sp)
                AlertFilterEditor(criteria.filters) { filters -> criteria = criteria.copy(filters = filters); vm.saveAlertPreferences(criteria) }
            } }
            if (state.ticketAlerts.isEmpty()) item { EmptyCard("No ticket alerts", "Open a film and add an alert when you want to see it.") {} }
            items(state.ticketAlerts, key = TicketAlert::tmdbId) { alert ->
                val movie = state.allMovies.firstOrNull { it.tmdbId == alert.tmdbId }
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(alert.deliveryTitle ?: movie?.title ?: "Film ${alert.tmdbId}", color = Color.White, fontWeight = FontWeight.SemiBold); Text(alert.notifiedAt?.let { "Alert sent" } ?: "Waiting for tickets", color = secondaryText, fontSize = 12.sp) }; TextButton(onClick = { vm.removeTicketAlert(alert.tmdbId) }) { Text("Remove") } }
                HorizontalDivider(color = surface)
            }
        }
    }
}

@Composable private fun AlertFilterEditor(filters: AlertFilters, onChange: (AlertFilters) -> Unit) {
    FILTER_OPTIONS.forEach { (group, options) ->
        Text(group.displayFilterName(), color = violet, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        options.forEach { option ->
            val unchecked = groupValues(filters.toFilterGroups(), group)
            Row(Modifier.fillMaxWidth().clickable { onChange(toggleAlertFilter(filters, group, option)) }.padding(vertical = 1.dp), verticalAlignment = Alignment.CenterVertically) {
                Checkbox(option !in unchecked, { onChange(toggleAlertFilter(filters, group, option)) })
                Text(option, color = Color.White)
            }
        }
    }
}

@Composable private fun WatchesScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Coming Soon watches", "Email when a release date changes", onBack)
        if (state.watches.isEmpty()) EmptyCard("No films watched", "Open a Coming Soon film and add a release date watch.") {}
        else LazyColumn { items(state.watches, key = ComingSoonWatch::tmdbId) { watch ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) { MovieArtwork(posterImageUrl(watch.posterPath), watch.title, Modifier.size(50.dp, 74.dp).clip(RoundedCornerShape(7.dp)).background(surface)); Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(watch.title, color = Color.White, fontWeight = FontWeight.Bold); Text(watch.comingSoonDate?.let { "Release date · $it" } ?: "Watching release date", color = secondaryText, fontSize = 12.sp); if (watch.notifiedAt != null) Text("Update email sent", color = violet, fontSize = 11.sp) }; TextButton(onClick = { vm.deleteWatch(watch.tmdbId) }) { Text("Remove") } }
            HorizontalDivider(color = surface)
        } }
    }
}

@Composable private fun LetterboxdScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Letterboxd sources", "Sync a watchlist or public list", onBack)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) { OutlinedTextField(url, { url = it }, modifier = Modifier.weight(1f), label = { Text("Letterboxd list URL") }, singleLine = true); IconButton(onClick = { if (url.startsWith("https://letterboxd.com/")) { vm.createLetterboxdSource(url); url = "" } }) { Icon(Icons.Default.Add, "Add source") } }
        Text("Use a public Letterboxd watchlist or list URL.", Modifier.padding(horizontal = 18.dp, vertical = 5.dp), color = secondaryText, fontSize = 12.sp)
        if (state.letterboxdSources.isEmpty()) EmptyCard("No sources added", "Films matched to the catalogs appear in Coming Soon watches.") {}
        else LazyColumn { items(state.letterboxdSources, key = LetterboxdSource::id) { source ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(source.sourceUrl, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("${source.matchedFilmCount} matched of ${source.filmCount} films", color = secondaryText, fontSize = 12.sp); source.lastSyncError?.let { Text(it, color = Color(0xffff8a80), fontSize = 11.sp) } }; TextButton(onClick = { vm.deleteLetterboxdSource(source.id) }) { Text("Remove") } }
            HorizontalDivider(color = surface)
        } }
    }
}

@Composable private fun SecurityScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit, openWeb: (String) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader("Account security", "Sign-in methods and account access", onBack)
        SectionCard("Sign-in methods", "Use the same account you use on seret.site") {
            Text("Email and password sign-in are available in the app. Apple sign-in and linking Google or Apple to an existing account are managed securely on the website.", color = secondaryText)
            OutlinedButton(onClick = { openWeb("${BuildConfig.API_BASE_URL.trimEnd('/')}/user") }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("Manage sign-in methods on website") }
            OutlinedButton(onClick = { openWeb("${BuildConfig.API_BASE_URL.trimEnd('/')}/reset-password") }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) { Text("Reset password") }
        }
        SectionCard("Delete account", "This removes your Kartiseret account and saved account data") {
            Text("Kartiseret sends a confirmation email. Deletion only happens after you open its confirmation link and confirm here.", color = secondaryText)
            Button(onClick = { vm.requestAccountDeletion() }, enabled = state.isSignedIn, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) { Text("Email me a deletion link") }
            state.accountError?.let { InlineMessage(it, isError = !it.startsWith("Check your email")) }
            TextButton(onClick = onBack) { Text("Back to account") }
        }
    }
}

@Composable private fun DeleteConfirmationScreen(state: KartiseretState, vm: KartiseretViewModel, onBack: () -> Unit) {
    var confirm by rememberSaveable(state.pendingDeletionToken) { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ScreenHeader("Delete account", "Confirmation required", onBack)
        SectionCard("Review deletion", "Deleting your Kartiseret account is permanent") {
            Text("This removes your account profile, saved preferences, ticket alerts, Coming Soon watches, and Letterboxd sources. It will not cancel any cinema bookings made with a cinema.", color = secondaryText)
            Spacer(Modifier.height(12.dp))
            if (state.pendingDeletionToken == null) {
                InlineMessage("Open the confirmation link from your deletion email on this device to continue.", isError = false)
            } else if (!state.isSignedIn) {
                InlineMessage("Sign in with the account you are deleting, then reopen the email link.", isError = true)
            } else {
                Text("You are signed in as ${state.user?.email ?: "your Kartiseret account"}.", color = Color.White)
                Button(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xffb3261e))) { Text("Permanently delete account") }
            }
            state.accountError?.let { InlineMessage(it, isError = it != "Account deleted.") }
        }
    }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Delete your account permanently?") },
        text = { Text("This cannot be undone. Your Kartiseret account and saved account data will be deleted.") },
        confirmButton = { TextButton(onClick = { confirm = false; vm.confirmAccountDeletion() }, colors = ButtonDefaults.textButtonColors(contentColor = Color(0xffffb4ab))) { Text("Delete permanently") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } }
    )
}

@Composable private fun CitySelector(state: KartiseretState, vm: KartiseretViewModel) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("") }
    OutlinedButton(onClick = { expanded = true; filter = "" }, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.LocationOn, null); Spacer(Modifier.width(8.dp)); Text(state.selectedCity, Modifier.weight(1f)); Icon(Icons.Default.ArrowDropDown, null)
    }
    if (expanded) AlertDialog(
        onDismissRequest = { expanded = false },
        title = { Text("Default city") },
        text = {
            Column(Modifier.heightIn(max = 520.dp)) {
                OutlinedTextField(filter, { filter = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Search cities") }, singleLine = true)
                LazyColumn {
                    items(ALL_CITIES.filter { it.contains(filter, ignoreCase = true) }) { city ->
                        ListItem(headlineContent = { Text(city) }, leadingContent = { if (city == state.selectedCity) Icon(Icons.Default.Check, null, tint = violet) }, modifier = Modifier.clickable { vm.selectCity(city); expanded = false })
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { expanded = false }) { Text("Close") } }
    )
}

@Composable private fun SectionCard(title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp).clip(RoundedCornerShape(16.dp)).background(surface).padding(15.dp)) {
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        subtitle?.let { Text(it, color = secondaryText, fontSize = 12.sp, modifier = Modifier.padding(top = 3.dp, bottom = 8.dp)) }
        content()
    }
}

@Composable private fun AccountLink(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(13.dp)).background(surface).clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = violet, modifier = Modifier.size(25.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(title, color = Color.White, fontWeight = FontWeight.SemiBold); Text(subtitle, color = secondaryText, fontSize = 12.sp) }
        Icon(Icons.Default.ChevronRight, null, tint = secondaryText)
    }
}

@Composable private fun InlineMessage(message: String, isError: Boolean) {
    Text(message, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(10.dp)).background(if (isError) Color(0xff51231f) else Color(0xff383044)).padding(12.dp), color = if (isError) Color(0xffffb4ab) else Color.White, fontSize = 13.sp)
}

@Composable private fun EmptyCard(title: String, subtitle: String, action: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 22.dp).clip(RoundedCornerShape(16.dp)).background(surface).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Default.LocalMovies, null, tint = violet, modifier = Modifier.size(30.dp))
        Text(title, color = Color.White, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
        Text(subtitle, color = secondaryText, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        if (action != null) TextButton(onClick = action) { Text("Refresh") }
    }
}

@Composable private fun LoadingLine(message: String) {
    Row(Modifier.fillMaxWidth().padding(22.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = violet); Text(message, Modifier.padding(start = 10.dp), color = secondaryText) }
}

@Composable private fun ErrorCard(message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(14.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xff51231f)).padding(14.dp)) {
        Text("Could not refresh Kartiseret", color = Color(0xffffb4ab), fontWeight = FontWeight.Bold)
        Text(message, color = Color.White, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
        TextButton(onClick = retry) { Text("Try again") }
    }
}

private fun openExternal(context: android.content.Context, url: String) {
    val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
    if (uri.scheme !in setOf("https", "http") || uri.host.isNullOrBlank() || uri.userInfo != null) return
    if (BuildConfig.FLAVOR == "fixture") {
        android.widget.Toast.makeText(context, "External links are disabled in offline fixture mode.", android.widget.Toast.LENGTH_SHORT).show()
        return
    }
    runCatching {
        CustomTabsIntent.Builder().setShowTitle(true).setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK).build().launchUrl(context, uri)
    }.onFailure {
        android.widget.Toast.makeText(context, "No browser is available to open this link.", android.widget.Toast.LENGTH_SHORT).show()
    }
}

private fun share(context: android.content.Context, url: String) {
    val chooser = Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url), "Share Kartiseret film")
    runCatching { context.startActivity(chooser) }
}

private suspend fun requestGoogleIdToken(context: android.content.Context): String {
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
        .setFilterByAuthorizedAccounts(false)
        .setAutoSelectEnabled(false)
        .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val result = try {
        CredentialManager.create(context).getCredential(context, request)
    } catch (_: NoCredentialException) {
        throw IllegalStateException("No Google account is available on this device. Add a Google account or use email sign-in.")
    }
    val credential = result.credential
    if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) throw IllegalStateException("Google did not return a supported sign-in credential.")
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}

private fun groupValues(filters: FilterGroups, group: String): List<String> = when (group) {
    "showType" -> filters.showType
    "screenFormat" -> filters.screenFormat
    "screeningTech" -> filters.screeningTech
    else -> filters.dubLanguage
}

private fun toggleFilter(filters: FilterGroups, group: String, value: String): FilterGroups {
    fun List<String>.toggled() = toMutableList().also { if (value in it) it.remove(value) else it.add(value) }
    return when (group) {
        "showType" -> filters.copy(showType = filters.showType.toggled())
        "screenFormat" -> filters.copy(screenFormat = filters.screenFormat.toggled())
        "screeningTech" -> filters.copy(screeningTech = filters.screeningTech.toggled())
        else -> filters.copy(dubLanguage = filters.dubLanguage.toggled())
    }
}

private fun String.displayFilterName() = when (this) { "showType" -> "Show type"; "screenFormat" -> "Format"; "screeningTech" -> "Technology"; else -> "Audio language" }

private fun matchesFilters(row: Screening, state: FilterState): Boolean {
    val filters = state.unchecked
    val selections = mapOf(
        "showType" to FILTER_OPTIONS.getValue("showType").filterNot { it in filters.showType }.toSet(),
        "screenFormat" to FILTER_OPTIONS.getValue("screenFormat").filterNot { it in filters.screenFormat }.toSet(),
        "screeningTech" to FILTER_OPTIONS.getValue("screeningTech").filterNot { it in filters.screeningTech }.toSet(),
        "dubLanguage" to FILTER_OPTIONS.getValue("dubLanguage").filterNot { it in filters.dubLanguage }.toSet()
    )
    val type = row.screeningType.trim().ifBlank { "Regular" }
    val typeTokens = when {
        type.equals("Premium", true) -> setOf("Premium")
        type.equals("Not Just Cinema", true) -> setOf("Not Just Cinema")
        else -> {
            val words = type.uppercase().split(Regex("[+\\s/,-]+")).toSet()
            buildSet { if ("REGULAR" in words) add("Regular"); if ("UPGRADE" in words) add("Upgrade"); if ("PRIME" in words) add("Prime"); if ("LOUNGE" in words) add("Lounge"); if ("VIP" in words || "BUSINESS" in words) add("VIP"); if ("LIGHT" in words) { add("VIP Light"); add("VIP") } }
        }
    }
    if (typeTokens.none(selections.getValue("showType")::contains)) return false
    val rawTech = row.screeningTech.trim().ifBlank { "2D" }
    val format = if (Regex("\\b3D\\b", RegexOption.IGNORE_CASE).containsMatchIn(rawTech)) "3D" else "2D"
    if (format !in selections.getValue("screenFormat")) return false
    val techs = buildSet {
        listOf("IMAX", "HFR", "ScreenX", "4DX", "ONYX", "Atmos").forEach { token -> if (rawTech.contains(token, true)) add(token) }
        if (rawTech.contains("Infinity Vision", true)) add("Infinity Vision")
        if (isEmpty()) add("Standard")
    }
    if (techs.none(selections.getValue("screeningTech")::contains)) return false
    val language = when (row.dubLanguage?.trim()?.lowercase()) { "hebrew" -> "Hebrew"; "french" -> "French"; else -> "Original" }
    return language in selections.getValue("dubLanguage")
}

private fun matchesRowPreferences(row: Screening, preferences: ShowtimePreferences): Boolean {
    if (!matchesFilters(row, preferences.screeningFilters)) return false
    val identity = CinemaIdentities.forScreening(row.screeningCity, row.cinema) ?: return true
    return identity.id !in preferences.excludedCinemaIds
}

private fun isUpcoming(row: Screening) = runCatching { KartiseretApi.shouldIncludeShowtime(LocalDate.parse(row.dateOfShowing), row.showtime) }.getOrDefault(false)

private fun AlertFilters.toFilterGroups() = FilterGroups(showType, screenFormat, screeningTech, dubLanguage)

private fun toggleAlertFilter(filters: AlertFilters, group: String, value: String): AlertFilters {
    fun List<String>.toggle() = toMutableList().also { if (value in it) it.remove(value) else it.add(value) }
    return when (group) {
        "showType" -> filters.copy(showType = filters.showType.toggle())
        "screenFormat" -> filters.copy(screenFormat = filters.screenFormat.toggle())
        "screeningTech" -> filters.copy(screeningTech = filters.screeningTech.toggle())
        else -> filters.copy(dubLanguage = filters.dubLanguage.toggle())
    }
}

private fun posterImageUrl(path: String?): String? = path?.takeIf(String::isNotBlank)?.let { value -> if (value.startsWith("https://")) value else if (value.startsWith("/")) "https://image.tmdb.org/t/p/w500$value" else null }

@Composable private fun MovieArtwork(source: String?, title: String, modifier: Modifier = Modifier) {
    if (source.isNullOrBlank()) {
        val seed = title.hashCode()
        val first = Color(0xff303030 + (seed and 0x001f1f1f))
        val second = Color(0xff191919 + (seed.inv() and 0x000b0b0b))
        Box(modifier.background(Brush.linearGradient(listOf(first, second))), contentAlignment = Alignment.Center) {
            Column(Modifier.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(Icons.Default.LocalMovies, null, tint = Color.White.copy(alpha = .7f), modifier = Modifier.size(24.dp))
                Text(title, color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp))
            }
        }
    } else {
        AsyncImage(model = source, contentDescription = "$title artwork", modifier = modifier)
    }
}
