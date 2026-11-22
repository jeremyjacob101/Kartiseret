package com.jj.kartiseret

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.lifecycle.lifecycleScope
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import java.time.LocalDate

private val bg = Color(0xff212121)
private val card = Color(0xff303030)
private val accent = Color(0xffa66ae3)
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); window.statusBarColor = android.graphics.Color.rgb(33,33,33); setContent { KartiseretApp(intent?.data) } }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent) }
}

@Composable private fun KartiseretApp(incoming: Uri?) {
    val context = LocalContext.current
    val api = remember { KartiseretApi() }
    var tab by remember { mutableStateOf("Discover") }; var city by remember { mutableStateOf("Jerusalem") }
    var movies by remember { mutableStateOf<List<Movie>>(emptyList()) }; var soon by remember { mutableStateOf<List<Movie>>(emptyList()) }
    var screenings by remember { mutableStateOf<List<Screening>>(emptyList()) }; var cities by remember { mutableStateOf(listOf("Jerusalem", "Tel Aviv", "Haifa")) }
    var selectedDay by remember { mutableStateOf(KartiseretApi.cinemaDay().toString()) }; var selectedMovie by remember { mutableStateOf<Movie?>(null) }
    var query by remember { mutableStateOf("") }; var error by remember { mutableStateOf<String?>(null) }; var busy by remember { mutableStateOf(false) }
    val prefs = remember { context.getSharedPreferences("guest", 0) }
    LaunchedEffect(Unit) { city = prefs.getString("city", "Jerusalem") ?: "Jerusalem"; loadData(api, city, selectedDay, { a,b,c,d -> movies=a;soon=b;screenings=c;cities=d }) }
    LaunchedEffect(city, selectedDay) { prefs.edit().putString("city", city).apply(); try { screenings = withContext(Dispatchers.IO) { Json { ignoreUnknownKeys=true }.decodeFromString<Showtimes>(api.showtimes(city, selectedDay)).showtimes } } catch (e: Exception) { error=e.message } }
    LaunchedEffect(incoming) { val uri=incoming ?: return@LaunchedEffect; val path=uri.pathSegments.firstOrNull(); if(path!=null && path !in listOf("movies","soons","showtimes","cinematheques","user","c")) { val movie=movies.firstOrNull{it.movieCode==path.take(3)}?:soon.firstOrNull{it.movieCode==path.take(3)}; selectedMovie=movie } else tab=when(path){"movies"->"Discover";"showtimes"->"Showtimes";"cinematheques"->"Cinematheques";"user"->"You";else->"Discover"} }
    MaterialTheme(colorScheme = darkColorScheme(primary=accent,background=bg,surface=card)) {
        Scaffold(containerColor=bg,bottomBar={ NavigationBar(containerColor=Color(0xff181818)){ listOf("Discover","Showtimes","Cinematheques","You").forEachIndexed{ i,label-> NavigationBarItem(selected=tab==label,onClick={tab=label;selectedMovie=null},icon={Icon(listOf(Icons.Default.Search,Icons.Default.ConfirmationNumber,Icons.Default.AccountBalance,Icons.Default.Person)[i],null)},label={Text(label)}) } } }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                when(tab){
                    "Discover" -> if(selectedMovie!=null) MovieDetail(selectedMovie!!, onBack={selectedMovie=null}, onShow={tab="Showtimes"}, onShare={share(context, "https://seret.site/${selectedMovie!!.movieCode ?: ""}")}, onOpen={open(context,it)}) else Discover(movies,soon,query,{query=it},{selectedMovie=it},{tab="Showtimes"})
                    "Showtimes" -> ShowtimesPage(screenings,city,cities,selectedDay,{city=it},{selectedDay=it},{ selectedMovie=it;tab="Discover"},{open(context,it)})
                    "Cinematheques" -> CinemathequesPage(screenings,selectedDay,{selectedDay=it},{open(context,it)})
                    else -> AccountPage(api,error={error=it},busy={busy=it},onSignin={ token -> prefs.edit().putString("token",token).apply() })
                }
                error?.let { Text(it, color=Color(0xffff8a80),modifier=Modifier.padding(12.dp)); TextButton(onClick={error=null}){Text("Dismiss")} }
            }
        }
    }
}

