package com.jj.kartiseret

data class CinemaIdentity(val id: String, val displayName: String, val city: String, val nameKeys: List<String>, val screeningCityKeys: List<String>)

object CinemaIdentities {
    val all = listOf(
    CinemaIdentity("fBSh_YN0e5Iz", "MovieLand Afula", "Afula", listOf("MovieLand", "MovieLand Afula"), listOf("Afula")),
    CinemaIdentity("-oRDvbhs4P9m", "Cinema City Ashdod", "Ashdod", listOf("Cinema City", "Cinema City Ashdod"), listOf("Ashdod")),
    CinemaIdentity("jNfU2c0SQZSQ", "Hot Cinema Ashdod", "Ashdod", listOf("Hot Cinema", "Hot Cinema Ashdod"), listOf("Ashdod")),
    CinemaIdentity("UphVORpsdEI5", "Hot Cinema Ashkelon", "Ashkelon", listOf("Hot Cinema", "Hot Cinema Ashkelon"), listOf("Ashkelon")),
    CinemaIdentity("zj5prOYm_yxg", "Planet Cinema Ayalon", "Ayalon", listOf("Planet Cinema", "Planet Cinema Ayalon", "Yes Planet", "Yes Planet Ayalon"), listOf("Ayalon")),
    CinemaIdentity("cvx_eANXN-lb", "MovieLand Bat Yam", "Bat Yam", listOf("MovieLand", "MovieLand Bat Yam"), listOf("Bat Yam")),
    CinemaIdentity("2_ZcNuqNdX-f", "Cinema City Beer Sheva", "Beer Sheva", listOf("Cinema City", "Cinema City Beer Sheva"), listOf("Beer Sheva")),
    CinemaIdentity("uzUWx8uJ1tCP", "Planet Cinema Beer Sheva", "Beer Sheva", listOf("Planet Cinema", "Planet Cinema Beer Sheva", "Yes Planet", "Yes Planet Beer Sheva"), listOf("Beer Sheva")),
    CinemaIdentity("hmt-BfTNfu1O", "Hot Cinema Carmiel", "Carmiel", listOf("Hot Cinema", "Hot Cinema Carmiel"), listOf("Carmiel")),
    CinemaIdentity("YT8ytn6TZV1K", "MovieLand Carmiel", "Carmiel", listOf("MovieLand", "MovieLand Carmiel"), listOf("Carmiel")),
    CinemaIdentity("6uBaX_MrVCvT", "Cinema City Chadera", "Chadera", listOf("Cinema City", "Cinema City Chadera"), listOf("Chadera")),
    CinemaIdentity("Obq7mmfK-3Xa", "Lev Cinema Even Yehuda", "Even Yehuda", listOf("Lev Cinema", "Lev Cinema Even Yehuda"), listOf("Even Yehuda")),
    CinemaIdentity("V2_hFHCDiE_i", "Rav Hen Givataim", "Givatayim", listOf("RavHen", "Rav Hen Givataim"), listOf("Givatayim")),
    CinemaIdentity("ZEp31fLFHjho", "Cinema City Glilot", "Glilot", listOf("Cinema City", "Cinema City  Glilot"), listOf("Glilot")),
    CinemaIdentity("0po4OAWhv7s2", "MovieLand Glilot", "Glilot", listOf("MovieLand", "MovieLand Glilot"), listOf("Glilot")),
    CinemaIdentity("q3Vj5AtOuOLU", "Haifa Cinematheque", "Haifa", listOf("Cinematheque", "Haifa Cinematheque"), listOf("Haifa")),
    CinemaIdentity("clpg_T_gxIOF", "Hot Cinema Haifa", "Haifa", listOf("Hot Cinema", "Hot Cinema Haifa"), listOf("Haifa")),
    CinemaIdentity("WMKzo7Mqq7ZF", "MovieLand Haifa", "Haifa", listOf("MovieLand", "MovieLand Haifa"), listOf("Haifa")),
    CinemaIdentity("_dmXnVsxLDU3", "Planet Cinema Haifa", "Haifa", listOf("Planet Cinema", "Planet Cinema Haifa", "Yes Planet", "Yes Planet Haifa"), listOf("Haifa")),
    CinemaIdentity("IBhyipCv9ScW", "Herziliya Cinematheque", "Herziliya", listOf("Cinematheque", "Herziliya Cinematheque"), listOf("Herziliya")),
    CinemaIdentity("L0JKiAPfk7s5", "Lev Cinema Herziliya", "Herziliya", listOf("Lev Cinema", "Lev Cinema Herziliya"), listOf("Herziliya")),
    CinemaIdentity("x-L3HMxyf2r2", "Holon Cinematheque", "Holon", listOf("Cinematheque", "Holon Cinematheque"), listOf("Holon")),
    CinemaIdentity("d_jSzOK7tFJ1", "Hot Cinema Holon", "Holon", listOf("Hot Cinema", "Hot Cinema Holon"), listOf("Holon")),
    CinemaIdentity("aK90TvH244M7", "Cinema City Jerusalem", "Jerusalem", listOf("Cinema City", "Cinema City Jerusalem"), listOf("Jerusalem")),
    CinemaIdentity("smBcm2HtRvQA", "Jerusalem Cinematheque", "Jerusalem", listOf("Cinematheque", "Jerusalem Cinematheque"), listOf("Jerusalem")),
    CinemaIdentity("dhaXlZaYiePE", "Sam Spiegel Cinema", "Jerusalem", listOf("Cinematheque", "Sam Spiegel Cinema"), listOf("Jerusalem")),
    CinemaIdentity("JtkKielHHLJ5", "Lev Cinema Jerusalem", "Jerusalem", listOf("Lev Cinema", "Lev Cinema Jerusalem"), listOf("Jerusalem")),
    CinemaIdentity("GlBNYtNRhpA6", "Planet Cinema Jerusalem", "Jerusalem", listOf("Planet Cinema", "Planet Cinema Jerusalem", "Yes Planet", "Yes Planet Jerusalem"), listOf("Jerusalem")),
    CinemaIdentity("i2KtLj4lB8s9", "Cinema City Kfar Saba", "Kfar Saba", listOf("Cinema City", "Cinema City Kfar Saba"), listOf("Kfar Saba")),
    CinemaIdentity("lc625ND_8tDo", "Hot Cinema Kfar Saba", "Kfar Saba", listOf("Hot Cinema", "Hot Cinema Kfar Saba"), listOf("Kfar Saba")),
    CinemaIdentity("KpkFS_eZKZTz", "Hot Cinema Kiryat Bialik", "Kiryat Bialik", listOf("Hot Cinema", "Hot Cinema Kiryat Bialik"), listOf("Kiryat Bialik")),
    CinemaIdentity("CAxRnPHHZj-l", "Rav Hen Kiryat Ono", "Kiryat Ono", listOf("RavHen", "Rav Hen Kiryat Ono"), listOf("Kiryat Ono")),
    CinemaIdentity("jdNS6CrmxUUw", "Hot Cinema Modiin", "Modiin", listOf("Hot Cinema", "Hot Cinema Modiin"), listOf("Modiin")),
    CinemaIdentity("pvNMEc4RdeCz", "Hot Cinema Nahariya", "Nahariya", listOf("Hot Cinema", "Hot Cinema Nahariya"), listOf("Nahariya")),
    CinemaIdentity("3UsxFst2wQIs", "Cinema City Netanya", "Netanya", listOf("Cinema City", "Cinema City Netanya"), listOf("Netanya")),
    CinemaIdentity("Q5Q2GZbsk2Zh", "MovieLand Netanya", "Netanya", listOf("MovieLand", "MovieLand Netanya"), listOf("Netanya")),
    CinemaIdentity("hYg3839rL7nl", "Lev Cinema Omer", "Omer", listOf("Lev Cinema", "Lev Cinema Omer"), listOf("Omer")),
    CinemaIdentity("W5GlbQyWvHH8", "Hot Cinema Petach Tikvah", "Petach Tikvah", listOf("Hot Cinema", "Hot Cinema Petach Tikvah"), listOf("Petach Tikvah")),
    CinemaIdentity("RnXR1CzNZSKL", "Lev Cinema Raanana", "Raanana", listOf("Lev Cinema", "Lev Cinema Raanana"), listOf("Raanana")),
    CinemaIdentity("mo20eHzr8uQo", "Lev Cinema Ramat HaSharon", "Ramat Hasharon", listOf("Lev Cinema", "Lev Cinema Ramat HaSharon"), listOf("Ramat Hasharon")),
    CinemaIdentity("JuZMeFcpXX1W", "Hot Cinema Rehovot", "Rehovot", listOf("Hot Cinema", "Hot Cinema Rehovot"), listOf("Rehovot")),
    CinemaIdentity("yQCXIS0-fFHF", "Cinema City Rishon Letzion", "Rishon Letzion", listOf("Cinema City", "Cinema City Rishon Letzion"), listOf("Rishon Letzion")),
    CinemaIdentity("8bV46WOz9LrX", "Planet Cinema Rishon Letzion", "Rishon Letzion", listOf("Planet Cinema", "Planet Cinema Rishon Letzion", "Yes Planet", "Yes Planet Rishon Letzion"), listOf("Rishon Letzion")),
    CinemaIdentity("Lv7nojZOm284", "Jaffa Cinema", "Tel Aviv", listOf("Cinematheque", "Jaffa Cinema"), listOf("Tel Aviv", "Jaffa")),
    CinemaIdentity("8CddAGtBwU-0", "Tel Aviv Cinematheque", "Tel Aviv", listOf("Cinematheque", "Tel Aviv Cinematheque"), listOf("Tel Aviv")),
    CinemaIdentity("-C4tCRUL3CRU", "Lev Cinema Tel Aviv", "Tel Aviv", listOf("Lev Cinema", "Lev Cinema Tel Aviv"), listOf("Tel Aviv")),
    CinemaIdentity("UpGBEyVZD81h", "Rav Hen Tel Aviv", "Tel Aviv", listOf("RavHen", "Rav Hen Tel Aviv"), listOf("Tel Aviv")),
    CinemaIdentity("vDDsjAP8cIuf", "Planet Cinema Zichron Yaakov", "Zichron Yaakov", listOf("Planet Cinema", "Planet Cinema Zichron Yaakov", "Yes Planet", "Yes Planet Zichron Yaakov"), listOf("Zichron Yaakov"))
    )
    fun forScreening(city: String, name: String): CinemaIdentity? = all.filter { identity ->
        identity.screeningCityKeys.any { it.normalizeCinemaKey() == city.normalizeCinemaKey() } && identity.nameKeys.any { key ->
            key.normalizeCinemaKey() == name.normalizeCinemaKey()
        }
    }.singleOrNull()
    fun byId(id: String): CinemaIdentity? = all.firstOrNull { it.id == id }
    private fun String.normalizeCinemaKey() = java.text.Normalizer.normalize(this, java.text.Normalizer.Form.NFKC).trim().replace(Regex("\\s+"), " " ).lowercase(java.util.Locale.ENGLISH)
}
