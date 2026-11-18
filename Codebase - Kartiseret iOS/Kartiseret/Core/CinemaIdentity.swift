// Generated from packages/contracts/src/cinema-identities.ts.
// Run Scripts/generate_cinema_identities.py after changing that contract.
import Foundation

struct CinemaIdentity: Hashable, Identifiable, Sendable {
    let id: String
    let displayName: String
    let city: String
    let locationKeys: [String]
    let cinemaNameKeys: [String]
    let screeningCityKeys: [String]

    static let all: [CinemaIdentity] = [
        CinemaIdentity(id: "fBSh_YN0e5Iz", displayName: "MovieLand Afula", city: "Afula", locationKeys: ["https://maps.app.goo.gl/Tv9VyFJtZra8iEri6"], cinemaNameKeys: ["MovieLand", "MovieLand Afula"], screeningCityKeys: ["Afula"]),
        CinemaIdentity(id: "-oRDvbhs4P9m", displayName: "Cinema City Ashdod", city: "Ashdod", locationKeys: ["https://maps.app.goo.gl/Cr1pvKjWX86CokXU8"], cinemaNameKeys: ["Cinema City", "Cinema City Ashdod"], screeningCityKeys: ["Ashdod"]),
        CinemaIdentity(id: "jNfU2c0SQZSQ", displayName: "Hot Cinema Ashdod", city: "Ashdod", locationKeys: ["https://maps.app.goo.gl/9KhdhiDcfyqeuAPu7"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Ashdod"], screeningCityKeys: ["Ashdod"]),
        CinemaIdentity(id: "UphVORpsdEI5", displayName: "Hot Cinema Ashkelon", city: "Ashkelon", locationKeys: ["https://maps.app.goo.gl/6si1n2s92FpvRfEe7"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Ashkelon"], screeningCityKeys: ["Ashkelon"]),
        CinemaIdentity(id: "zj5prOYm_yxg", displayName: "Planet Cinema Ayalon", city: "Ayalon", locationKeys: ["https://maps.app.goo.gl/E2xot6XNKWXpR4kv6"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Ayalon", "Yes Planet", "Yes Planet Ayalon"], screeningCityKeys: ["Ayalon"]),
        CinemaIdentity(id: "cvx_eANXN-lb", displayName: "MovieLand Bat Yam", city: "Bat Yam", locationKeys: ["https://www.google.com/maps/search/?api=1&query=MovieLand+Yoseftal+92+Bat+Yam+Israel"], cinemaNameKeys: ["MovieLand", "MovieLand Bat Yam"], screeningCityKeys: ["Bat Yam"]),
        CinemaIdentity(id: "2_ZcNuqNdX-f", displayName: "Cinema City Beer Sheva", city: "Beer Sheva", locationKeys: ["https://maps.app.goo.gl/NtdqoKzfypRKiJTF7"], cinemaNameKeys: ["Cinema City", "Cinema City Beer Sheva"], screeningCityKeys: ["Beer Sheva"]),
        CinemaIdentity(id: "uzUWx8uJ1tCP", displayName: "Planet Cinema Beer Sheva", city: "Beer Sheva", locationKeys: ["https://maps.app.goo.gl/uKL8zeEdRGocmNXHA"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Beer Sheva", "Yes Planet", "Yes Planet Beer Sheva"], screeningCityKeys: ["Beer Sheva"]),
        CinemaIdentity(id: "hmt-BfTNfu1O", displayName: "Hot Cinema Carmiel", city: "Carmiel", locationKeys: ["https://maps.app.goo.gl/XPuzeSRndr1En9Tr6"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Carmiel"], screeningCityKeys: ["Carmiel"]),
        CinemaIdentity(id: "YT8ytn6TZV1K", displayName: "MovieLand Carmiel", city: "Carmiel", locationKeys: ["https://maps.app.goo.gl/2h22ZSXs1mPkd7hy8"], cinemaNameKeys: ["MovieLand", "MovieLand Carmiel"], screeningCityKeys: ["Carmiel"]),
        CinemaIdentity(id: "6uBaX_MrVCvT", displayName: "Cinema City Chadera", city: "Chadera", locationKeys: ["https://maps.app.goo.gl/dkRw1FLzP4Gha3rM9"], cinemaNameKeys: ["Cinema City", "Cinema City Chadera"], screeningCityKeys: ["Chadera"]),
        CinemaIdentity(id: "Obq7mmfK-3Xa", displayName: "Lev Cinema Even Yehuda", city: "Even Yehuda", locationKeys: ["https://maps.app.goo.gl/G5LAbDHUdCYgXNms5"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Even Yehuda"], screeningCityKeys: ["Even Yehuda"]),
        CinemaIdentity(id: "V2_hFHCDiE_i", displayName: "Rav Hen Givataim", city: "Givatayim", locationKeys: ["https://maps.app.goo.gl/1hecodAVyjwtiwbw5"], cinemaNameKeys: ["RavHen", "Rav Hen Givataim"], screeningCityKeys: ["Givatayim"]),
        CinemaIdentity(id: "ZEp31fLFHjho", displayName: "Cinema City Glilot", city: "Glilot", locationKeys: ["https://maps.app.goo.gl/EbU3r1TiphycaoXv8"], cinemaNameKeys: ["Cinema City", "Cinema City  Glilot"], screeningCityKeys: ["Glilot"]),
        CinemaIdentity(id: "0po4OAWhv7s2", displayName: "MovieLand Glilot", city: "Glilot", locationKeys: ["https://maps.app.goo.gl/ERzxDQbaawD96iWf6"], cinemaNameKeys: ["MovieLand", "MovieLand Glilot"], screeningCityKeys: ["Glilot"]),
        CinemaIdentity(id: "q3Vj5AtOuOLU", displayName: "Haifa Cinematheque", city: "Haifa", locationKeys: ["https://maps.app.goo.gl/DuDmLMQmXHUiEp7e9"], cinemaNameKeys: ["Cinematheque", "Haifa Cinematheque"], screeningCityKeys: ["Haifa"]),
        CinemaIdentity(id: "clpg_T_gxIOF", displayName: "Hot Cinema Haifa", city: "Haifa", locationKeys: ["https://maps.app.goo.gl/kkAbrKbMN1yA7MRY9"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Haifa"], screeningCityKeys: ["Haifa"]),
        CinemaIdentity(id: "WMKzo7Mqq7ZF", displayName: "MovieLand Haifa", city: "Haifa", locationKeys: ["https://maps.app.goo.gl/1evQ9zgAqmdVc4NB7"], cinemaNameKeys: ["MovieLand", "MovieLand Haifa"], screeningCityKeys: ["Haifa"]),
        CinemaIdentity(id: "_dmXnVsxLDU3", displayName: "Planet Cinema Haifa", city: "Haifa", locationKeys: ["https://maps.app.goo.gl/PEFKwqcpQA3ZwUUb9"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Haifa", "Yes Planet", "Yes Planet Haifa"], screeningCityKeys: ["Haifa"]),
        CinemaIdentity(id: "IBhyipCv9ScW", displayName: "Herziliya Cinematheque", city: "Herziliya", locationKeys: ["https://maps.app.goo.gl/q2TRk1vL7PJX6P7Z8"], cinemaNameKeys: ["Cinematheque", "Herziliya Cinematheque"], screeningCityKeys: ["Herziliya"]),
        CinemaIdentity(id: "L0JKiAPfk7s5", displayName: "Lev Cinema Herziliya", city: "Herziliya", locationKeys: ["https://maps.app.goo.gl/CYkdccdmffPTHUPT6"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Herziliya"], screeningCityKeys: ["Herziliya"]),
        CinemaIdentity(id: "x-L3HMxyf2r2", displayName: "Holon Cinematheque", city: "Holon", locationKeys: ["https://maps.app.goo.gl/z7hrmMKRqGYzZadq5"], cinemaNameKeys: ["Cinematheque", "Holon Cinematheque"], screeningCityKeys: ["Holon"]),
        CinemaIdentity(id: "d_jSzOK7tFJ1", displayName: "Hot Cinema Holon", city: "Holon", locationKeys: ["https://maps.app.goo.gl/RGnLZ5oudKKbXt5x9"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Holon"], screeningCityKeys: ["Holon"]),
        CinemaIdentity(id: "aK90TvH244M7", displayName: "Cinema City Jerusalem", city: "Jerusalem", locationKeys: ["https://maps.app.goo.gl/gidzqRCQgrMaDphF7"], cinemaNameKeys: ["Cinema City", "Cinema City Jerusalem"], screeningCityKeys: ["Jerusalem"]),
        CinemaIdentity(id: "smBcm2HtRvQA", displayName: "Jerusalem Cinematheque", city: "Jerusalem", locationKeys: ["https://maps.app.goo.gl/jDuGeP2hZhQiWYbG7"], cinemaNameKeys: ["Cinematheque", "Jerusalem Cinematheque"], screeningCityKeys: ["Jerusalem"]),
        CinemaIdentity(id: "dhaXlZaYiePE", displayName: "Sam Spiegel Cinema", city: "Jerusalem", locationKeys: ["https://maps.app.goo.gl/PvZx7wUHSatubTMC9"], cinemaNameKeys: ["Cinematheque", "Sam Spiegel Cinema"], screeningCityKeys: ["Jerusalem"]),
        CinemaIdentity(id: "JtkKielHHLJ5", displayName: "Lev Cinema Jerusalem", city: "Jerusalem", locationKeys: ["https://maps.app.goo.gl/CYoVrBYbth9AWDAH6"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Jerusalem"], screeningCityKeys: ["Jerusalem"]),
        CinemaIdentity(id: "GlBNYtNRhpA6", displayName: "Planet Cinema Jerusalem", city: "Jerusalem", locationKeys: ["https://maps.app.goo.gl/E5MNtJ5xPEFyyDPk7"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Jerusalem", "Yes Planet", "Yes Planet Jerusalem"], screeningCityKeys: ["Jerusalem"]),
        CinemaIdentity(id: "i2KtLj4lB8s9", displayName: "Cinema City Kfar Saba", city: "Kfar Saba", locationKeys: ["https://maps.app.goo.gl/7j59mis2efu4fjDm6"], cinemaNameKeys: ["Cinema City", "Cinema City Kfar Saba"], screeningCityKeys: ["Kfar Saba"]),
        CinemaIdentity(id: "lc625ND_8tDo", displayName: "Hot Cinema Kfar Saba", city: "Kfar Saba", locationKeys: ["https://maps.app.goo.gl/heei7VCvK51CPS8D6"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Kfar Saba"], screeningCityKeys: ["Kfar Saba"]),
        CinemaIdentity(id: "KpkFS_eZKZTz", displayName: "Hot Cinema Kiryat Bialik", city: "Kiryat Bialik", locationKeys: ["https://maps.app.goo.gl/dtep3CNfMRUd4G2B7"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Kiryat Bialik"], screeningCityKeys: ["Kiryat Bialik"]),
        CinemaIdentity(id: "CAxRnPHHZj-l", displayName: "Rav Hen Kiryat Ono", city: "Kiryat Ono", locationKeys: ["https://maps.app.goo.gl/xoJQ9ckj9S7U3o256"], cinemaNameKeys: ["RavHen", "Rav Hen Kiryat Ono"], screeningCityKeys: ["Kiryat Ono"]),
        CinemaIdentity(id: "jdNS6CrmxUUw", displayName: "Hot Cinema Modiin", city: "Modiin", locationKeys: ["https://maps.app.goo.gl/7i1MiFURQnWrUky1A"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Modiin"], screeningCityKeys: ["Modiin"]),
        CinemaIdentity(id: "pvNMEc4RdeCz", displayName: "Hot Cinema Nahariya", city: "Nahariya", locationKeys: ["https://maps.app.goo.gl/4R9XqnPu9RR9TDNR7"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Nahariya"], screeningCityKeys: ["Nahariya"]),
        CinemaIdentity(id: "3UsxFst2wQIs", displayName: "Cinema City Netanya", city: "Netanya", locationKeys: ["https://maps.app.goo.gl/Cc1cc41U8DAzLZNF6"], cinemaNameKeys: ["Cinema City", "Cinema City Netanya"], screeningCityKeys: ["Netanya"]),
        CinemaIdentity(id: "Q5Q2GZbsk2Zh", displayName: "MovieLand Netanya", city: "Netanya", locationKeys: ["https://maps.app.goo.gl/rg8BwksCH9cv5CrB6"], cinemaNameKeys: ["MovieLand", "MovieLand Netanya"], screeningCityKeys: ["Netanya"]),
        CinemaIdentity(id: "hYg3839rL7nl", displayName: "Lev Cinema Omer", city: "Omer", locationKeys: ["https://maps.app.goo.gl/wmeRyqeVuXDffUvV8"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Omer"], screeningCityKeys: ["Omer"]),
        CinemaIdentity(id: "W5GlbQyWvHH8", displayName: "Hot Cinema Petach Tikvah", city: "Petach Tikvah", locationKeys: ["https://maps.app.goo.gl/cbywX322mn4xRDt68"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Petach Tikvah"], screeningCityKeys: ["Petach Tikvah"]),
        CinemaIdentity(id: "RnXR1CzNZSKL", displayName: "Lev Cinema Raanana", city: "Raanana", locationKeys: ["https://maps.app.goo.gl/pkYGqMwRU5STEab99"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Raanana"], screeningCityKeys: ["Raanana"]),
        CinemaIdentity(id: "mo20eHzr8uQo", displayName: "Lev Cinema Ramat HaSharon", city: "Ramat Hasharon", locationKeys: ["https://maps.app.goo.gl/n1UJewZt4wCeYL8q6"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Ramat HaSharon"], screeningCityKeys: ["Ramat Hasharon"]),
        CinemaIdentity(id: "JuZMeFcpXX1W", displayName: "Hot Cinema Rehovot", city: "Rehovot", locationKeys: ["https://maps.app.goo.gl/mhPo8YA34TjUBSYH8"], cinemaNameKeys: ["Hot Cinema", "Hot Cinema Rehovot"], screeningCityKeys: ["Rehovot"]),
        CinemaIdentity(id: "yQCXIS0-fFHF", displayName: "Cinema City Rishon Letzion", city: "Rishon Letzion", locationKeys: ["https://maps.app.goo.gl/zMb4z32W2wUDRanm9"], cinemaNameKeys: ["Cinema City", "Cinema City Rishon Letzion"], screeningCityKeys: ["Rishon Letzion"]),
        CinemaIdentity(id: "8bV46WOz9LrX", displayName: "Planet Cinema Rishon Letzion", city: "Rishon Letzion", locationKeys: ["https://maps.app.goo.gl/LCtTHFzkRyWAVTHx9"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Rishon Letzion", "Yes Planet", "Yes Planet Rishon Letzion"], screeningCityKeys: ["Rishon Letzion"]),
        CinemaIdentity(id: "Lv7nojZOm284", displayName: "Jaffa Cinema", city: "Tel Aviv", locationKeys: ["https://maps.app.goo.gl/NC7zB4GQzEP9dcG88"], cinemaNameKeys: ["Cinematheque", "Jaffa Cinema"], screeningCityKeys: ["Tel Aviv", "Jaffa"]),
        CinemaIdentity(id: "8CddAGtBwU-0", displayName: "Tel Aviv Cinematheque", city: "Tel Aviv", locationKeys: ["https://maps.app.goo.gl/CMjXe22MvFscPUtn9"], cinemaNameKeys: ["Cinematheque", "Tel Aviv Cinematheque"], screeningCityKeys: ["Tel Aviv"]),
        CinemaIdentity(id: "-C4tCRUL3CRU", displayName: "Lev Cinema Tel Aviv", city: "Tel Aviv", locationKeys: ["https://maps.app.goo.gl/EhdaZU8hTAc1BwSk8"], cinemaNameKeys: ["Lev Cinema", "Lev Cinema Tel Aviv"], screeningCityKeys: ["Tel Aviv"]),
        CinemaIdentity(id: "UpGBEyVZD81h", displayName: "Rav Hen Tel Aviv", city: "Tel Aviv", locationKeys: ["https://maps.app.goo.gl/MAuea1C9KZjXeWQx5"], cinemaNameKeys: ["RavHen", "Rav Hen Tel Aviv"], screeningCityKeys: ["Tel Aviv"]),
        CinemaIdentity(id: "vDDsjAP8cIuf", displayName: "Planet Cinema Zichron Yaakov", city: "Zichron Yaakov", locationKeys: ["https://maps.app.goo.gl/j5adcdmcn3r7TQL76"], cinemaNameKeys: ["Planet Cinema", "Planet Cinema Zichron Yaakov", "Yes Planet", "Yes Planet Zichron Yaakov"], screeningCityKeys: ["Zichron Yaakov"]),
    ]

    static func byID(_ id: String) -> CinemaIdentity? {
        all.first { $0.id == id }
    }

    static func forScreening(city: String, cinema: String) -> CinemaIdentity? {
        let normalizedCity = normalize(city)
        let normalizedCinema = normalize(cinema)
        let matches = all.filter { identity in
            identity.screeningCityKeys.contains { normalize($0) == normalizedCity } &&
            identity.cinemaNameKeys.contains { normalize($0) == normalizedCinema }
        }
        return matches.count == 1 ? matches[0] : nil
    }

    static func normalized(_ value: String) -> String {
        normalize(value)
    }

    private static func normalize(_ value: String) -> String {
        value.precomposedStringWithCompatibilityMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .lowercased(with: Locale(identifier: "en"))
    }
}