private suspend fun loadData(api:KartiseretApi,city:String,day:String,done:(List<Movie>,List<Movie>,List<Screening>,List<String>)->Unit){ withContext(Dispatchers.IO){ try{val json=Json{ignoreUnknownKeys=true}; val a=json.decodeFromString<Envelope<Catalog>>(api.catalog(false)).data?.movies.orEmpty();val b=json.decodeFromString<Envelope<Catalog>>(api.catalog(true)).data?.movies.orEmpty();val c=json.decodeFromString<Envelope<Theaters>>(api.theaters()).data?.cities?.map{it.name}.orEmpty();done(a,b,emptyList(),c.ifEmpty{listOf("Jerusalem")})}catch(_:Exception){} } }

@Composable private fun Discover(now:List<Movie>,soon:List<Movie>,query:String,onQuery:(String)->Unit,onMovie:(Movie)->Unit,onShow:()->Unit){
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(bottom=20.dp)) {
        item { Column(Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(Color(0xff393939),bg))).padding(22.dp)){Text("ISRAELI CINEMA, ALL IN ONE PLACE",color=accent,fontSize=12.sp,fontWeight=FontWeight.Bold);Text("Find your next\nnight at the movies.",color=Color.White,fontSize=32.sp,fontWeight=FontWeight.Bold);Text("Showtimes, films, and local cinemas",color=Color.LightGray);Row{TextButton(onClick=onShow){Text("Showtimes")} } } }
        item { OutlinedTextField(query,onQuery,Modifier.fillMaxWidth().padding(horizontal=16.dp),placeholder={Text("Search films")},leadingIcon={Icon(Icons.Default.Search,null)}) }
        val filteredNow=now.filter{query.isBlank()||it.title.contains(query,true)||it.year.toString().contains(query)}
        item { Shelf("Now Playing",filteredNow,onMovie) };item{Shelf("Coming Soon",soon.filter{query.isBlank()||it.title.contains(query,true)},onMovie)}
        if(now.isEmpty()&&soon.isEmpty()) item {Text("Loading films…",Modifier.padding(24.dp),color=Color.White)}
    }
}
@Composable private fun Shelf(title:String,movies:List<Movie>,onMovie:(Movie)->Unit){Column(Modifier.padding(top=20.dp)){Text(title,Modifier.padding(horizontal=18.dp),color=Color.White,fontSize=23.sp,fontWeight=FontWeight.Bold);Row(Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)){movies.take(30).forEach{movie->Column(Modifier.width(130.dp).clickable{onMovie(movie)}){Poster(movie,130.dp,194.dp);Text(movie.title,color=Color.White,fontWeight=FontWeight.SemiBold,maxLines=2);Text(movie.year.toString(),color=Color.LightGray)}}}}}
@Composable private fun Poster(movie:Movie,w:Dp,h:Dp){AsyncImage(movie.imageSrc,contentDescription="${movie.title} poster",modifier=Modifier.size(w,h).background(card,RoundedCornerShape(10.dp))) }
@Composable private fun MovieDetail(movie:Movie,onBack:()->Unit,onShow:()->Unit,onShare:()->Unit,onOpen:(String)->Unit){Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())){TextButton(onClick=onBack){Text("‹  Back")};AsyncImage(movie.backdropSrc?:movie.imageSrc,contentDescription=null,modifier=Modifier.fillMaxWidth().height(260.dp));Text(movie.title,Modifier.padding(20.dp),color=Color.White,fontSize=30.sp,fontWeight=FontWeight.Bold);Text("${movie.year}  ·  ${movie.runtime} min",Modifier.padding(horizontal=20.dp),color=Color.LightGray);Text(movie.overview?:movie.genres.joinToString(" · "),Modifier.padding(20.dp),color=Color.White);Row{Button(onClick=onShow){Text("Showtimes")};TextButton(onClick=onShare){Text("Share")};movie.trailerKey?.let{TextButton(onClick={onOpen("https://www.youtube.com/watch?v=$it")}){Text("Trailer")}}}}}
@Composable private fun ShowtimesPage(rows:List<Screening>,city:String,cities:List<String>,day:String,onCity:(String)->Unit,onDay:(String)->Unit,onMovie:(Movie)->Unit,onOpen:(String)->Unit){Column(Modifier.fillMaxSize()){Row(Modifier.horizontalScroll(rememberScrollState()).padding(8.dp)){cities.take(14).forEach{FilterChip(city==it,{onCity(it)},label={Text(it)})}};Row(verticalAlignment=Alignment.CenterVertically){TextButton(onClick={onDay(LocalDate.parse(day).minusDays(1).toString())}){Text("‹")};Text(day,Modifier.weight(1f),color=Color.White);TextButton(onClick={onDay(LocalDate.parse(day).plusDays(1).toString())}){Text("›")}};LazyColumn{items(rows){s->Column(Modifier.fillMaxWidth().clickable{onMovie(Movie(s.tmdbId,s.cinema,0))}.padding(16.dp)){Text(s.cinema,color=Color.White,fontWeight=FontWeight.Bold);Text("${s.showtime}  ·  ${s.screeningTech}  ·  ${s.screeningType}",color=Color.LightGray);val url=s.englishHref?:s.hebrewHref;if(url!=null)TextButton(onClick={onOpen(url)}){Text("Tickets")}};HorizontalDivider(color=card)}}} }
@Composable private fun CinemathequesPage(rows:List<Screening>,day:String,onDay:(String)->Unit,onOpen:(String)->Unit){Column{Text("Cinematheques",Modifier.padding(20.dp),color=Color.White,fontSize=26.sp,fontWeight=FontWeight.Bold);TextButton(onClick={onDay(LocalDate.parse(day).plusDays(1).toString())}){Text("$day  ·  Next day")};LazyColumn{items(rows){s->ListItem(headlineContent={Text(s.cinema)},supportingContent={Text("${s.showtime} · ${s.screeningTech}")},trailingContent={val url=s.englishHref?:s.hebrewHref;if(url!=null)TextButton(onClick={ {onOpen(url)} }){Text("Book")}})}}}}

@Composable private fun AccountPage(api:KartiseretApi,error:(String)->Unit,busy:(Boolean)->Unit,onSignin:(String)->Unit){val context= LocalContext.current;val prefs=context.getSharedPreferences("guest",0);var token by remember{mutableStateOf(prefs.getString("token",null))};var email by remember{mutableStateOf("")};var password by remember{mutableStateOf("")};var city by remember{mutableStateOf(prefs.getString("city","Jerusalem")?:"Jerusalem")};var signedIn by remember{mutableStateOf(token!=null)};var message by remember{mutableStateOf("")};Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)){Text("Your Kartiseret",color=Color.White,fontSize=28.sp,fontWeight=FontWeight.Bold);Spacer(Modifier.height(18.dp));if(!signedIn){OutlinedTextField(email,{email=it},label={Text("Email")},modifier=Modifier.fillMaxWidth());OutlinedTextField(password,{password=it},label={Text("Password")},modifier=Modifier.fillMaxWidth());Button(onClick{ busy(true); Thread {try{val raw=api.signIn(email,password); val tok=Regex("""set-auth-token""",RegexOption.IGNORE_CASE); val extracted=Regex(""""token"\s*:\s*"([^"]+)"""").find(raw)?.groupValues?.get(1); if(extracted!=null){context.getSharedPreferences("guest",0).edit().putString("token",extracted).apply();token=extracted;signedIn=true;onSignin(extracted)}else message="Sign-in response received. Retry or check your email verification."}catch(e:Exception){message=e.message?:"Sign in failed"};busy(false)}.start() },Modifier.fillMaxWidth()){Text("Sign in")};TextButton(onClick={open(context,"https://seret.site/user")}){Text("Create account or sign in with Google")};TextButton(onClick={open(context,"https://seret.site/user")}){Text("Sign in with Apple on the website")}}else{Text("Signed in",color=Color.White);Text(email,color=Color.LightGray);Text("Preferences",Modifier.padding(top=22.dp),color=accent,fontSize=20.sp);Text("Default city",color=Color.White);OutlinedTextField(city,{city=it;prefs.edit().putString("city",it).apply()},modifier=Modifier.fillMaxWidth());Text("Account preferences and saved alerts sync through your Kartiseret account.",color=Color.LightGray,modifier=Modifier.padding(vertical=12.dp));Button(onClick{val t=token;Thread{try{if(t!=null)api.signOut(t)}catch(_:Exception){};prefs.edit().remove("token").apply();signedIn=false;token=null}.start()}){Text("Sign out")}};if(message.isNotBlank())Text(message,color=Color.LightGray)} }
private fun open(context:android.content.Context,url:String){try{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}catch(_:Exception){}}
private fun share(context:android.content.Context,url:String){context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,url),"Share film"))}
